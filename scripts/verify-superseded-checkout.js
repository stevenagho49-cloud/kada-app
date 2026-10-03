import 'dotenv/config'
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

// Live check, against the LIVE Supabase project: a family with an unpaid class
// checkout (an Enquiry, payment 'pending', £75) completes a subscription
// request. The old checkout must become payment 'superseded' with a note, stay
// an Enquiry (history kept, children still on the register), refuse to be
// invoiced, and show "Covered by membership" on Bookings.
// The subscription completion is the real webhook handler fed a signed
// checkout.session.completed event (no card payment; nothing is charged).
// Everything is deleted at the end unless KEEP=1. Emails go to resend.dev
// test addresses, plus one "Subscription set up" alert to the admin inbox.
//
// Requires: node server/index.js on PORT (default 4242) serving a build of this
// code; PLAYWRIGHT_CORE=<path to playwright-core>.

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const serverBase = `http://localhost:${process.env.PORT || 4242}`
const CLASS = 'Saturday Gospel Afrobeats'
const stamp = Date.now()
const tag = String(stamp).slice(-6)
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
const familyId = `family-verify-supersede-${stamp}`
const bookingId = `parent-verify-supersede-${stamp}`
const parentEmail = `delivered+kada-supersede-${stamp}@resend.dev`

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures += 1
}
const cleanup = { users: [], requestId: '' }

async function run() {
  await service.from('parent_families').insert({ id: familyId, guardian_name: `Supersede Verify ${tag}`, guardian_email: parentEmail, membership_status: 'pending' })
  await service.from('bookings').insert({ id: bookingId, family_id: familyId, contact_name: `Supersede Verify ${tag}`, contact_email: parentEmail, date: today, session_type: CLASS, price: 75, student_count: 1, status: 'Enquiry', invoice_status: 'Not sent', payment_status: 'pending' })
  const kid = { id: `student-${bookingId}-1`, booking_id: bookingId, family_id: familyId, parent_name: `Supersede Verify ${tag}`, parent_email: parentEmail, name: `Kid Supersede${tag}`, date_of_birth: '2015-06-03', class_name: CLASS, term: today, membership_status: 'inactive' }
  await service.from('students').insert(kid)

  const email = `supersede-admin-${stamp}@example.com`
  const password = `Verify-${stamp}-admin!`
  const { data: created } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: 'admin', full_name: 'Supersede Verify Admin' }, app_metadata: { signup_notified_at: new Date().toISOString() } })
  cleanup.users.push(created.user.id)
  await service.from('profiles').update({ role: 'admin' }).eq('id', created.user.id)
  const session = (await createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password })).data.session
  const adminClient = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${session.access_token}` } } })

  const quote = await fetch(`${serverBase}/api/admin/subscription-requests/quote?familyId=${familyId}`, { headers: { Authorization: `Bearer ${session.access_token}` } }).then((response) => response.json())
  check('Subscription form counts the child from the unpaid checkout', quote.children === 1, JSON.stringify({ children: quote.children, error: quote.error }))

  const { data: request } = await service.from('subscription_requests').insert({ family_id: familyId, plan_type: 'monthly_membership', recipient: parentEmail, sent_by: created.user.id, status: 'sent' }).select('id').single()
  cleanup.requestId = request.id
  const payload = JSON.stringify({ id: `evt_verify_supersede_${stamp}`, object: 'event', type: 'checkout.session.completed', data: { object: { id: `cs_test_verify_${stamp}`, object: 'checkout.session', mode: 'subscription', subscription: `sub_verify_${stamp}`, customer: `cus_verify_${stamp}`, amount_total: 2500, customer_details: { email: parentEmail }, metadata: { kind: 'subscription_request', subscription_request_id: request.id, children: '1' } } } })
  const webhook = await fetch(`${serverBase}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET }) }, body: payload })
  check('Subscription request completed (webhook 200)', webhook.status === 200, `HTTP ${webhook.status}`)

  const { data: family } = await service.from('parent_families').select('membership_status').eq('id', familyId).single()
  const { data: booking } = await service.from('bookings').select('*').eq('id', bookingId).single()
  check('Family is now an active member', family.membership_status === 'active')
  check('Old checkout marked superseded, still an Enquiry, invoice still not sent', booking.payment_status === 'superseded' && booking.status === 'Enquiry' && booking.invoice_status === 'Not sent' && !booking.invoice_sent_at, `${booking.payment_status} / ${booking.status} / ${booking.invoice_status}`)
  check('…with a note saying no separate payment is due', /Superseded \d{4}-\d{2}-\d{2}: covered by the Monthly Membership.*No separate payment due\./.test(booking.notes || ''), booking.notes)

  const { data: roster } = await adminClient.rpc('attendance_roster', { p_class: CLASS, p_date: today })
  check('The child is still on the attendance register', (roster || []).some((row) => row.student_id === kid.id && row.registered))

  const invoice = await fetch(`${serverBase}/api/invoices/send`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ booking: { id: bookingId, status: 'Confirmed', contactEmail: parentEmail, contactName: 'x', sessionType: CLASS, price: 75 }, school: null }) })
  const invoiceBody = await invoice.json()
  const { data: after } = await service.from('bookings').select('invoice_status,invoice_sent_at,invoice_number').eq('id', bookingId).single()
  check('Sending an invoice for it is refused and nothing is stamped', invoice.status === 409 && /covered by the family's Monthly Membership/.test(invoiceBody.error) && after.invoice_status === 'Not sent' && !after.invoice_sent_at && !after.invoice_number, `HTTP ${invoice.status}: ${invoiceBody.error}`)

  const { chromium } = await import(process.env.PLAYWRIGHT_CORE)
  const root = `${process.env.HOME}/.cache/ms-playwright`
  const dir = fs.readdirSync(root).find((name) => /^chromium-\d+$/.test(name))
  const browser = await chromium.launch({ executablePath: `${root}/${dir}/${fs.readdirSync(`${root}/${dir}`).find((name) => name.startsWith('chrome-linux'))}/chrome` })
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
    await context.addInitScript(([name, value]) => window.localStorage.setItem(name, value), [`sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`, JSON.stringify(session)])
    const page = await context.newPage()
    await page.goto(`${serverBase}/#ops/bookings`)
    await page.getByPlaceholder('Search bookings').fill(`Supersede Verify ${tag}`)
    const row = page.locator('tr', { hasText: `Supersede Verify ${tag}` })
    await row.waitFor({ timeout: 30000 })
    const text = (await row.innerText()).replace(/\s+/g, ' ')
    check('Bookings list shows "Covered by membership" and no Invoice button', /covered by membership/i.test(text) && (await row.getByRole('button', { name: 'Invoice' }).count()) === 0, text.slice(0, 200))
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/superseded-bookings.png` })
  } finally {
    await browser.close()
  }
}

try {
  await run()
} catch (error) {
  failures += 1
  console.error('Verification aborted:', error.message)
} finally {
  if (process.env.KEEP === '1') {
    console.log(`\nKEEP=1: left family ${familyId} and booking ${bookingId}.`)
  } else {
    if (cleanup.requestId) await service.from('subscription_requests').delete().eq('id', cleanup.requestId)
    await service.from('students').delete().eq('family_id', familyId)
    await service.from('bookings').delete().eq('id', bookingId)
    await service.from('parent_families').delete().eq('id', familyId)
    for (const id of cleanup.users) await service.auth.admin.deleteUser(id) // eslint-disable-line no-await-in-loop
    console.log('\nCleaned up the test family, booking, child, request and admin login.')
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}
