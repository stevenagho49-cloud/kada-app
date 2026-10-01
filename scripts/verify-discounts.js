import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

// End-to-end check of discount codes and invoice discounts against the LIVE
// Supabase project, Stripe TEST mode and Resend. Everything it creates is
// temporary and removed at the end (codes, Stripe coupons, event, bookings,
// families, orders, contacts, accounts).
//   1. Codes: admin creates a % code, a £ code and a 100% code; edits one;
//      non-admins can't list codes; a deactivated or wrong-scope code is refused
//   2. Class and event checkouts: the real Stripe Checkout total for each code
//   3. 100% off: a free class booking (day pass and membership) and a free
//      ticket order are recorded properly with no Stripe charge, and emailed
//   4. School booking: a school's code lands on its invoice as a £ discount
//   5. Invoice discounts: a fixed £ and a % discount on an invoice, checked in the
//      PDF text, the Pay now page and the Stripe Checkout amount
// Set PDF_DIR to keep the generated invoice PDFs; PYPDF_PATH points python at pypdf.
//
// Requires: node server/index.js running on PORT (default 4242).

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anonClient = () => createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const serverBase = `http://localhost:${process.env.PORT || 4242}`
const stamp = Date.now()
const tag = String(stamp).slice(-6)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures += 1
}
const api = (path, { token, method = 'POST', body } = {}) => fetch(`${serverBase}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => ({})), headers: response.headers }))

const cleanup = { users: [], schools: [], bookings: [], families: [], events: [], codes: [], contacts: [] }
const codeName = { pct: `VPCT${tag}`, fix: `VFIX${tag}`, free: `VFREE${tag}`, eventOnly: `VEVT${tag}` }

async function tempUser({ email, role, profile }) {
  const password = `Verify-${stamp}-${Math.random().toString(36).slice(2)}`
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: 'staff', full_name: email }, app_metadata: { signup_notified_at: new Date().toISOString() } })
  if (error) throw error
  cleanup.users.push(data.user.id)
  await service.from('profiles').update({ role, full_name: email, ...(profile || {}) }).eq('id', data.user.id)
  const client = anonClient()
  const { data: signIn } = await client.auth.signInWithPassword({ email, password })
  return { id: data.user.id, client, token: signIn.session.access_token }
}

const sessionIdFrom = (url) => /\/(cs_test_[A-Za-z0-9]+)/.exec(url || '')?.[1] || ''
async function stripeTotals(url) {
  const session = await stripe.checkout.sessions.retrieve(sessionIdFrom(url), { expand: ['total_details.breakdown'] })
  return session
}

function pdfText(buffer, name) {
  const dir = process.env.PDF_DIR || '/tmp'
  mkdirSync(dir, { recursive: true })
  const file = `${dir}/${name}.pdf`
  writeFileSync(file, buffer)
  return execFileSync('python3', ['-c', 'import sys, pypdf; print("\\n".join(page.extract_text() for page in pypdf.PdfReader(sys.argv[1]).pages))', file], { env: { ...process.env, PYTHONPATH: process.env.PYPDF_PATH || '' } }).toString()
}

async function run() {
  const admin = await tempUser({ email: `discount-admin-${stamp}@example.com`, role: 'admin' })
  const { data: savedCodes } = await service.from('app_settings').select('value').eq('key', 'discount_codes').maybeSingle()
  cleanup.originalCodes = savedCodes?.value?.codes || []

  // 1. Codes.
  const create = (body) => api('/api/admin/discount-codes', { token: admin.token, body })
  const pct = await create({ code: codeName.pct.toLowerCase(), description: 'Verify percentage', appliesTo: ['class', 'event', 'school'], type: 'percent', value: 15 })
  check('Admin creates a percentage code (stored upper-case)', pct.status === 200 && pct.body.code?.code === codeName.pct, pct.body.error)
  const fix = await create({ code: codeName.fix, appliesTo: ['class', 'event', 'school'], type: 'amount', value: 3 })
  check('Admin creates a fixed-amount code', fix.status === 200 && fix.body.code?.amountOffPence === 300, fix.body.error)
  const free = await create({ code: codeName.free, appliesTo: ['class', 'event', 'school'], type: 'percent', value: 100, membershipDuration: 'forever' })
  check('Admin creates a 100% code', free.status === 200 && free.body.code?.percentOff === 100, free.body.error)
  const eventOnly = await create({ code: codeName.eventOnly, appliesTo: ['event'], type: 'percent', value: 50 })
  cleanup.codes.push(pct.body.code?.id, fix.body.code?.id, free.body.code?.id, eventOnly.body.code?.id)
  const edited = await create({ id: pct.body.code?.id, value: 20 })
  check('Admin edits the percentage to any value (15% → 20%)', edited.status === 200 && edited.body.code?.percentOff === 20, edited.body.error)
  const duplicate = await create({ code: codeName.fix, appliesTo: ['class'], type: 'percent', value: 5 })
  check('Duplicate code names are refused', duplicate.status === 409)
  const tooBig = await create({ code: `VBAD${tag}`, appliesTo: ['class'], type: 'percent', value: 101 })
  check('Percentages over 100 are refused', tooBig.status === 400)

  const school = await tempUser({ email: `discount-school-${stamp}@example.com`, role: 'school' })
  const listAsSchool = await api('/api/admin/discount-codes', { token: school.token, method: 'GET' })
  check('A non-admin cannot list discount codes', listAsSchool.status === 403)

  const checkCode = (code, scope, extra) => api('/api/discount-codes/check', { body: { code, scope, ...extra } })
  const wrongScope = await checkCode(codeName.eventOnly, 'class', { planType: 'day_pass' })
  check('An event-only code is refused on a class booking', wrongScope.status === 400, wrongScope.body.error)

  // 2. Class checkouts: the real Stripe totals.
  const parentEmail = `delivered+discount-parent-${stamp}@resend.dev`
  const classBody = (planType, code, students = [{ name: 'Discount Verify Child', dateOfBirth: '2017-05-05' }]) => ({ planType, className: 'Saturday Gospel Afrobeats', classDate: nextSaturday(), parentName: `Discount Verify ${tag}`, parentEmail, students, discountCode: code })
  for (const [label, planType, code, expected] of [
    ['Day pass £10 with 20% code', 'day_pass', codeName.pct, 800],
    ['Day pass £10 with £3 code', 'day_pass', codeName.fix, 700],
    ['Membership £25 with 20% code (first month)', 'monthly_membership', codeName.pct, 2000],
    ['Membership £25 with £3 code (first month)', 'monthly_membership', codeName.fix, 2200],
  ]) {
    const preview = await checkCode(code, 'class', { planType })
    const started = await api('/api/stripe/create-checkout-session', { body: classBody(planType, code) })
    if (started.status !== 200) { check(`${label}: checkout starts`, false, started.body.error); continue }
    const session = await stripeTotals(started.body.url)
    check(`${label}: Stripe Checkout total £${(expected / 100).toFixed(2)}`, session.amount_total === expected && preview.body.totalPence === expected, `Stripe ${session.amount_subtotal}→${session.amount_total}, discount ${session.total_details?.amount_discount}, preview ${preview.body.totalPence}`)
    const { data: pending } = await service.from('bookings').select('id,family_id,price,payment_status').eq('id', session.metadata.booking_id).single()
    cleanup.bookings.push(pending.id)
    cleanup.families.push(pending.family_id)
    check(`${label}: pending booking records the discounted price`, Math.round(Number(pending.price) * 100) === expected && pending.payment_status === 'pending')
  }

  // Deactivate the £ code: refused at the price check and at checkout.
  await create({ id: fix.body.code?.id, active: false })
  const offCheck = await checkCode(codeName.fix, 'class', { planType: 'day_pass' })
  const offCheckout = await api('/api/stripe/create-checkout-session', { body: classBody('day_pass', codeName.fix) })
  check('A switched-off code is refused (check and checkout)', offCheck.status === 400 && offCheckout.status === 400, offCheckout.body.error)
  await create({ id: fix.body.code?.id, active: true })

  // 2b. Event checkouts on a temporary published event.
  const eventId = `discount-event-${stamp}`
  cleanup.events.push(eventId)
  const { error: eventError } = await service.from('events').insert({ id: eventId, title: `Discount Verify Event ${tag}`, event_date: inDays(40), event_time: '18:00', location: 'Verify venue', status: 'published', ticketing_enabled: true, show_on_homepage: false, ticket_tiers: [{ id: 'adult', name: 'Adult', bundleSize: 1, pricePence: 1000 }, { id: 'family', name: 'Family of 4', bundleSize: 4, pricePence: 1899 }] })
  if (eventError) throw new Error(`Temporary event: ${eventError.message}`)
  const buyerEmail = `delivered+discount-buyer-${stamp}@resend.dev`
  cleanup.contacts.push(buyerEmail)
  const ticketBody = (tierId, quantity, code) => ({ eventId, tierId, quantity, buyerName: `Discount Buyer ${tag}`, buyerEmail, attendeeNames: [], discountCode: code })
  for (const [label, tierId, quantity, code, expected] of [
    ['3 × £10 tickets with 20% code', 'adult', 3, codeName.pct, 2400],
    ['3 × £10 tickets with £3 code', 'adult', 3, codeName.fix, 2700],
    ['2 × £18.99 family tickets with 20% code', 'family', 2, codeName.pct, 3038],
    ['3 × £10 tickets with the event-only 50% code', 'adult', 3, codeName.eventOnly, 1500],
  ]) {
    const preview = await checkCode(code, 'event', { eventId, tierId, quantity })
    const started = await api('/api/stripe/create-event-checkout', { body: ticketBody(tierId, quantity, code) })
    if (started.status !== 200) { check(`${label}: checkout starts`, false, started.body.error); continue }
    const session = await stripeTotals(started.body.url)
    check(`${label}: Stripe Checkout total £${(expected / 100).toFixed(2)}`, session.amount_total === expected && preview.body.totalPence === expected && session.metadata.total_pence === String(expected), `Stripe ${session.amount_subtotal}→${session.amount_total}, preview ${preview.body.totalPence}`)
  }

  // 3. 100% off: recorded without Stripe.
  const alertSince = Date.now()
  const freeDayPass = await api('/api/stripe/create-checkout-session', { body: classBody('day_pass', codeName.free, [{ name: 'Free Verify One', dateOfBirth: '2015-01-10' }, { name: 'Free Verify Two', dateOfBirth: '2018-08-18' }]) })
  check('Free day pass: no Stripe, goes straight to the confirmation', freeDayPass.status === 200 && freeDayPass.body.free === true && /payment=success&session_id=free-/.test(freeDayPass.body.url), freeDayPass.body.error)
  const freeSessionId = /session_id=(free-[\w-]+)/.exec(freeDayPass.body.url || '')?.[1]
  const { data: freeBooking } = await service.from('bookings').select('*').eq('stripe_checkout_session_id', freeSessionId).maybeSingle()
  if (freeBooking) { cleanup.bookings.push(freeBooking.id); cleanup.families.push(freeBooking.family_id) }
  check('Free day pass: booking is Confirmed and paid at £0', freeBooking?.status === 'Confirmed' && freeBooking.payment_status === 'paid' && Number(freeBooking.price) === 0 && freeBooking.student_count === 2, freeBooking ? `${freeBooking.status}/${freeBooking.payment_status}/£${freeBooking.price}/${freeBooking.student_count} children; notes: ${freeBooking.notes}` : 'missing')
  const { data: freeStudents } = await service.from('students').select('name,membership_status').eq('booking_id', freeBooking?.id)
  check('Free day pass: both children are active', freeStudents?.length === 2 && freeStudents.every((student) => student.membership_status === 'active'))
  const lookup = await fetch(`${serverBase}/api/stripe/class-booking/${freeSessionId}`).then((response) => response.json())
  check('Free day pass: the confirmation screen finds the booking', lookup.status === 'paid' && lookup.booking?.pricePence === 0)
  const freeMember = await api('/api/stripe/create-checkout-session', { body: { ...classBody('monthly_membership', codeName.free), parentEmail: `delivered+discount-member-${stamp}@resend.dev` } })
  const memberSession = /session_id=(free-[\w-]+)/.exec(freeMember.body.url || '')?.[1]
  const { data: memberBooking } = await service.from('bookings').select('*').eq('stripe_checkout_session_id', memberSession).maybeSingle()
  if (memberBooking) { cleanup.bookings.push(memberBooking.id); cleanup.families.push(memberBooking.family_id) }
  const { data: memberFamily } = memberBooking ? await service.from('parent_families').select('*').eq('id', memberBooking.family_id).single() : { data: null }
  check('Free membership (100% every month): booking and active membership, no Stripe subscription', freeMember.body.free === true && memberBooking?.payment_status === 'paid' && memberFamily?.membership_status === 'active' && memberFamily.plan_type === 'monthly_membership' && !memberFamily.stripe_subscription_id)

  const freeTickets = await api('/api/stripe/create-event-checkout', { body: ticketBody('adult', 2, codeName.free) })
  const ticketSession = /session_id=(free-[\w-]+)/.exec(freeTickets.body.url || '')?.[1]
  const { data: freeOrder } = await service.from('event_ticket_orders').select('*').eq('stripe_checkout_session_id', ticketSession).maybeSingle()
  check('Free tickets: order recorded as paid at £0 with 2 tickets', freeTickets.body.free === true && freeOrder?.payment_status === 'paid' && freeOrder.total_pence === 0 && freeOrder.tickets === 2)
  const orderLookup = await fetch(`${serverBase}/api/stripe/event-order/${ticketSession}`).then((response) => response.json())
  check('Free tickets: the success page finds the order', orderLookup.status === 'paid' && orderLookup.order?.totalPence === 0)
  await sleep(4000)
  const recent = (await fetch('https://api.resend.com/emails?limit=40', { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } }).then((response) => response.json())).data || []
  const sinceOk = (email) => Date.parse(email.created_at.replace(' ', 'T').replace(/\+00$/, 'Z')) >= alertSince - 5000
  check('Free booking: parent confirmation email sent', recent.some((email) => sinceOk(email) && email.to.includes(parentEmail) && email.subject.startsWith('Booking confirmed')))
  check('Free booking: admin alert says it was free with a code', recent.some((email) => sinceOk(email) && email.subject === '[KADA] New class booking (free with discount code)'))
  check('Free tickets: buyer confirmation email sent', recent.some((email) => sinceOk(email) && email.to.includes(buyerEmail) && email.subject.startsWith('Your tickets')))

  // 4. School booking with a code → discount on the invoice.
  const schoolId = `discount-school-${stamp}`
  cleanup.schools.push(schoolId)
  await service.from('schools').insert({ id: schoolId, name: `Discount Verify School ${tag}`, contact_name: 'Verify Head', email: 'delivered@resend.dev' })
  await service.from('profiles').update({ school_id: schoolId }).eq('id', school.id)
  const enquiryId = `discount-enquiry-${stamp}`
  cleanup.bookings.push(enquiryId)
  const { error: enquiryError } = await school.client.from('bookings').insert({ id: enquiryId, school_id: schoolId, contact_name: 'Verify Head', contact_email: 'delivered@resend.dev', date: inDays(45), session_type: 'Half day', price: 260, student_count: 28, status: 'Enquiry', invoice_status: 'Not sent', requested_by: school.id })
  check('School files an enquiry (RLS)', !enquiryError, enquiryError?.message)
  const schoolPreview = await checkCode(codeName.fix, 'school', { subtotalPence: 26000 })
  const applied = await api('/api/discount-codes/apply-booking', { token: school.token, body: { bookingId: enquiryId, code: codeName.fix } })
  check('School applies the £3 code to its booking', applied.status === 200 && schoolPreview.body.totalPence === 25700, applied.body.error)
  const otherSchool = await tempUser({ email: `discount-school2-${stamp}@example.com`, role: 'school' })
  const notTheirs = await api('/api/discount-codes/apply-booking', { token: otherSchool.token, body: { bookingId: enquiryId, code: codeName.pct } })
  check("Another school can't apply a code to that booking", notTheirs.status === 403)
  await service.from('bookings').update({ status: 'Confirmed' }).eq('id', enquiryId)
  const schoolPdf = await fetch(`${serverBase}/api/invoices/pdf/${enquiryId}`, { headers: { Authorization: `Bearer ${admin.token}` } })
  const schoolText = pdfText(Buffer.from(await schoolPdf.arrayBuffer()), `school-code-${tag}`)
  check('School invoice PDF shows the code discount and £257.00 due', schoolText.includes(`Discount ${codeName.fix} (£3.00 off)`) && schoolText.includes('-£3.00') && /Total due\s*£257\.00/.test(schoolText), schoolText.replace(/\s+/g, ' ').match(/Subtotal.*?Total due\s*£[\d.]+/)?.[0])

  // 5. One-off invoice discounts.
  const invoiceId = `discount-invoice-${stamp}`
  cleanup.bookings.push(invoiceId)
  await service.from('bookings').insert({ id: invoiceId, school_id: schoolId, contact_name: 'Verify Head', contact_email: 'delivered@resend.dev', date: inDays(50), session_type: 'Full day (£490)', price: 490, student_count: 40, status: 'Confirmed', invoice_status: 'Not sent' })
  const saveFixed = await api(`/api/invoices/${invoiceId}/overrides`, { token: admin.token, body: { overrides: { discountType: 'amount', discountAmount: 40 } } })
  check('Invoice: £40 off saved, total £450.00', saveFixed.status === 200 && saveFixed.body.amountPence === 45000, saveFixed.body.error)
  const fixedText = pdfText(Buffer.from(await (await fetch(`${serverBase}/api/invoices/pdf/${invoiceId}`, { headers: { Authorization: `Bearer ${admin.token}` } })).arrayBuffer()), `invoice-fixed-${tag}`)
  check('Invoice PDF (saved £40 off): subtotal £490.00, -£40.00, total £450.00', fixedText.includes('Discount (£40.00 off)') && fixedText.includes('-£40.00') && /Total due\s*£450\.00/.test(fixedText))
  const savePct = await api(`/api/invoices/${invoiceId}/overrides`, { token: admin.token, body: { overrides: { discountType: 'percent', discountPercent: 12.5 } } })
  check('Invoice: 12.5% off saved, total £428.75', savePct.status === 200 && savePct.body.amountPence === 42875, savePct.body.error)
  const { data: invoiceRow } = await service.from('bookings').select('*').eq('id', invoiceId).single()
  const sent = await api('/api/invoices/send', { token: admin.token, body: { booking: { id: invoiceId, status: 'Confirmed', date: invoiceRow.date, sessionType: invoiceRow.session_type, price: 490, studentCount: 40, contactName: 'Verify Head', contactEmail: 'delivered@resend.dev', invoiceOverrides: invoiceRow.invoice_overrides }, school: { name: `Discount Verify School ${tag}`, contactName: 'Verify Head', email: 'delivered@resend.dev' } } })
  check('Invoice with 12.5% discount sent (Resend)', sent.status === 200, sent.body.error)
  const { data: sentRow } = await service.from('bookings').select('invoice_pay_token,invoice_overrides,invoice_status').eq('id', invoiceId).single()
  const pctText = pdfText(Buffer.from(await (await fetch(`${serverBase}/api/invoices/pdf/${invoiceId}`, { headers: { Authorization: `Bearer ${admin.token}` } })).arrayBuffer()), `invoice-percent-${tag}`)
  check('Invoice PDF (12.5%): -£61.25, total £428.75, Pay £428.75 button', pctText.includes('Discount (12.5%)') && pctText.includes('-£61.25') && /Total due\s*£428\.75/.test(pctText) && pctText.includes('Pay £428.75 now'))
  const payPage = await fetch(`${serverBase}/api/invoices/pay/${sentRow.invoice_pay_token}`).then((response) => response.text())
  check('Pay now page asks for £428.75', payPage.includes('Pay £428.75'))
  const payStart = await fetch(`${serverBase}/api/invoices/pay/${sentRow.invoice_pay_token}`, { method: 'POST', redirect: 'manual' })
  const paySession = await stripe.checkout.sessions.retrieve(sessionIdFrom(payStart.headers.get('location')))
  check('Pay now opens Stripe Checkout for £428.75', paySession.amount_total === 42875 && paySession.metadata.invoice_booking_id === invoiceId, `${paySession.amount_total}`)
  const arrears = await api('/api/invoices/arrears', { token: admin.token, method: 'GET' })
  const owed = arrears.body.payers?.flatMap((payer) => payer.invoices).find((invoice) => invoice.id === invoiceId)
  check('Arrears shows the discounted £428.75', owed?.amountPence === 42875)
  const paidTry = await api(`/api/invoices/${invoiceId}/overrides`, { token: admin.token, body: { overrides: { discountType: 'percent', discountPercent: 0 } } })
  check('Invoice discount can still be edited while unpaid', paidTry.status === 200)
  await api(`/api/invoices/${invoiceId}/overrides`, { token: admin.token, body: { overrides: sentRow.invoice_overrides } })
}

function nextSaturday() {
  const today = new Date()
  const days = ((6 - today.getUTCDay() + 7) % 7) || 7
  return new Date(today.getTime() + days * 86400000).toISOString().slice(0, 10)
}

try {
  await run()
} catch (error) {
  failures += 1
  console.error('Verification aborted:', error.stack || error.message)
} finally {
  const { data: current } = await service.from('app_settings').select('value').eq('key', 'discount_codes').maybeSingle()
  const remaining = (current?.value?.codes || []).filter((code) => !cleanup.codes.includes(code.id))
  await service.from('app_settings').upsert({ key: 'discount_codes', value: { codes: remaining }, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  // Coupons made for this run's codes (ids are kada-<CODE>-<terms>-<duration>).
  for await (const coupon of stripe.coupons.list({ limit: 100 })) {
    if (coupon.id.startsWith('kada-') && coupon.id.includes(tag)) await stripe.coupons.del(coupon.id).catch(() => {})
  }
  const bookingIds = cleanup.bookings.filter(Boolean)
  await service.from('students').delete().in('booking_id', bookingIds)
  await service.from('invoice_reminders').delete().in('booking_id', bookingIds)
  await service.from('bookings').delete().in('id', bookingIds)
  await service.from('students').delete().in('family_id', cleanup.families.filter(Boolean))
  await service.from('parent_families').delete().in('id', cleanup.families.filter(Boolean))
  await service.from('event_ticket_orders').delete().in('event_id', cleanup.events)
  await service.from('events').delete().in('id', cleanup.events)
  await service.from('contacts').delete().in('email', cleanup.contacts.map((email) => email.toLowerCase()))
  for (const id of cleanup.users) {
    await service.from('profiles').delete().eq('id', id)
    await service.auth.admin.deleteUser(id)
  }
  await service.from('schools').delete().in('id', cleanup.schools)
  console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.')
  process.exit(failures ? 1 : 0)
}
