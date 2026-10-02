import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

// Per-child pricing, against the LIVE Supabase project, Stripe TEST mode and Resend:
//   1. A parent with 2 children books the Monthly Membership in their dashboard
//      with a 20%-off (first month) code: the form and Stripe Checkout show
//      £50/month and £40 today (20% of the £50 total, not of each £25); they pay
//      with a test card; the subscription is quantity 2 and the first invoice £40
//   2. They add a third child from the Children tab: the subscription becomes
//      quantity 3 (£75 from the next payment, no part-month charge), the parent
//      is emailed, and admin Subscriptions shows £75/month for 3 children
//   3. A child is removed (their record deleted): the sweep brings it back to 2
//   4. Day Pass for 2 children is £20, and £16 with the 20% code
//   5. A family on the old flat £25 rate keeps quantity 1 through the sweep, until
//      an admin uses "Switch to per-child pricing", which makes it 3 × £25
//   6. Prices have one source: /api/public/class-prices is Stripe's prices, the
//      homepage shows them, and shows whatever that endpoint says (not a copy)
//   7. A family with an active membership can't start a second one: in their
//      dashboard the class is "included" (no checkout, no new subscription), and
//      the public form refuses their email unless they sign in
// Everything is removed at the end (Stripe test subscriptions cancelled).
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

const parentEmail = `delivered+kada-perchild-${stamp}@resend.dev`
const familyName = `Per Child ${tag}`
const legacyEmail = `delivered+kada-flat-${stamp}@resend.dev`
const discountCode = `PC20${tag}`
const cleanup = { users: [], familyIds: [], subscriptionIds: [], codeId: '', sessions: [] }

async function waitFor(fn, label, tries = 40) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const value = await fn()
    if (value) return value
    await sleep(1500)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

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

const child = (familyId, index, name, dateOfBirth) => ({ id: `student-pc-${stamp}-${index}`, family_id: familyId, parent_name: familyName, parent_email: parentEmail, name, date_of_birth: dateOfBirth, membership_status: 'inactive' })

