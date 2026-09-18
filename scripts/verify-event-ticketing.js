import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

// End-to-end verification for ticketed events against the LIVE Supabase project
// and Stripe TEST mode:
//   1. Seeds the real "It's Time to Rise" event (upsert — safe to re-run)
//   2. Checks the new events columns + event_ticket_orders table exist
//   3. Checks RLS: anon can read the published event but not drafts
//   4. Creates a real Stripe Checkout session via the running server and
//      verifies the line items/metadata on Stripe's side
//   5. Delivers a properly-signed checkout.session.completed webhook for that
//      real session and confirms the order is recorded in event_ticket_orders
//   6. Checks the public order-status endpoint and webhook idempotency
//
// Requires: node server/index.js running on PORT (default 4242).

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const serverBase = `http://localhost:${process.env.PORT || 4242}`

const EVENT_ID = 'its-time-to-rise-2026'
const seedEvent = {
  id: EVENT_ID,
  title: "It's Time to Rise",
  description: 'An evening of Gospel Afrobeats, dance and worship. Bring the family — all are welcome.',
  event_date: '2026-10-25', // Sunday 25 October 2026
  location: 'Birmingham',
  status: 'published',
  show_on_homepage: true,
  ticketing_enabled: true,
  guest_artists: 'Guest artists to be announced',
  ticket_tiers: [
    { id: 'early-bird', name: 'Early Bird', pricePence: 1000, bundleSize: 1, description: 'Limited first release' },
    { id: 'early-bird-2for1', name: 'Early Bird 2-for-1', pricePence: 500, bundleSize: 2, description: 'Two tickets for a fiver' },
    { id: 'second-early-bird', name: 'Second Early Bird', pricePence: 1499, bundleSize: 1, description: '' },
    { id: 'general-admission', name: 'General Admission', pricePence: 2000, bundleSize: 1, description: '' },
  ],
}
const draftFixtureId = `verify-ticket-draft-${Date.now()}`
const buyer = { name: 'Ticket Verify', email: `ticket-verify-${Date.now()}@example.com` }

const results = {}
let failed = false
function check(name, ok, detail) {
  results[name] = { ok, detail }
  if (!ok) failed = true
}

