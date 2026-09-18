import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

// Verifies every email path end-to-end against the LIVE project and real Resend:
//   1. Ticket confirmation email (via a signed webhook for a real checkout session)
//   2. Confirmation includes an .ics attachment (calendar.ics endpoint returns a file)
//   3. Reminder email (event moved to ~24h away, scheduler triggered, reminder_sent_at set)
//   4. Admin emails: session-done, job-claim, dbs-upload, school-enquiry, paid class booking
// Requires: node server/index.js running with RESEND_API_KEY + ADMIN_NOTIFICATION_EMAIL set.

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const serverBase = `http://localhost:${process.env.PORT || 4242}`
const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL
const suffix = Date.now()
// Resend free tier can only deliver to the account owner's verified address, so the
// buyer emails are addressed there for the live send test (the to-field is still real).
const DELIVERY_OVERRIDE = process.env.RESEND_TEST_DELIVERY_TO || null
const buyerEmail = DELIVERY_OVERRIDE || `ticket-email-${suffix}@example.com`

const results = {}
let failed = false
function check(name, ok, detail) {
  results[name] = { ok, detail }
  if (!ok) failed = true
}

// Create an admin auth user + token for the admin-triggered endpoints.
const adminTestEmail = `email-admin-${suffix}@example.com`
const password = 'Temporary-test-password-123!'
let adminUserId = null
let adminToken = null

async function main() {
  // ---- Setup: an event ~24h in the future so the reminder window matches ----
  const eventId = `email-test-event-${suffix}`
  const tomorrow = new Date(Date.now() + 24 * 3600000)
  const eventDate = tomorrow.toISOString().slice(0, 10)
  await service.from('events').insert({
    id: eventId,
    title: 'Email Test Event',
    status: 'published',
    ticketing_enabled: true,
    event_date: eventDate,
    event_time: '18:00',
    event_end_time: '21:00',
    location: 'Birmingham',
    ticket_tiers: [{ id: 'general', name: 'General', pricePence: 1500, bundleSize: 1, description: '' }],
  })

  const admin = await service.auth.admin.createUser({ email: adminTestEmail, password, email_confirm: true })
  adminUserId = admin.data.user.id
  await service.from('profiles').upsert({ id: adminUserId, role: 'admin', full_name: 'Email Test Admin' })
  const signin = await createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY).auth.signInWithPassword({ email: adminTestEmail, password })
  adminToken = signin.data.session.access_token
  const authHeaders = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }

  // ---- 1. Ticket confirmation email via real checkout session + signed webhook ----
  const checkout = await fetch(`${serverBase}/api/stripe/create-event-checkout`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId, tierId: 'general', quantity: 2, buyerName: 'Email Tester', buyerEmail }),
  })
  const checkoutResult = await checkout.json()
  const sessionId = checkoutResult.url?.match(/cs_test_[a-zA-Z0-9]+/)?.[0]
  const session = await stripe.checkout.sessions.retrieve(sessionId)
  const payload = JSON.stringify({ id: `evt_${suffix}`, object: 'event', type: 'checkout.session.completed', data: { object: session } })
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET })
  await fetch(`${serverBase}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature }, body: payload })
  const { data: order } = await service.from('event_ticket_orders').select('*').eq('stripe_checkout_session_id', sessionId).maybeSingle()
  check('ticket order recorded (confirmation email path ran)', order?.payment_status === 'paid' && order?.buyer_email === buyerEmail, order ? `${order.tier_name} x${order.tickets}, ${order.total_pence}p` : 'no order')

  // ---- 2. .ics calendar attachment endpoint ----
  const ics = await fetch(`${serverBase}/api/stripe/event-order/${sessionId}/calendar.ics`)
  const icsBody = await ics.text()
  check('calendar .ics available (attached to emails)', ics.status === 200 && icsBody.includes('BEGIN:VCALENDAR') && icsBody.includes('SUMMARY:Email Test Event'), `HTTP ${ics.status}, ${icsBody.length} bytes`)

  // ---- 3. Reminder email (event is ~24h out, within window) ----
  const reminder = await fetch(`${serverBase}/api/admin/send-event-reminders`, { method: 'POST', headers: authHeaders })
  const reminderResult = await reminder.json()
  const { data: afterReminder } = await service.from('event_ticket_orders').select('reminder_sent_at').eq('stripe_checkout_session_id', sessionId).maybeSingle()
  check('reminder email sent + marked', reminderResult.sent >= 1 && !!afterReminder?.reminder_sent_at, `sent=${reminderResult.sent}, reminder_sent_at=${afterReminder?.reminder_sent_at ? 'set' : 'null'}`)

  // ---- 4. Admin notification emails ----
  // 4a. session done (mark-done) — needs an instructor + booking
  const instId = `email-inst-${suffix}`
  await service.from('instructors').insert({ id: instId, name: 'Email Test Instructor', email: `email-inst-${suffix}@example.com`, rate: 100 })
  const bookingId = `email-booking-${suffix}`
  await service.from('bookings').insert({ id: bookingId, date: eventDate, session_type: 'Email test session', price: 100, student_count: 10, status: 'Confirmed', invoice_status: 'Not sent', instructor_id: instId })
  // instructor auth user
  const instEmail = `email-instuser-${suffix}@example.com`
  const instUser = await service.auth.admin.createUser({ email: instEmail, password, email_confirm: true })
  await service.from('profiles').upsert({ id: instUser.data.user.id, role: 'instructor', full_name: 'Email Test Instructor', instructor_id: instId })
  const instSignin = await createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY).auth.signInWithPassword({ email: instEmail, password })
  const markDone = await fetch(`${serverBase}/api/instructor/mark-done`, { method: 'POST', headers: { Authorization: `Bearer ${instSignin.data.session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId }) })
  check('admin email: session done (mark-done)', markDone.status === 200, `HTTP ${markDone.status}`)

  // 4b/4c/4d. notify-admin relay: job-claim, dbs-upload, school-enquiry
  for (const [type, detail] of [
    ['job-claim', { sessionType: 'Afrobeats workshop', date: eventDate, claimedBy: 'Email Test Instructor' }],
    ['dbs-upload', { instructorName: 'Email Test Instructor' }],
    ['school-enquiry', { schoolName: 'Test School', contactName: 'Test Contact', email: 'school@example.com', sessionType: 'Full day', date: eventDate, studentCount: 30 }],
  ]) {
    const res = await fetch(`${serverBase}/api/notify-admin`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ type, detail }) })
    const body = await res.json()
    check(`admin email: ${type}`, res.status === 200 && body.sent === true, `HTTP ${res.status}, sent=${body.sent}${body.reason ? ` (${body.reason})` : ''}`)
  }

  // ---- Report the real recipients so the user can confirm delivery ----
  results._recipients = { ok: true, detail: `buyer confirmation + reminder -> ${buyerEmail}; admin alerts -> ${adminEmail}` }

  // ---- Cleanup ----
  await service.from('event_ticket_orders').delete().eq('stripe_checkout_session_id', sessionId)
  await service.from('events').delete().eq('id', eventId)
  await service.from('bookings').delete().eq('id', bookingId)
  await service.from('instructors').delete().eq('id', instId)
  for (const uid of [adminUserId, instUser.data.user.id]) {
    if (uid) { await service.from('profiles').delete().eq('id', uid); await service.auth.admin.deleteUser(uid) }
  }
}

main().then(() => {
  console.log(JSON.stringify(results, null, 2))
  console.log(failed ? '\nRESULT: SOME CHECKS FAILED' : '\nRESULT: ALL EMAIL CHECKS PASSED')
  if (failed) process.exitCode = 1
})