async function run() {
  const { chromium } = await import(process.env.PLAYWRIGHT_CORE)
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
  try {
    const adminEmail = `perchild-admin-${stamp}@example.com`
    const adminPassword = `Verify-${stamp}-admin!`
    await createUser(adminEmail, adminPassword, 'admin', 'Per Child Verify Admin')
    const adminToken = (await createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.signInWithPassword({ email: adminEmail, password: adminPassword })).data.session.access_token
    const authed = (path, body) => fetch(`${serverBase}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` }, body: JSON.stringify(body || {}) }).then(async (response) => ({ status: response.status, ...(await response.json()) }))
    const code = await authed('/api/admin/discount-codes', { code: discountCode, appliesTo: ['class'], type: 'percent', value: 20, membershipDuration: 'once' })
    cleanup.codeId = code.code?.id
    check('20% off (first month) class code created', Boolean(cleanup.codeId), code.error || discountCode)

    // A parent with an account and two children.
    const parentPassword = `Verify-${stamp}-parent!`
    const parentUser = await createUser(parentEmail, parentPassword, 'parent', familyName)
    const family = await waitFor(async () => (await service.from('parent_families').select('id').eq('owner_user_id', parentUser.id).maybeSingle()).data, "the parent's family")
    cleanup.familyIds.push(family.id)
    await service.from('parent_families').update({ guardian_name: familyName }).eq('id', family.id)
    await service.from('students').insert([child(family.id, 1, `Ada PC${tag}`, '2016-04-02'), child(family.id, 2, `Ben PC${tag}`, '2018-09-14')])

    /* 1. Monthly Membership for 2 children with 20% off. */
    const parent = await browser.newPage({ viewport: { width: 1280, height: 1100 } })
    await signIn(parent, parentEmail, parentPassword, `Welcome, ${familyName}`)
    await parent.goto(`${serverBase}/?r=1#ops/book-class`)
    await parent.getByRole('heading', { name: 'Book a class' }).waitFor({ timeout: 30000 })
    await parent.getByText('2 children on your account × £25 = £50.00 a month').waitFor({ timeout: 15000 })
    check('Booking form: 2 children × £25 = £50.00 a month', true)
    await parent.getByLabel('Discount code').fill(discountCode)
    await parent.getByRole('button', { name: 'Apply' }).click()
    await parent.getByText(`${discountCode}: 20% off, first month. You save £10.00.`).waitFor({ timeout: 15000 })
    const formText = await parent.locator('form').innerText()
    check('20% comes off the £50 total: £40.00 first month, then £50.00', formText.includes('Total: £40.00 for the first month, then £50.00 a month'), formText.match(/Total:[^\n]*/)?.[0])
    await shot(parent, 'perchild-book-form')
    await parent.getByRole('button', { name: 'Continue to payment' }).click()
    await parent.waitForURL(/checkout\.stripe\.com/, { timeout: 90000, waitUntil: 'commit' })
    const sessionId = /\/(cs_test_[A-Za-z0-9]+)/.exec(parent.url())[1]
    const checkout = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items'] })
    check('Stripe Checkout: subscription, Monthly price × 2, £50 before discount, £40 due', checkout.mode === 'subscription' && checkout.line_items.data[0]?.price?.id === process.env.STRIPE_MONTHLY_PRICE_ID && checkout.line_items.data[0]?.quantity === 2 && checkout.amount_subtotal === 5000 && checkout.amount_total === 4000, `qty ${checkout.line_items.data[0]?.quantity}, ${checkout.amount_subtotal} → ${checkout.amount_total}`)
    await shot(parent, 'perchild-stripe-checkout')
    await payWithTestCard(parent)
    await parent.waitForURL(/payment=success/, { timeout: 90000 })
    const delivery = await replayCheckoutEvent(sessionId)
    check('Webhook accepts the membership checkout', delivery.status === 200, `HTTP ${delivery.status}`)
    const afterPay = await waitFor(async () => { const { data } = await service.from('parent_families').select('*').eq('id', family.id).single(); return data.stripe_subscription_id && data.membership_pricing === 'per_child' ? data : null }, 'the family to be recorded')
    cleanup.subscriptionIds.push(afterPay.stripe_subscription_id)
    check('Family recorded as per-child: 2 children, £50/month, active', afterPay.membership_children === 2 && afterPay.membership_monthly_pence === 5000 && afterPay.membership_status === 'active' && afterPay.plan_type === 'monthly_membership')
    let subscription = await stripe.subscriptions.retrieve(afterPay.stripe_subscription_id, { expand: ['latest_invoice'] })
    check('Stripe subscription: active, quantity 2, marked per-child', subscription.status === 'active' && subscription.items.data[0].quantity === 2 && subscription.metadata.kada_pricing === 'per_child', `${subscription.status}, qty ${subscription.items.data[0].quantity}`)
    check('First invoice: £50.00 less 20% = £40.00 paid', subscription.latest_invoice.subtotal === 5000 && subscription.latest_invoice.amount_paid === 4000, `${subscription.latest_invoice.subtotal} → ${subscription.latest_invoice.amount_paid}`)
    const next2 = await stripe.invoices.createPreview({ subscription: subscription.id })
    check('Next monthly payment: £50.00 (the code was first month only)', next2.total === 5000, String(next2.total))

    /* 2. Add a third child from the Children tab. */
    const changeStart = Date.now()
    await parent.goto(`${serverBase}/?r=2#ops/children`)
    await parent.getByLabel('Child 1 name').waitFor({ timeout: 30000 })
    await parent.getByLabel('Child 1 name').fill(`Cara PC${tag}`)
    await parent.getByLabel('Child 1 date of birth').fill('2020-01-20')
    await parent.getByRole('button', { name: 'Add child', exact: true }).click()
    await parent.getByText(`Added Cara PC${tag}.`).waitFor({ timeout: 15000 })
    const afterAdd = await waitFor(async () => { const { data } = await service.from('parent_families').select('membership_children,membership_monthly_pence').eq('id', family.id).single(); return data.membership_children === 3 ? data : null }, 'the third child to reach the subscription')
    subscription = await stripe.subscriptions.retrieve(afterPay.stripe_subscription_id)
    check('Third child: Stripe quantity 3, family £75/month', subscription.items.data[0].quantity === 3 && afterAdd.membership_monthly_pence === 7500, `qty ${subscription.items.data[0].quantity}`)
    const next3 = await stripe.invoices.createPreview({ subscription: subscription.id })
    check('Next monthly payment is £75.00, with no part-month charge added', next3.total === 7500 && !next3.lines.data.some((line) => line.proration || line.parent?.subscription_item_details?.proration), String(next3.total))
    const changeEmail = await waitFor(async () => ((await fetch('https://api.resend.com/emails?limit=30', { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } }).then((response) => response.json())).data || []).find((email) => email.to.includes(parentEmail) && email.subject.includes('now £75.00 a month') && Date.parse(email.created_at.replace(' ', 'T').replace(/\+00$/, 'Z')) >= changeStart - 5000), 'the membership change email')
    check('Parent emailed: "Your Monthly Membership is now £75.00 a month"', Boolean(changeEmail), changeEmail?.subject)
    await parent.goto(`${serverBase}/?r=3#ops/dashboard`)
    await parent.getByText('3 children × £25').waitFor({ timeout: 30000 })
    check('Parent dashboard plan: £75.00 / month, 3 children × £25', (await parent.locator('main').innerText()).includes('£75.00 / month'))
    await shot(parent, 'perchild-parent-dashboard')

    const admin = await browser.newPage({ viewport: { width: 1280, height: 1100 } })
    await signIn(admin, adminEmail, adminPassword, 'Operations dashboard')
    await admin.goto(`${serverBase}/?r=1#ops/subscriptions`)
    const familyRow = admin.locator('tr', { hasText: familyName })
    await familyRow.waitFor({ timeout: 30000 })
    const rowText = await familyRow.innerText()
    check('Admin Subscriptions: £75.00/month, 3 children × £25', rowText.includes('£75.00/month') && rowText.includes('3 children × £25'), rowText.replace(/\s+/g, ' '))

    /* 3. A child is removed (e.g. their booking was deleted): the sweep notices. */
    await service.from('students').delete().eq('id', `student-pc-${stamp}-2`)
    const swept = await authed('/api/admin/memberships/sync', { familyId: family.id })
    subscription = await stripe.subscriptions.retrieve(afterPay.stripe_subscription_id)
    check('Child removed: back to quantity 2 (£50/month)', swept.changed && swept.children === 2 && subscription.items.data[0].quantity === 2, `qty ${subscription.items.data[0].quantity}`)

    /* 7. An existing member books another class: included, no second subscription. */
    const subscriptionsBefore = (await stripe.subscriptions.list({ customer: afterPay.stripe_customer_id, status: 'all' })).data.length
    await parent.goto(`${serverBase}/?r=4#ops/book-class`)
    await parent.getByRole('heading', { name: 'Book a class' }).waitFor({ timeout: 30000 })
    await parent.getByText('You already have a Monthly Membership, so this class is').waitFor({ timeout: 15000 })
    check('Member sees the class is included, with no discount box or payment', await parent.getByLabel('Discount code').count() === 0 && await parent.getByRole('button', { name: 'Book (included in membership)' }).count() === 1)
    await shot(parent, 'member-included-form')
    await parent.getByRole('button', { name: 'Book (included in membership)' }).click()
    await parent.getByText("You're booked in!").waitFor({ timeout: 30000 })
    await shot(parent, 'member-included-booked')
    const { data: includedBooking } = await service.from('bookings').select('price,payment_status,notes,status').eq('family_id', family.id).ilike('notes', 'Included in the family%').maybeSingle()
    const { data: memberAfter } = await service.from('parent_families').select('stripe_subscription_id').eq('id', family.id).single()
    const subscriptionsAfter = (await stripe.subscriptions.list({ customer: afterPay.stripe_customer_id, status: 'all' })).data.length
    check('Booked as included: £0, confirmed, same subscription, no new one in Stripe', includedBooking?.price === 0 && includedBooking.status === 'Confirmed' && memberAfter.stripe_subscription_id === afterPay.stripe_subscription_id && subscriptionsAfter === subscriptionsBefore, `${subscriptionsBefore} → ${subscriptionsAfter} subscriptions`)
    const anonymous = await fetch(`${serverBase}/api/stripe/create-checkout-session`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: serverBase }, body: JSON.stringify({ planType: 'monthly_membership', className: (await service.from('class_sessions').select('name').eq('active', true).limit(1).single()).data.name, classDate: '2099-01-01', parentName: 'Someone', parentEmail, students: [{ name: 'Extra Child', dateOfBirth: '2015-01-01' }] }) })
    // The date check runs first for a bad date; use a real one below.
    const { data: memberClass } = await service.from('class_sessions').select('name,day_of_week').eq('active', true).limit(1).single()
    const nowDate = new Date(); const ahead = (Number(memberClass.day_of_week) - nowDate.getUTCDay() + 7) % 7 || 7
    const memberDate = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate() + ahead)).toISOString().slice(0, 10)
    const signedOut = await fetch(`${serverBase}/api/stripe/create-checkout-session`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: serverBase }, body: JSON.stringify({ planType: 'monthly_membership', className: memberClass.name, classDate: memberDate, parentName: 'Someone', parentEmail, students: [{ name: 'Extra Child', dateOfBirth: '2015-01-01' }] }) })
    const signedOutBody = await signedOut.json()
    check("Public form with a member's email: refused (409), nothing created", anonymous.status === 400 && signedOut.status === 409 && /already has an active Monthly Membership/.test(signedOutBody.error) && (await service.from('students').select('id').eq('family_id', family.id).eq('name', 'Extra Child')).data.length === 0, signedOutBody.error)

    /* 6. One price source. */
    const stripePrices = { monthly_membership: (await stripe.prices.retrieve(process.env.STRIPE_MONTHLY_PRICE_ID)).unit_amount, day_pass: (await stripe.prices.retrieve(process.env.STRIPE_DAY_PASS_PRICE_ID)).unit_amount }
    const served = await fetch(`${serverBase}/api/public/class-prices`).then((response) => response.json())
    check('Price endpoint is exactly the Stripe prices', served.monthly_membership === stripePrices.monthly_membership && served.day_pass === stripePrices.day_pass, JSON.stringify(served))
    const visitor = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
    const homepagePlans = async () => {
      await visitor.goto(`${serverBase}/?v=${Date.now()}`)
      await visitor.locator('a[href="#class-booking"]').first().click()
      await visitor.waitForFunction(() => { const option = document.querySelector('option[value=monthly_membership]'); return option && !option.textContent.includes('…') }, null, { timeout: 30000 })
      return visitor.evaluate(() => [...document.querySelectorAll('option[value=monthly_membership], option[value=day_pass]')].map((option) => option.textContent).join(' | '))
    }
    const realPlans = await homepagePlans()
    check('Homepage shows the Stripe prices: £25/month per child, £10 per child', realPlans.includes(`£${stripePrices.monthly_membership / 100}/month per child`) && realPlans.includes(`£${stripePrices.day_pass / 100} per child`), realPlans)
    await visitor.route('**/api/public/class-prices', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ monthly_membership: 3000, day_pass: 1200 }) }))
    const fedPlans = await homepagePlans()
    check('Homepage follows the price source (fed £30/£12, shows £30/£12): no copy of its own', fedPlans.includes('£30/month per child') && fedPlans.includes('£12 per child'), fedPlans)
    await visitor.close()

    /* 4. Day Pass is per child too. */
    const parentToken = (await createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.signInWithPassword({ email: parentEmail, password: parentPassword })).data.session.access_token
    const { data: classSession } = await service.from('class_sessions').select('name,day_of_week').eq('active', true).limit(1).single()
    const today = new Date(); const offset = (Number(classSession.day_of_week) - today.getUTCDay() + 7) % 7 || 7
    const classDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset)).toISOString().slice(0, 10)
    for (const [codeUsed, expected] of [['', 2000], [discountCode, 1600]]) {
      const dayPass = await fetch(`${serverBase}/api/stripe/create-checkout-session`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${parentToken}`, Origin: serverBase }, body: JSON.stringify({ planType: 'day_pass', className: classSession.name, classDate, parentName: familyName, parentEmail, discountCode: codeUsed, students: [{ name: `Ada PC${tag}`, dateOfBirth: '2016-04-02' }, { name: `Dan PC${tag}`, dateOfBirth: '2021-03-03' }] }) }).then((response) => response.json())
      const dayPassId = /(cs_test_[A-Za-z0-9]+)/.exec(dayPass.url || '')?.[1]
      const daySession = dayPassId ? await stripe.checkout.sessions.retrieve(dayPassId, { expand: ['line_items'] }) : null
      if (dayPassId) cleanup.sessions.push(dayPassId)
      check(`Day Pass for 2 children${codeUsed ? ' with 20% off the total' : ''}: ${expected === 2000 ? '£20.00' : '£16.00'}`, daySession?.mode === 'payment' && daySession.line_items.data[0]?.quantity === 2 && daySession.amount_subtotal === 2000 && daySession.amount_total === expected, daySession ? `qty ${daySession.line_items.data[0]?.quantity}, ${daySession.amount_subtotal} → ${daySession.amount_total}` : dayPass.error)
    }
    const sweptAfterDayPass = await authed('/api/admin/memberships/sync', { familyId: family.id })
    check('Unpaid Day Pass checkouts (one existing child, one new) leave the membership at 2', !sweptAfterDayPass.changed && sweptAfterDayPass.children === 2, JSON.stringify(sweptAfterDayPass))

    /* 5. A family on the old flat rate. */
    const customer = await stripe.customers.create({ email: legacyEmail, name: `Flat Rate ${tag}`, payment_method: 'pm_card_visa', invoice_settings: { default_payment_method: 'pm_card_visa' } })
    const legacySub = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: process.env.STRIPE_MONTHLY_PRICE_ID, quantity: 1 }] })
    cleanup.subscriptionIds.push(legacySub.id)
    const legacyId = `family-verify-flat-${stamp}`
    cleanup.familyIds.push(legacyId)
    await service.from('parent_families').insert({ id: legacyId, guardian_name: `Flat Rate ${tag}`, guardian_email: legacyEmail, plan_type: 'monthly_membership', membership_status: 'active', stripe_customer_id: customer.id, stripe_subscription_id: legacySub.id, membership_pricing: 'flat', membership_monthly_pence: 2500 })
    await service.from('students').insert([1, 2, 3].map((index) => ({ id: `student-flat-${stamp}-${index}`, family_id: legacyId, parent_name: `Flat Rate ${tag}`, parent_email: legacyEmail, name: `Flat Child ${index} ${tag}`, date_of_birth: `201${index}-05-05`, membership_status: 'active' })))
    const sweepAll = await authed('/api/admin/memberships/sync')
    const legacyAfterSweep = await stripe.subscriptions.retrieve(legacySub.id)
    check('Flat-rate family with 3 children is left at quantity 1 (£25) by the sweep', legacyAfterSweep.items.data[0].quantity === 1 && !(sweepAll.changed || []).some((item) => item.familyId === legacyId), `qty ${legacyAfterSweep.items.data[0].quantity}`)

    await admin.goto(`${serverBase}/?r=2#ops/subscriptions`)
    const legacyRow = admin.locator('tr', { hasText: `Flat Rate ${tag}` })
    await legacyRow.waitFor({ timeout: 30000 })
    check('Admin sees it as the old flat rate', (await legacyRow.innerText()).includes('Old flat rate per family'))
    await shot(admin, 'perchild-admin-before-switch')
    admin.once('dialog', (dialog) => dialog.accept())
    await legacyRow.getByRole('button', { name: /Active/ }).click()
    await admin.getByText('Switch to per-child pricing').click()
    await legacyRow.getByText('3 children × £25').waitFor({ timeout: 30000 })
    const switched = await stripe.subscriptions.retrieve(legacySub.id)
    const { data: legacyFamily } = await service.from('parent_families').select('membership_pricing,membership_children,membership_monthly_pence').eq('id', legacyId).single()
    check('Admin switch: per-child, quantity 3, £75/month', switched.items.data[0].quantity === 3 && switched.metadata.kada_pricing === 'per_child' && legacyFamily.membership_pricing === 'per_child' && legacyFamily.membership_monthly_pence === 7500, `qty ${switched.items.data[0].quantity}`)
    await shot(admin, 'perchild-admin-after-switch')

    const realFlat = await service.from('parent_families').select('guardian_name,membership_pricing').not('stripe_subscription_id', 'is', null).not('id', 'in', `(${cleanup.familyIds.map((id) => `"${id}"`).join(',')})`)
    check('Real existing subscribers are still on the flat rate', (realFlat.data || []).every((row) => row.membership_pricing === 'flat'), (realFlat.data || []).map((row) => `${row.guardian_name}: ${row.membership_pricing}`).join(', '))
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
  for (const id of cleanup.subscriptionIds) await stripe.subscriptions.cancel(id).catch(() => {})
  for (const id of cleanup.sessions) await stripe.checkout.sessions.expire(id).catch(() => {})
  for (const familyId of cleanup.familyIds) {
    await service.from('bookings').delete().eq('family_id', familyId)
    await service.from('students').delete().eq('family_id', familyId)
    await service.from('profiles').update({ family_id: null }).eq('family_id', familyId)
    await service.from('parent_families').delete().eq('id', familyId)
  }
  if (cleanup.codeId) {
    const { data: current } = await service.from('app_settings').select('value').eq('key', 'discount_codes').maybeSingle()
    await service.from('app_settings').upsert({ key: 'discount_codes', value: { codes: (current?.value?.codes || []).filter((item) => item.id !== cleanup.codeId) }, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  }
  for (const id of cleanup.users) {
    const { error } = await service.auth.admin.deleteUser(id)
    if (error) console.error(`Could not delete test user ${id}:`, error.message)
  }
  console.log('\nCleaned up test families, children, bookings, Stripe test subscriptions, the code and logins.')
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}
