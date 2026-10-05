import 'dotenv/config'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

// Requires the updated server, applied migration, and Playwright with Chromium.
// Completes actual Stripe TEST-card payments. For local webhook forwarding it
// fetches Stripe's genuine completion/expiry events, never fabricates payment.
assert.ok(process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'), 'Stripe TEST mode is required')
assert.ok(process.env.PLAYWRIGHT_MODULE, 'Set PLAYWRIGHT_MODULE to Playwright index.mjs')
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const service = createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)
const base = process.env.TICKET_TEST_SERVER_URL || 'http://localhost:4242'
const eventId = `verify-ticket-stock-${Date.now()}`
const email = process.env.TEST_TICKET_BUYER_EMAIL || `${eventId}@example.com`
const checked = (result) => { if (result.error) throw new Error(result.error.message); return result.data }
const existingContact = checked(await service.from('contacts').select('id').eq('email', email).maybeSingle())
assert.equal(existingContact, null, 'Use a unique test buyer email so cleanup cannot affect an existing contact')
const sessions = []
const tiers = [
  { id: 'limited', name: 'Inventory test', pricePence: 100, bundleSize: 1, quantityLimit: 3, lowStockThreshold: 10 },
  { id: 'manual', name: 'Manual override test', pricePence: 100, bundleSize: 1, quantityLimit: null, soldOut: true },
  { id: 'expiry', name: 'Expiry test', pricePence: 100, bundleSize: 1, quantityLimit: 1 },
]
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const stock = async (tierId) => checked(await anon.rpc('event_ticket_stock', { p_event_ids: [eventId] })).find((row) => row.tier_id === tierId)
const checkout = async (quantity, tierId = 'limited') => {
  const response = await fetch(`${base}/api/stripe/create-event-checkout`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId, tierId, quantity, buyerName: 'Inventory Test', buyerEmail: email }),
  })
  const result = await response.json()
  if (response.ok) {
    const sessionId = result.url.match(/cs_test_[a-zA-Z0-9]+/)?.[0]
    assert.ok(sessionId, 'Real Stripe test checkout URL required')
    sessions.push(sessionId)
  }
  return { status: response.status, ...result }
}
async function forwardActualEvent(sessionId, type) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const events = await stripe.events.list({ type, limit: 100 })
    const event = events.data.find((item) => item.data.object.id === sessionId)
    if (event) {
      const payload = JSON.stringify(event)
      const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET })
      const response = await fetch(`${base}/api/stripe/webhook`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature }, body: payload,
      })
      assert.equal(response.status, 200, await response.text())
      return { payload, signature }
    }
    await wait(1000)
  }
  throw new Error(`Stripe did not publish ${type} for ${sessionId}`)
}
async function completePayment(browser, url) {
  const page = await browser.newPage()
  await page.goto(url)
  await page.locator('#cardNumber').fill('4242424242424242', { timeout: 60000 })
  await page.locator('#cardExpiry').fill('1230')
  await page.locator('#cardCvc').fill('123')
  await page.locator('#billingName').fill('Inventory Test')
  const postal = page.locator('#billingPostalCode')
  if (await postal.isVisible()) await postal.fill('B1 1AA')
  await page.getByTestId('hosted-payment-submit-button').click()
  const sessionId = url.match(/cs_test_[a-zA-Z0-9]+/)[0]
  let session
  for (let attempt = 0; attempt < 60; attempt += 1) {
    session = await stripe.checkout.sessions.retrieve(sessionId)
    if (session.payment_status === 'paid') break
    await wait(1000)
  }
  assert.equal(session.payment_status, 'paid', 'Test-card checkout must actually be paid on Stripe')
  assert.equal(session.status, 'complete')
  await page.close()
  return forwardActualEvent(sessionId, 'checkout.session.completed')
}

