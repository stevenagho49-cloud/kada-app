import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

// End-to-end verification for invoice arrears against the LIVE Supabase project,
// Stripe TEST mode and Resend. Creates a test school + sent invoice, then:
//   1. Schema + trigger: sent date and 14-day due date stamped, pay token issued
//   2. Reminder schedule, by moving the due date: nothing before day 3, one
//      friendly on day 3, nothing more until one firm on day 10, nothing after;
//      the arrears view flags it for personal follow-up past day 10
//   3. Manual reminder, and Resend accepted every reminder email
//   4. Pay now: the pay page and Stripe Checkout charge the exact invoice total
//      (discount included). The script waits while you pay the printed Checkout
//      URL with card 4242 4242 4242 4242, then delivers Stripe's real
//      checkout.session.completed event to the local server
//   5. The invoice is Paid, a redelivery changes nothing, a stale client save
//      can't flip it back to Sent, and it leaves the arrears list
//   6. The booking's status was never touched (no automatic consequences)
// The test school/booking are kept (paid) so they can be inspected; a temporary
// staff login used for the authenticated endpoints is deleted at the end.
//
// Requires: node server/index.js running on PORT (default 4242), and
// STRIPE_WEBHOOK_SECRET matching what that server was started with.

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const serverBase = `http://localhost:${process.env.PORT || 4242}`
const stamp = Date.now()
const RECIPIENT = 'delivered@resend.dev'

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures += 1
}

const londonToday = () => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = (type) => parts.find((part) => part.type === type).value
  return `${get('year')}-${get('month')}-${get('day')}`
}
const daysAgo = (days) => new Date(Date.parse(`${londonToday()}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10)

// Temporary staff login with only the sales area, for the authenticated endpoints.
const testEmail = `arrears-verify-${stamp}@example.com`
const testPassword = `Verify-${stamp}-${Math.random().toString(36).slice(2)}`
const { data: created, error: createError } = await service.auth.admin.createUser({ email: testEmail, password: testPassword, email_confirm: true, user_metadata: { full_name: 'Arrears Verify' } })
if (createError) { console.error('Could not create the temporary staff login:', createError.message); process.exit(1) }
const testUserId = created.user.id
let token = ''
try {
  await service.from('profiles').update({ role: 'staff', permissions: ['sales'], full_name: 'Arrears Verify' }).eq('id', testUserId)
  const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email: testEmail, password: testPassword })
  if (signInError) throw signInError
  token = signIn.session.access_token
  await run()
} catch (error) {
  console.error('Verification aborted:', error.message)
  failures += 1
} finally {
  await service.auth.admin.deleteUser(testUserId)
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)

async function api(path, options = {}) {
  const response = await fetch(`${serverBase}${path}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) } })
  return { status: response.status, body: await response.json().catch(() => ({})) }
}