let checkoutSessionId = null
try {
  // --- 1. Seed the real event (upsert) + a draft fixture for the RLS check ---
  const { error: seedError } = await service.from('events').upsert(seedEvent, { onConflict: 'id' })
  if (seedError) throw new Error(`seed failed — have you applied 20260918_event_ticketing.sql? (${seedError.message})`)
  const { error: draftError } = await service.from('events').insert({ id: draftFixtureId, title: 'Hidden draft', status: 'draft' })
  check('seed: event + columns writable', !draftError, draftError?.message || `"It's Time to Rise" upserted with 4 tiers`)

  // --- 2. event_ticket_orders table exists ---
  const { error: ordersError } = await service.from('event_ticket_orders').select('id').limit(1)
  check('event_ticket_orders table exists', !ordersError, ordersError?.message || 'table queryable')

  // --- 3. RLS: anon reads published event (with tiers), not drafts ---
  const { data: anonEvent, error: anonError } = await anon.from('events').select('*').eq('id', EVENT_ID).maybeSingle()
  check('anon RLS: published event readable', !anonError && anonEvent?.id === EVENT_ID && Array.isArray(anonEvent?.ticket_tiers), anonError?.message || 'published event + tiers visible to guests')
  const { data: anonDrafts, error: anonDraftError } = await anon.from('events').select('id').eq('id', draftFixtureId)
  check('anon RLS: drafts hidden', !anonDraftError && (anonDrafts || []).length === 0, anonDraftError?.message || 'draft fixture invisible to guests')
  const { data: anonOrders, error: anonOrdersError } = await anon.from('event_ticket_orders').select('id').limit(1)
  check('anon RLS: orders hidden', !anonOrdersError && (anonOrders || []).length === 0, anonOrdersError?.message || 'buyer data not publicly readable')

  // --- 4. Real Stripe Checkout session via the running server ---
  const checkoutResponse = await fetch(`${serverBase}/api/stripe/create-event-checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId: EVENT_ID, tierId: 'early-bird', quantity: 2, buyerName: buyer.name, buyerEmail: buyer.email }),
  })
  const checkoutResult = await checkoutResponse.json()
  if (!checkoutResponse.ok) throw new Error(`checkout endpoint failed: ${checkoutResult.error || checkoutResponse.status}`)
  checkoutSessionId = checkoutResult.url.match(/cs_test_[a-zA-Z0-9]+/)?.[0]
  const session = await stripe.checkout.sessions.retrieve(checkoutSessionId, { expand: ['line_items'] })
  const lineItem = session.line_items?.data?.[0]
  check(
    'stripe checkout session created',
    session.mode === 'payment' && session.metadata?.kind === 'event_ticket' && !!checkoutSessionId,
    `mode=${session.mode}, kind=${session.metadata?.kind}`,
  )
  check(
    'stripe line item matches tier',
    lineItem && lineItem.quantity === 2 && lineItem.price?.unit_amount === 1000 && (lineItem.description || '').includes("It's Time to Rise"),
    lineItem ? `"${lineItem.description}" x${lineItem.quantity} @ £${(lineItem.price.unit_amount / 100).toFixed(2)}` : 'no line item',
  )
  check(
    'checkout metadata complete',
    session.metadata?.event_id === EVENT_ID && session.metadata?.tier_name === 'Early Bird' && session.metadata?.tickets === '2' && session.metadata?.total_pence === '2000',
    JSON.stringify(session.metadata),
  )

  // --- 5. Signed webhook for that real session -> order recorded ---
  const payload = JSON.stringify({
    id: `evt_verify_${Date.now()}`,
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: session },
  })
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET })
  const webhookResponse = await fetch(`${serverBase}/api/stripe/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature },
    body: payload,
  })
  check('webhook accepted (signature verified)', webhookResponse.status === 200, `HTTP ${webhookResponse.status}`)
  const { data: order, error: orderError } = await service.from('event_ticket_orders').select('*').eq('stripe_checkout_session_id', checkoutSessionId).maybeSingle()
  check(
    'order recorded in event_ticket_orders',
    !orderError && order?.event_id === EVENT_ID && order?.tier_name === 'Early Bird' && order?.tickets === 2 && order?.total_pence === 2000 && order?.payment_status === 'paid' && order?.buyer_email === buyer.email,
    orderError?.message || (order ? `${order.tier_name} x${order.tickets}, ${order.total_pence}p, ${order.payment_status}` : 'no order row found'),
  )

  // --- 6. Public order-status endpoint + webhook idempotency ---
  const statusResponse = await fetch(`${serverBase}/api/stripe/event-order/${checkoutSessionId}`)
  const statusResult = await statusResponse.json()
  check('public order-status endpoint', statusResponse.status === 200 && statusResult.order?.eventTitle === "It's Time to Rise" && statusResult.order?.tickets === 2, statusResponse.status === 200 ? JSON.stringify(statusResult.order) : `HTTP ${statusResponse.status}`)
  await fetch(`${serverBase}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature }, body: payload })
  const { data: orderRows } = await service.from('event_ticket_orders').select('id').eq('stripe_checkout_session_id', checkoutSessionId)
  check('webhook idempotent (no duplicate orders)', (orderRows || []).length === 1, `${(orderRows || []).length} row(s) after redelivery`)

  // --- 7. Validation: server rejects bad input without touching Stripe ---
  const badResponse = await fetch(`${serverBase}/api/stripe/create-event-checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId: EVENT_ID, tierId: 'general-admission', quantity: 1, buyerName: '', buyerEmail: 'not-an-email' }),
  })
  check('checkout validation rejects bad input', badResponse.status === 400, `HTTP ${badResponse.status}`)
} finally {
  await service.from('event_ticket_orders').delete().eq('buyer_email', buyer.email)
  await service.from('events').delete().eq('id', draftFixtureId)
}

console.log(JSON.stringify(results, null, 2))
console.log(failed ? '\nRESULT: FAILED' : `\nRESULT: ALL CHECKS PASSED — public page: ${process.env.CLIENT_URL || 'http://localhost:5173'}#event/${EVENT_ID}`)
if (failed) process.exitCode = 1