let browser
let adminUserId
try {
  checked(await service.from('events').insert({
    id: eventId, title: 'Ticket stock verification (test only)', status: 'published',
    event_date: '2027-01-01', ticketing_enabled: true, show_on_homepage: false, ticket_tiers: tiers,
  }))
  browser = await chromium.launch({ headless: true })
  const adminEmail = `${eventId}-admin@example.com`
  const adminPassword = `${randomUUID()}Aa1!`
  const created = checked(await service.auth.admin.createUser({ email: adminEmail, password: adminPassword, email_confirm: true }))
  adminUserId = created.user.id
  checked(await service.from('profiles').upsert({ id: adminUserId, role: 'admin', full_name: 'Ticket Inventory Test' }))
  const authClient = createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)
  const signedIn = checked(await authClient.auth.signInWithPassword({ email: adminEmail, password: adminPassword }))
  const adminPage = await browser.newPage()
  const authKey = `sb-${new URL(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL).hostname.split('.')[0]}-auth-token`
  await adminPage.addInitScript(({ key, session }) => window.localStorage.setItem(key, JSON.stringify(session)), { key: authKey, session: signedIn.session })
  const saveAdminEvent = async () => {
    const [response] = await Promise.all([
      adminPage.waitForResponse((item) => item.url().includes('/rest/v1/events') && item.request().method() === 'POST'),
      adminPage.getByRole('button', { name: 'Save event', exact: true }).click(),
    ])
    assert.ok(response.ok(), await response.text())
  }
  await adminPage.goto(`${base}/#ops/events-published`)
  await adminPage.getByRole('heading', { name: 'Published events', exact: true }).waitFor({ timeout: 30000 })
  const more = adminPage.getByRole('button', { name: /^Show more/ })
  if (await more.isVisible()) await more.click()
  const adminRow = adminPage.locator('tr').filter({ hasText: 'Ticket stock verification (test only)' })
  await adminRow.getByRole('button', { name: 'Edit', exact: true }).click()
  const limitField = adminPage.getByLabel('Limit quantity (optional)').first()
  assert.equal(await limitField.inputValue(), '3')
  await adminPage.getByLabel('Show "Only N left" below').first().fill('2')
  await saveAdminEvent()
  const storedEvent = checked(await service.from('events').select('ticket_tiers').eq('id', eventId).single())
  assert.equal(storedEvent.ticket_tiers[0].quantityLimit, 3)
  assert.equal(storedEvent.ticket_tiers[0].lowStockThreshold, 2)
  assert.equal(storedEvent.ticket_tiers[1].soldOut, true)
  assert.equal(storedEvent.ticket_tiers[1].quantityLimit, null)
  console.log('PASS: admin editing saves limits, threshold, manual override and unlimited tiers')

  const publicPage = await browser.newPage()
  await publicPage.goto(`${base}/event/${eventId}`)
  await publicPage.getByRole('radio', { name: /Inventory test/ }).waitFor()
  const manual = publicPage.getByRole('radio', { name: /Manual override test/ })
  assert.equal(await manual.isDisabled(), true)
  assert.equal((await checkout(1, 'manual')).status, 409)
  assert.equal(Number((await stock('manual')).sold), 0)
  console.log('PASS: manual override blocks UI and checkout independently of count')

  const first = await checkout(2)
  assert.equal(first.status, 200)
  await completePayment(browser, first.url)
  assert.equal(Number((await stock('limited')).sold), 2)
  await publicPage.getByText('Only 1 left', { exact: true }).first().waitFor({ timeout: 15000 })
  await adminRow.getByText('Inventory test: 2 / 3 sold', { exact: true }).waitFor({ timeout: 15000 })
  console.log('PASS: two actual paid test tickets; public page updates to Only 1 left')

  const race = await Promise.all([checkout(1), checkout(1)])
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409])
  assert.equal(Number((await stock('limited')).sold), 2)
  assert.equal(Number((await stock('limited')).reserved), 1)
  const last = race.find((r) => r.status === 200)
  const actualEvent = await completePayment(browser, last.url)
  const limited = publicPage.getByRole('radio', { name: /Inventory test/ })
  await limited.getByText('Sold out', { exact: true }).waitFor({ timeout: 15000 })
  assert.equal(await limited.isDisabled(), true)
  assert.equal(Number((await stock('limited')).sold), 3)
  assert.equal((await checkout(1)).status, 409)
  await adminRow.getByText(/Inventory test: 3 \/ 3 sold/).waitFor({ timeout: 15000 })
  console.log('PASS: exactly one concurrent last-ticket checkout wins; third actual payment sells out')

  const replay = await fetch(`${base}/api/stripe/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': actualEvent.signature }, body: actualEvent.payload,
  })
  assert.equal(replay.status, 200)
  assert.equal(Number((await stock('limited')).sold), 3)
  console.log('PASS: genuine paid webhook redelivery leaves sold count at three')

  const expiry = await checkout(1, 'expiry')
  assert.equal(expiry.status, 200)
  assert.equal(Number((await stock('expiry')).available), 0)
  const expiryId = expiry.url.match(/cs_test_[a-zA-Z0-9]+/)[0]
  await stripe.checkout.sessions.expire(expiryId)
  await forwardActualEvent(expiryId, 'checkout.session.expired')
  assert.equal(Number((await stock('expiry')).available), 1)
  console.log('PASS: Stripe-confirmed expiry releases the held ticket')

  await adminRow.getByRole('button', { name: 'Edit', exact: true }).click()
  await adminPage.getByLabel('Mark as sold out').nth(1).uncheck()
  await saveAdminEvent()
  assert.equal((await stock('manual')).sold_out, false)
  for (let attempt = 0; attempt < 15 && await manual.isDisabled(); attempt += 1) await wait(1000)
  assert.equal(await manual.isDisabled(), false, 'Removing the manual override must reopen the existing public page')
  const reopened = await checkout(1, 'manual')
  assert.equal(reopened.status, 200)
  await stripe.checkout.sessions.expire(reopened.url.match(/cs_test_[a-zA-Z0-9]+/)[0])
  console.log('PASS: removing manual override reopens the unlimited tier')
  console.log(`Verified live Supabase + real Stripe test payments through ${base}; fixture ${eventId}`)
} finally {
  if (browser) await browser.close()
  for (const id of sessions) {
    const session = await stripe.checkout.sessions.retrieve(id)
    if (session.status === 'open') await stripe.checkout.sessions.expire(id)
  }
  // Delete only this dedicated fixture and its generated test contact.
  checked(await service.from('event_ticket_orders').delete().eq('event_id', eventId))
  checked(await service.from('event_ticket_reservations').delete().eq('event_id', eventId))
  checked(await service.from('events').delete().eq('id', eventId))
  checked(await service.from('contacts').delete().eq('email', email))
  if (adminUserId) checked(await service.auth.admin.deleteUser(adminUserId))
}