async function signedWebhook(event) {
  const payload = JSON.stringify(event)
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET })
  return fetch(`${serverBase}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload })
}

async function reminderRows(bookingId) {
  const { data } = await service.from('invoice_reminders').select('*').eq('booking_id', bookingId).order('created_at')
  return data || []
}

async function run() {
  // 1. Schema, RLS and the invoice trigger.
  const anonReminders = await anon.from('invoice_reminders').select('id').limit(1)
  check('invoice_reminders exists and anon reads nothing', !anonReminders.error && (anonReminders.data || []).length === 0, anonReminders.error?.message)

  const schoolId = `arrears-verify-school-${stamp}`
  const bookingId = `arrears-verify-${stamp}`
  const { error: schoolError } = await service.from('schools').insert({ id: schoolId, name: `Arrears Verify School ${stamp}`, contact_name: 'Test Contact', email: RECIPIENT })
  if (schoolError) throw new Error(`test school: ${schoolError.message}`)
  const { error: bookingError } = await service.from('bookings').insert({ id: bookingId, school_id: schoolId, contact_name: 'Test Contact', contact_email: RECIPIENT, date: daysAgo(20), session_type: 'Arrears verification workshop', price: 120, student_count: 30, status: 'Confirmed', invoice_status: 'Sent', invoice_number: `TEST-ARREARS-${stamp}`, invoice_overrides: { amount: 120, discountPercent: 10 }, notes: 'Created by scripts/verify-invoice-arrears.js' })
  if (bookingError) throw new Error(`test booking: ${bookingError.message}`)
  console.log(`Test invoice: TEST-ARREARS-${stamp} (booking ${bookingId}, school ${schoolId})`)

  const { data: fresh } = await service.from('bookings').select('*').eq('id', bookingId).single()
  check('trigger stamps invoice_sent_at when an invoice is Sent', Boolean(fresh.invoice_sent_at), fresh.invoice_sent_at)
  const expectedDue = new Date(new Date(fresh.invoice_sent_at).getTime() + 14 * 86400000).toISOString().slice(0, 10)
  check('trigger sets the due date 14 days after sending', fresh.invoice_due_date === expectedDue, `${fresh.invoice_due_date} vs ${expectedDue}`)
  check('booking has a 32-character pay token', /^[a-f0-9]{32}$/.test(fresh.invoice_pay_token || ''), fresh.invoice_pay_token)
  const payToken = fresh.invoice_pay_token

  // 2. Reminder schedule, driven by the due date.
  const setDue = (date) => service.from('bookings').update({ invoice_due_date: date }).eq('id', bookingId)
  const runCheck = async (label) => {
    const result = await api('/api/invoices/reminders/run', { method: 'POST' })
    if (result.status !== 200) check(`reminder run (${label}) succeeds`, false, `HTTP ${result.status} ${result.body.error || ''}`)
    return (result.body.sent || []).filter((item) => item.bookingId === bookingId)
  }
  const expectRun = async (daysOverdue, expectKind) => {
    await setDue(daysAgo(daysOverdue))
    const sent = await runCheck(`day ${daysOverdue}`)
    if (expectKind) check(`day ${daysOverdue}: ${expectKind} reminder sent`, sent.length === 1 && sent[0].kind === expectKind && sent[0].sent, JSON.stringify(sent))
    else check(`day ${daysOverdue}: no reminder sent`, sent.length === 0, JSON.stringify(sent))
  }
  await expectRun(-5, null)
  await expectRun(0, null)
  await expectRun(2, null)
  await expectRun(3, 'auto_friendly')
  await expectRun(3, null) // same day again: no duplicate
  await expectRun(6, null)
  await expectRun(9, null)
  await expectRun(10, 'auto_firm')
  await expectRun(10, null)
  await expectRun(11, null)
  await expectRun(25, null)
  let rows = await reminderRows(bookingId)
  check('exactly two automatic reminders logged (friendly, then firm)', rows.map((row) => `${row.kind}:${row.status}`).join(',') === 'auto_friendly:sent,auto_firm:sent', rows.map((row) => `${row.kind}:${row.status}`).join(','))
  check('friendly logged at day 3, firm at day 10', rows[0]?.days_overdue === 3 && rows[1]?.days_overdue === 10)

  const arrears = await api('/api/invoices/arrears')
  const payer = (arrears.body.payers || []).find((item) => item.key === `school:${schoolId}`)
  const listed = payer?.invoices.find((item) => item.id === bookingId)
  check('arrears lists the school with the invoice', Boolean(listed), `HTTP ${arrears.status} ${arrears.body.error || ''}`)
  check('arrears amount is the discounted total (£108.00)', listed?.amountPence === 10800, String(listed?.amountPence))
  check('arrears shows 25 days overdue', listed?.daysOverdue === 25 && payer?.maxDaysOverdue === 25)
  check('arrears flags "needs personal follow-up" past day 10', listed?.needsFollowUp === true && payer?.needsFollowUp === true)
  check('arrears counts 2 reminders sent', listed?.remindersSent === 2)

  // 3. Manual reminder, any time.
  const manual = await api(`/api/invoices/${bookingId}/remind`, { method: 'POST', body: JSON.stringify({ template: 'firm' }) })
  check('manual reminder sends', manual.status === 200 && manual.body.recipient === RECIPIENT, `HTTP ${manual.status} ${manual.body.error || ''}`)
  rows = await reminderRows(bookingId)
  check('manual reminder logged (3 reminders total)', rows.length === 3 && rows[2].kind === 'manual' && rows[2].sent_by === testUserId)
  for (const row of rows) {
    const resend = await fetch(`https://api.resend.com/emails/${row.resend_id}`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } }).then((response) => response.json()).catch(() => ({}))
    check(`Resend accepted the ${row.kind} email`, Boolean(resend.id) && resend.to?.includes(RECIPIENT), `${resend.last_event || resend.message || 'no status'} · "${resend.subject || ''}"`)
  }
  const unauth = await fetch(`${serverBase}/api/invoices/${bookingId}/remind`, { method: 'POST' })
  check('reminder endpoint rejects unauthenticated requests', unauth.status === 401)

  // 4. Pay now.
  const page = await fetch(`${serverBase}/api/invoices/pay/${payToken}`)
  const pageHtml = await page.text()
  check('pay page shows the invoice total', page.status === 200 && pageHtml.includes('£108.00') && pageHtml.includes(`TEST-ARREARS-${stamp}`))
  const badPage = await fetch(`${serverBase}/api/invoices/pay/${'0'.repeat(32)}`)
  check('unknown pay token is a 404', badPage.status === 404)
  const pdf = await fetch(`${serverBase}/api/invoices/pdf/${bookingId}`, { headers: { Authorization: `Bearer ${token}` } })
  const pdfText = Buffer.from(await pdf.arrayBuffer()).toString('latin1')
  check('invoice PDF carries the Pay now link', pdf.status === 200 && pdfText.includes(`/api/invoices/pay/${payToken}`))

  const checkout = await fetch(`${serverBase}/api/invoices/pay/${payToken}`, { method: 'POST', redirect: 'manual' })
  const checkoutUrl = checkout.headers.get('location') || ''
  check('Pay button redirects to Stripe Checkout', checkout.status === 303 && checkoutUrl.startsWith('https://checkout.stripe.com/'), `HTTP ${checkout.status}`)
  const sessionId = checkoutUrl.match(/(cs_test_[A-Za-z0-9]+)/)?.[1]
  let session = sessionId ? await stripe.checkout.sessions.retrieve(sessionId) : null
  check('Checkout charges exactly £108.00 GBP', session?.amount_total === 10800 && session?.currency === 'gbp', String(session?.amount_total))
  check('Checkout is tagged as this invoice', session?.metadata?.kind === 'invoice_payment' && session?.metadata?.invoice_booking_id === bookingId)
  if (!session) return

  console.log(`\nPay this Checkout with card 4242 4242 4242 4242 (any future date, any CVC):\n${checkoutUrl}\nWaiting up to 5 minutes…`)
  const deadline = Date.now() + 5 * 60000
  while (session.payment_status !== 'paid' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000))
    session = await stripe.checkout.sessions.retrieve(sessionId)
  }
  check('Checkout was paid', session.payment_status === 'paid', session.payment_status)
  if (session.payment_status !== 'paid') return

  // The registered webhook is the deployed site; hand Stripe's real event to this server.
  let event = null
  for (let attempt = 0; attempt < 10 && !event; attempt += 1) {
    const events = await stripe.events.list({ type: 'checkout.session.completed', limit: 20 })
    event = events.data.find((item) => item.data.object.id === sessionId) || null
    if (!event) await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  check('Stripe emitted checkout.session.completed', Boolean(event), event?.id)
  if (!event) return
  const delivery = await signedWebhook(event)
  check('webhook accepts the payment', delivery.status === 200, `HTTP ${delivery.status}`)

  const { data: paid } = await service.from('bookings').select('*').eq('id', bookingId).single()
  check('invoice marked Paid', paid.invoice_status === 'Paid' && paid.payment_status === 'paid')
  check('payment recorded (time, amount, Stripe session)', Boolean(paid.invoice_paid_at) && paid.invoice_paid_amount_pence === 10800 && paid.invoice_payment_session_id === sessionId)

  const redelivery = await signedWebhook(event)
  const { data: afterRedelivery } = await service.from('bookings').select('invoice_paid_at').eq('id', bookingId).single()
  check('redelivered webhook is a no-op', redelivery.status === 200 && afterRedelivery.invoice_paid_at === paid.invoice_paid_at)

  // The Operations client saves every booking row with upsert; a tab opened before
  // the payment would send the old 'Sent' status.
  await service.from('bookings').upsert({ id: bookingId, school_id: schoolId, contact_name: 'Test Contact', contact_email: RECIPIENT, date: paid.date, session_type: paid.session_type, price: 120, student_count: 30, status: 'Confirmed', invoice_status: 'Sent', invoice_number: paid.invoice_number, notes: paid.notes }, { onConflict: 'id' })
  const { data: afterStale } = await service.from('bookings').select('invoice_status').eq('id', bookingId).single()
  check('stale client save cannot flip a Stripe-paid invoice back to Sent', afterStale.invoice_status === 'Paid', afterStale.invoice_status)

  const donePage = await (await fetch(`${serverBase}/api/invoices/pay/${payToken}/done?session_id=${sessionId}`)).text()
  check('success page confirms payment', donePage.includes('Payment received'))
  const paidPage = await (await fetch(`${serverBase}/api/invoices/pay/${payToken}`)).text()
  check('pay link now says already paid', paidPage.includes('Already paid'))
  const payAgain = await fetch(`${serverBase}/api/invoices/pay/${payToken}`, { method: 'POST', redirect: 'manual' })
  check('paid invoice cannot start another Checkout', payAgain.status === 200 && (await payAgain.text()).includes('Already paid'))

  const arrearsAfter = await api('/api/invoices/arrears')
  check('paid invoice leaves the arrears list', !(arrearsAfter.body.payers || []).some((item) => item.invoices.some((invoice) => invoice.id === bookingId)))
  const afterPaidRun = await runCheck('after payment')
  check('no reminders for a paid invoice', afterPaidRun.length === 0)

  // 6. No automatic consequences.
  check('booking status never changed (still Confirmed)', paid.status === 'Confirmed')
}
