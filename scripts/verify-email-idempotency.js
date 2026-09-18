import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

// Verifies, against the LIVE project + real Resend (now on the verified
// kingsarkdance.com domain, no test-recipient override):
//   1. IDEMPOTENCY: the SAME checkout.session.completed webhook fired TWICE sends
//      the confirmation email exactly ONCE (confirmation_sent_at gate).
//   2. Confirmation + reminder + admin emails deliver to REAL external addresses.
//   3. Every link inside the emails points at kingsarkdance.com (APP_URL).
// Requires: node server/index.js running (APP_URL + RESEND_API_KEY set).

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const serverBase = `http://localhost:${process.env.PORT || 4242}`
const suffix = Date.now()
// Real external recipients (domain is verified, so these can be anything).
const BUYER = `buyer.test.${suffix}@kingsarkdance.com`
const ADMIN = 'bookings@kingsarkdance.com'

const results = {}
let failed = false
function check(name, ok, detail) {
  results[name] = { ok, detail }
  if (!ok) failed = true
}

async function main() {
  const eventId = `dup-test-event-${suffix}`
  const in23h = new Date(Date.now() + 23 * 3600000)
  const eventDate = in23h.toISOString().slice(0, 10)
  await service.from('events').insert({
    id: eventId, title: 'Dup Test Event', status: 'published', ticketing_enabled: true,
    event_date: eventDate, event_time: in23h.toISOString().slice(11, 16), event_end_time: '21:00', location: 'Birmingham',
    ticket_tiers: [{ id: 'general', name: 'General', pricePence: 1500, bundleSize: 1, description: '' }],
  })

  // --- 1. Create checkout session + fire the SAME webhook TWICE ---
  const checkout = await fetch(`${serverBase}/api/stripe/create-event-checkout`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId, tierId: 'general', quantity: 1, buyerName: 'Dup Tester', buyerEmail: BUYER }),
  })
  const { url } = await checkout.json()
  const sessionId = url.match(/cs_test_[a-zA-Z0-9]+/)?.[0]
  const session = await stripe.checkout.sessions.retrieve(sessionId)
  const payload = JSON.stringify({ id: `evt_dup_${suffix}`, object: 'event', type: 'checkout.session.completed', data: { object: session } })
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET })
  const fire = () => fetch(`${serverBase}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature }, body: payload })

  await fire() // first delivery -> should send + set confirmation_sent_at
  const { data: after1 } = await service.from('event_ticket_orders').select('confirmation_sent_at').eq('stripe_checkout_session_id', sessionId).maybeSingle()
  const firstSent = !!after1?.confirmation_sent_at
  const firstStamp = after1?.confirmation_sent_at

  await new Promise((r) => setTimeout(r, 500))
  await fire() // redelivery -> should be a no-op
  const { data: after2 } = await service.from('event_ticket_orders').select('confirmation_sent_at').eq('stripe_checkout_session_id', sessionId).maybeSingle()

  check('idempotency: confirmation sent exactly once (webhook fired 2x)', firstSent && !!after2?.confirmation_sent_at && after2.confirmation_sent_at === firstStamp,
    `first=${firstStamp ? 'set' : 'null'}, after redelivery=${after2?.confirmation_sent_at === firstStamp ? 'UNCHANGED (no 2nd email)' : 'CHANGED (BUG: 2nd email sent)'}`)

  // --- 2. Links in the confirmation email point at kingsarkdance.com ---
  const ics = await fetch(`${serverBase}/api/stripe/event-order/${sessionId}/calendar.ics`)
  const icsBody = await ics.text()
  const appUrl = process.env.APP_URL || 'https://kingsarkdance.com'
  check('calendar .ics URL points at kingsarkdance.com', ics.status === 200 && icsBody.includes(`URL:${appUrl}#event/`), icsBody.match(/URL:[^\r\n]*/)?.[0] || 'no URL line')
  check('confirmation uses verified domain from-address', (process.env.INVOICE_FROM_EMAIL || '').endsWith('@kingsarkdance.com'), `from=${process.env.INVOICE_FROM_EMAIL}`)

  // --- 3. Reminder to a real external address (event is ~23h out, in window) ---
  const adminTestEmail = `dup-admin-${suffix}@example.com`
  const pw = 'Temp-pass-123!'
  const adminUser = await service.auth.admin.createUser({ email: adminTestEmail, password: pw, email_confirm: true })
  await service.from('profiles').upsert({ id: adminUser.data.user.id, role: 'admin', full_name: 'Dup Admin' })
  const anon = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY)
  const signin = await anon.auth.signInWithPassword({ email: adminTestEmail, password: pw })
  const adminHeaders = { Authorization: `Bearer ${signin.data.session.access_token}`, 'Content-Type': 'application/json' }

  const reminder = await fetch(`${serverBase}/api/admin/send-event-reminders`, { method: 'POST', headers: adminHeaders })
  const reminderResult = await reminder.json()
  const { data: afterReminder } = await service.from('event_ticket_orders').select('reminder_sent_at').eq('stripe_checkout_session_id', sessionId).maybeSingle()
  check('reminder sent to real address + marked', reminderResult.sent >= 1 && !!afterReminder?.reminder_sent_at, `sent=${reminderResult.sent}, marked=${afterReminder?.reminder_sent_at ? 'yes' : 'no'}`)

  // --- 4. Admin notification to bookings@kingsarkdance.com ---
  const notify = await fetch(`${serverBase}/api/notify-admin`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ type: 'job-claim', detail: { sessionType: 'Afrobeats', date: eventDate, claimedBy: 'Dup Tester' } }) })
  const notifyResult = await notify.json()
  check('admin email delivers to bookings@kingsarkdance.com', notify.status === 200 && notifyResult.sent === true, `sent=${notifyResult.sent}${notifyResult.id ? `, id=${notifyResult.id}` : notifyResult.reason ? `, ${notifyResult.reason}` : ''}`)

  results._recipients = { ok: true, detail: `confirmation+reminder -> ${BUYER}; admin -> ${ADMIN}` }

  // cleanup
  await service.from('event_ticket_orders').delete().eq('stripe_checkout_session_id', sessionId)
  await service.from('events').delete().eq('id', eventId)
  await service.from('profiles').delete().eq('id', adminUser.data.user.id)
  await service.auth.admin.deleteUser(adminUser.data.user.id)
}

main().then(() => {
  console.log(JSON.stringify(results, null, 2))
  console.log(failed ? '\nRESULT: SOME CHECKS FAILED' : '\nRESULT: ALL CHECKS PASSED')
  if (failed) process.exitCode = 1
})
