import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

// Browser walk-through, against the LIVE Supabase project, Stripe TEST mode and
// Resend, of a subscription request sent with a discount code attached:
//   - a temporary 20% class code (first month) is created through the admin API;
//   - admin picks the test family (2 children × £25) and the code on Sales >
//     Subscriptions > Send subscription request; the form shows £50 → £40;
//   - the email Resend accepted shows the code, £50.00 struck through and £40.00;
//   - the email's link opens Stripe Checkout with the code already applied:
//     subtotal £50.00, discount £10.00, total £40.00;
//   - the parent pays (test card); the first Stripe invoice is £40.00, the
//     subscription carries the coupon, and the family is active.
// Everything created is deleted at the end (Stripe test subscription cancelled,
// the temporary code removed) unless KEEP=1.
//
// Requires: node server/index.js on PORT (default 4242) serving a build of this
// code, STRIPE_WEBHOOK_SECRET matching that server, PLAYWRIGHT_CORE + CHROMIUM_PATH.

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const serverBase = `http://localhost:${process.env.PORT || 4242}`
const stamp = Date.now()
const tag = String(stamp).slice(-6)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const shot = (page, name) => (process.env.SCREENSHOT_DIR ? page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png`, fullPage: true }) : null)

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures += 1
}

const parentEmail = `delivered+kada-subdisc-${stamp}@resend.dev`
const familyName = `Verify SubDiscount ${tag}`
const cleanup = { users: [], familyId: '', subscriptionId: '', codeId: '' }

async function waitFor(fn, label, tries = 30) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const value = await fn()
    if (value) return value
    await sleep(1500)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

const resendEmail = (id) => fetch(`https://api.resend.com/emails/${id}`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } }).then((response) => response.json())

async function signIn(page, email, password, heading) {
  await page.goto(`${serverBase}/`)
  await page.getByRole('button', { name: 'Sign in' }).first().click()
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('form button[type=submit]').click()
  await page.getByRole('heading', { name: heading }).first().waitFor({ timeout: 30000 })
}

async function payWithTestCard(page) {
  const cardButton = page.getByRole('button', { name: /Pay with card|Card/ }).first()
  if (await cardButton.isVisible({ timeout: 3000 }).catch(() => false)) await cardButton.click().catch(() => {})
  await page.locator('#cardNumber').fill('4242424242424242')
  await page.locator('#cardExpiry').fill('12 / 34')
  await page.locator('#cardCvc').fill('123')
  await page.locator('#billingName').fill(familyName)
  if (await page.locator('#billingPostalCode').isVisible().catch(() => false)) await page.locator('#billingPostalCode').fill('B44 0HF')
  const saveInfo = page.locator('#enableStripePass')
  if (await saveInfo.isChecked().catch(() => false)) await saveInfo.uncheck().catch(() => {})
  await page.locator('button[type=submit]').first().click()
}

// The registered test webhook is the deployed site; hand Stripe's real event to this server.
async function replayCheckoutEvent(sessionId) {
  const event = await waitFor(async () => (await stripe.events.list({ type: 'checkout.session.completed', limit: 20 })).data.find((item) => item.data.object.id === sessionId), 'the Stripe event')
  const payload = JSON.stringify(event)
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET })
  return fetch(`${serverBase}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': signature }, body: payload })
}

async function createUser(email, password, role, fullName) {
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role, full_name: fullName }, app_metadata: { signup_notified_at: new Date().toISOString() } })
  if (error) throw error
  cleanup.users.push(data.user.id)
  await service.from('profiles').update({ role, full_name: fullName }).eq('id', data.user.id)
  return data.user
}

async function run() {
  const { chromium } = await import(process.env.PLAYWRIGHT_CORE)
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
  try {
    const adminEmail = `subdisc-admin-${stamp}@example.com`
    const adminPassword = `Verify-${stamp}-admin!`
    await createUser(adminEmail, adminPassword, 'admin', 'Sub Discount Verify Admin')
    const adminToken = (await createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.signInWithPassword({ email: adminEmail, password: adminPassword })).data.session.access_token
    const parentPassword = `Verify-${stamp}-parent!`
    const parentUser = await createUser(parentEmail, parentPassword, 'parent', familyName)
    const signupFamily = await waitFor(async () => (await service.from('parent_families').select('id').eq('owner_user_id', parentUser.id).maybeSingle()).data, "the parent's family")
    cleanup.familyId = signupFamily.id
    await service.from('parent_families').update({ guardian_name: familyName }).eq('id', cleanup.familyId)
    await service.from('students').insert([
      { id: `student-verify-${stamp}-1`, family_id: cleanup.familyId, parent_name: familyName, parent_email: parentEmail, name: `Ada Verify${tag}`, date_of_birth: '2016-04-02', membership_status: 'inactive' },
      { id: `student-verify-${stamp}-2`, family_id: cleanup.familyId, parent_name: familyName, parent_email: parentEmail, name: `Ben Verify${tag}`, date_of_birth: '2019-11-20', membership_status: 'inactive' },
    ])

    // A temporary 20% code (first month only), made the way Settings makes one.
    const codeName = `VERIFY20${tag}`
    const made = await fetch(`${serverBase}/api/admin/discount-codes`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ code: codeName, description: 'Temporary verification code', appliesTo: ['class'], type: 'percent', value: 20, membershipDuration: 'once' }) }).then((response) => response.json())
    if (!made.code) throw new Error(made.error || 'The test code was not created')
    cleanup.codeId = made.code.id
    console.log(`Parent ${parentEmail}, code ${codeName}\n`)

    const admin = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
    await signIn(admin, adminEmail, adminPassword, 'Operations dashboard')
    await admin.goto(`${serverBase}/?r=1#ops/subscriptions`)
    await admin.getByRole('heading', { name: 'Subscriptions', exact: true }).waitFor({ timeout: 30000 })
    await admin.getByRole('button', { name: /Parent accounts without a subscription/ }).click()
    const familyRow = admin.locator('tr', { hasText: familyName })
    await familyRow.waitFor({ timeout: 30000 })
    await familyRow.getByRole('button', { name: 'Subscription request…' }).click()
    const requestForm = admin.getByRole('dialog', { name: 'Send subscription request' })
    await requestForm.getByText('2 children = £50.00/month').first().waitFor({ timeout: 15000 })
    const codeSelect = requestForm.getByLabel('Discount code (optional)')
    check('Form offers the existing discount code', (await codeSelect.innerText()).includes(codeName))
    await codeSelect.selectOption(codeName)
    await requestForm.getByText(`With ${codeName}`).waitFor({ timeout: 15000 })
    const formText = (await requestForm.innerText()).replace(/\s+/g, ' ')
    check('Form preview: £50.00/month for 2 children, £40.00 with the code for the first month', formText.includes('for 2 children at £50.00/month') && formText.includes(`With ${codeName} (20% off) they pay £40.00 for the first month, then £50.00/month`), formText.slice(formText.indexOf('will be emailed')))
    await shot(admin, 'subdisc-form')
    const sentResponse = admin.waitForResponse((response) => response.url().endsWith('/api/admin/subscription-requests') && response.request().method() === 'POST', { timeout: 60000 })
    await requestForm.getByRole('button', { name: 'Send request' }).click()
    const sent = await (await sentResponse).json()
    check('Request sent: 2 children, £50.00 → £40.00 with the code', Boolean(sent.id && sent.emailId) && sent.children === 2 && sent.subtotalPence === 5000 && sent.totalPence === 4000 && sent.discount?.code === codeName, sent.error || `${sent.subtotalPence} → ${sent.totalPence}`)
    if (!sent.id) throw new Error(sent.error || 'Subscription request was not sent')
    await admin.getByText(`with ${codeName}`).first().waitFor({ timeout: 15000 })
    await shot(admin, 'subdisc-sent')
    const { data: requestRow } = await service.from('subscription_requests').select('*').eq('id', sent.id).single()
    check('Request stores the code and its terms', requestRow.discount?.code === codeName && requestRow.discount?.type === 'percent' && Number(requestRow.discount?.percentOff) === 20 && requestRow.discount?.membershipDuration === 'once', JSON.stringify(requestRow.discount))

    const email = await waitFor(async () => { const found = await resendEmail(sent.emailId); return found?.html ? found : null }, 'the email in Resend')
    const text = email.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/ ([.,:;)])/g, '$1')
    console.log(`  subject: ${email.subject}`)
    console.log(`  discount box: ${text.slice(text.indexOf('Discount code'), text.indexOf('The button below'))}`)
    check('Email subject shows the discounted first payment', email.subject.includes('£40.00 first month') && email.subject.includes('20% off'), email.subject)
    check('Email shows the code, £50.00 struck through and £40.00, saving £10.00', email.html.includes(`text-decoration:line-through;color:#767066">£50.00</span>`) && text.includes(`Discount code ${codeName} (20% off your first month) is already applied: £50.00 £40.00 for your first month (you save £10.00)`))
    check('Email explains the first payment is £40.00, then £50.00 a month', text.includes('Your first payment of £40.00 is taken today, then £50.00 on the same date each month') && text.includes('with your discount already applied'))
    const delivered = await waitFor(async () => { const found = await resendEmail(sent.emailId); return ['delivered', 'bounced'].includes(found.last_event) ? found.last_event : null }, 'Resend delivery', 20).catch(() => 'not yet')
    check('Resend delivered the email', delivered === 'delivered', delivered)

    // Click the email's link: straight to Stripe with the code applied.
    const parent = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
    const emailLink = /href="([^"]*\/api\/subscribe\/[a-f0-9]{32})"/.exec(email.html)[1]
    await parent.goto(`${serverBase}${new URL(emailLink).pathname}`)
    await parent.waitForURL(/checkout\.stripe\.com/, { timeout: 90000, waitUntil: 'commit' })
    const sessionId = /\/(cs_test_[A-Za-z0-9]+)/.exec(parent.url())[1]
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items', 'discounts.coupon'] })
    const coupon = session.discounts?.[0]?.coupon
    check('Stripe Checkout: Monthly × 2, subtotal £50.00, discount £10.00, total £40.00', session.mode === 'subscription' && session.line_items.data[0]?.quantity === 2 && session.amount_subtotal === 5000 && session.total_details?.amount_discount === 1000 && session.amount_total === 4000, `qty ${session.line_items.data[0]?.quantity}, ${session.amount_subtotal} - ${session.total_details?.amount_discount} = ${session.amount_total}`)
    check('The code is the coupon on the checkout (20%, first payment only)', coupon?.name === codeName && coupon?.percent_off === 20 && coupon?.duration === 'once', coupon && `${coupon.id}`)
    await parent.getByText(codeName).first().waitFor({ timeout: 30000 })
    const stripeText = (await parent.locator('body').innerText()).replace(/\s+/g, ' ')
    check('Stripe page shows the code and £40.00 due today', stripeText.includes(codeName) && stripeText.includes('£40.00'), stripeText.slice(0, 300))
    await shot(parent, 'subdisc-stripe-checkout')

    await payWithTestCard(parent)
    await parent.waitForURL(/\/api\/subscribe\/[a-f0-9]{32}\/done\?session_id=/, { timeout: 90000 })
    check("Return page: You're all set", (await parent.locator('body').innerText()).includes("You're all set"))
    const { data: family } = await service.from('parent_families').select('*').eq('id', cleanup.familyId).single()
    cleanup.subscriptionId = family.stripe_subscription_id
    check('Family active on the Monthly Membership', family.membership_status === 'active' && /^sub_/.test(family.stripe_subscription_id || ''), family.stripe_subscription_id)
    const subscription = await stripe.subscriptions.retrieve(family.stripe_subscription_id, { expand: ['latest_invoice'] })
    check('First Stripe invoice is £40.00 (£50.00 less 20%); subscription is £25 × 2', subscription.latest_invoice?.amount_paid === 4000 && subscription.latest_invoice?.subtotal === 5000 && subscription.items.data[0]?.quantity === 2, `paid ${subscription.latest_invoice?.amount_paid} of ${subscription.latest_invoice?.subtotal}`)
    const replay = await replayCheckoutEvent(sessionId)
    check('Webhook delivery of the same checkout is accepted', replay.status === 200, `HTTP ${replay.status}`)

    // A code that can't be used on class bookings, or a made-up one, is refused.
    const bogus = await fetch(`${serverBase}/api/admin/subscription-requests/quote?familyId=${cleanup.familyId}&discountCode=NOPE${tag}`, { headers: { Authorization: `Bearer ${adminToken}` } })
    check('An unknown code is refused', bogus.status === 400, `HTTP ${bogus.status}`)
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
    console.log(`\nKEEP=1: left family ${cleanup.familyId}, subscription ${cleanup.subscriptionId}, code ${cleanup.codeId} and the test logins in place.`)
  } else {
    if (cleanup.subscriptionId) await stripe.subscriptions.cancel(cleanup.subscriptionId).catch((error) => console.error('Stripe cancel failed:', error.message))
    if (cleanup.codeId) {
      const { data } = await service.from('app_settings').select('value').eq('key', 'discount_codes').maybeSingle()
      const codes = (data?.value?.codes || []).filter((code) => code.id !== cleanup.codeId)
      await service.from('app_settings').update({ value: { codes }, updated_at: new Date().toISOString() }).eq('key', 'discount_codes')
    }
    if (cleanup.familyId) {
      await service.from('students').delete().eq('family_id', cleanup.familyId)
      await service.from('profiles').update({ family_id: null }).eq('family_id', cleanup.familyId)
      await service.from('parent_families').delete().eq('id', cleanup.familyId)
    }
    for (const id of cleanup.users) {
      const { error } = await service.auth.admin.deleteUser(id)
      if (error) console.error(`Could not delete test user ${id}:`, error.message)
    }
    console.log('\nCleaned up the test family, code, Stripe test subscription and logins.')
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}
