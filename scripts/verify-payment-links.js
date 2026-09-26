import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

// End-to-end verification for payment links against the LIVE Supabase project
// and Stripe TEST mode. Checks the parts a browser run can't see:
//   1. Tables exist; RLS: anon reads active links only, never orders
//   2. Server validation rejects missing required answers / bad dropdown values
//   3. A webhook for an order that can't be written gets a non-200 (Stripe retries)
//   4. For the most recent paid order of LINK_SLUG: confirmation_sent_at is set
//      once, and redelivering its webhook doesn't change it (no duplicate email)
//
// Requires: node server/index.js running on PORT (default 4242), and
// STRIPE_WEBHOOK_SECRET matching what that server was started with.

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const serverBase = `http://localhost:${process.env.PORT || 4242}`
const LINK_SLUG = process.env.LINK_SLUG || 'kada-t-shirts-test'

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures += 1
}

async function signedWebhook(session) {
  const payload = JSON.stringify({ id: `evt_verify_${Date.now()}`, object: 'event', type: 'checkout.session.completed', data: { object: session } })
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET })
  return fetch(`${serverBase}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload })
}

const { data: link, error: linkError } = await service.from('payment_links').select('*').eq('slug', LINK_SLUG).maybeSingle()
check('payment_links table + test link exist', !linkError && Boolean(link), linkError?.message || LINK_SLUG)
if (!link) process.exit(1)

// 1. RLS
const anonLink = await anon.from('payment_links').select('id').eq('id', link.id).maybeSingle()
check('anon can read an active link', link.active ? Boolean(anonLink.data) : !anonLink.data)
const anonOrders = await anon.from('payment_link_orders').select('id').limit(5)
check('anon cannot read any orders', !anonOrders.error && (anonOrders.data || []).length === 0)

// 2. Server-side validation
const requiredField = (link.fields || []).find((field) => field.required)
if (requiredField) {
  const response = await fetch(`${serverBase}/api/stripe/create-payment-link-checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: serverBase }, body: JSON.stringify({ slug: LINK_SLUG, buyerName: 'Validation Test', buyerEmail: 'delivered@resend.dev', answers: {} }) })
  check(`missing required "${requiredField.label}" is rejected`, response.status === 400, (await response.json()).error)
}
const selectField = (link.fields || []).find((field) => field.type === 'select')
if (selectField) {
  const answers = Object.fromEntries((link.fields || []).map((field) => [field.id, field.type === 'select' ? field.options[0] : 'X']))
  answers[selectField.id] = 'NOT-AN-OPTION'
  const response = await fetch(`${serverBase}/api/stripe/create-payment-link-checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: serverBase }, body: JSON.stringify({ slug: LINK_SLUG, buyerName: 'Validation Test', buyerEmail: 'delivered@resend.dev', answers }) })
  check(`invalid "${selectField.label}" option is rejected`, response.status === 400, (await response.json()).error)
}

// 3. Failed write -> non-200. The order id doesn't exist and the link id violates
// the foreign key, so the fallback insert fails.
const badSession = { id: `cs_test_verify_${Date.now()}`, object: 'checkout.session', amount_total: 100, customer_details: { email: 'delivered@resend.dev', name: 'Nobody' }, metadata: { kind: 'payment_link', order_id: `plink-verify-${Date.now()}`, payment_link_id: 'no-such-link', link_name: 'Ghost', buyer_name: 'Nobody', buyer_email: 'delivered@resend.dev', amount_pence: '100' } }
const badResponse = await signedWebhook(badSession)
check('webhook returns non-200 when the order cannot be written', badResponse.status === 500, `HTTP ${badResponse.status}`)

// 4. Most recent paid order: email claimed once, redelivery is a no-op.
const { data: order } = await service.from('payment_link_orders').select('*').eq('payment_link_id', link.id).eq('payment_status', 'paid').order('paid_at', { ascending: false }).limit(1).maybeSingle()
check('a paid order exists for the test link', Boolean(order), order ? `${order.buyer_name} · ${JSON.stringify(order.answers)}` : '')
if (order) {
  check('confirmation email was claimed (confirmation_sent_at set)', Boolean(order.confirmation_sent_at), order.confirmation_sent_at || '')
  const session = await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id)
  const redelivery = await signedWebhook(session)
  check('redelivered webhook is acknowledged', redelivery.status === 200, `HTTP ${redelivery.status}`)
  const { data: after } = await service.from('payment_link_orders').select('confirmation_sent_at,paid_at,payment_status').eq('id', order.id).maybeSingle()
  check('redelivery did not re-send the email', after.confirmation_sent_at === order.confirmation_sent_at)
  check('redelivery did not rewrite paid_at', after.paid_at === order.paid_at && after.payment_status === 'paid')
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
