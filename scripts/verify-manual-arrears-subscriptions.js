import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

// Browser walk-through, against the LIVE Supabase project, Stripe TEST mode and
// Resend, of manual arrears and subscription requests for an existing parent:
//   A. Admin (temporary account) uses Sales > Arrears > Create arrears to bill the
//      test family £42.50 with a reason and two months (last month + this month).
//      The row is a sent invoice with the reason/months; Resend accepted the email
//      (to the parent, admin bcc) and it carries the amount, reason, months and
//      the Pay now link; it shows in the arrears view and the parent's Invoices tab;
//      the parent pays it through Stripe Checkout (test card) and the webhook marks
//      it Paid.
//   B. Admin sends a subscription request from Sales > Subscriptions. Resend
//      accepted the email; its link goes straight to Stripe Checkout in
//      subscription mode for the Monthly price × the family's children (2 → £50);
//      the parent completes it (test card); the family is active on the plan with the Stripe subscription,
//      a redelivered webhook changes nothing, admin sees it active, and the old
//      link and a second request are refused.
// Everything created is deleted at the end (and the Stripe test subscription
// cancelled) unless KEEP=1. Stripe's real events are replayed to this server
// because the registered test webhook points at the deployed site.
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

const parentEmail = `delivered+kada-arrears-${stamp}@resend.dev`
const familyName = `Verify Arrears ${tag}`
const reason = `Unpaid Saturday class fees (verification ${tag})`
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const now = new Date()
const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
const months = [monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)), monthKey(now)]
const monthName = (month) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`
const expectedLabel = months[0].slice(0, 4) === months[1].slice(0, 4)
  ? `${MONTH_NAMES[Number(months[0].slice(5, 7)) - 1]}, ${MONTH_NAMES[Number(months[1].slice(5, 7)) - 1]} ${months[1].slice(0, 4)}`
  : months.map(monthName).join(', ')
const cleanup = { users: [], familyId: '', bookingId: '', subscriptionId: '' }

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
    // An existing parent with an account, one child and no recurring billing.
    const adminEmail = `arrears-admin-${stamp}@example.com`
    const adminPassword = `Verify-${stamp}-admin!`
    const adminUser = await createUser(adminEmail, adminPassword, 'admin', 'Arrears Verify Admin')
    const adminToken = (await createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.signInWithPassword({ email: adminEmail, password: adminPassword })).data.session.access_token
    const parentPassword = `Verify-${stamp}-parent!`
    const parentUser = await createUser(parentEmail, parentPassword, 'parent', familyName)
    // Creating a parent login creates their family (as a real sign-up does); bill that one.
    const signupFamily = await waitFor(async () => (await service.from('parent_families').select('id').eq('owner_user_id', parentUser.id).maybeSingle()).data, "the parent's family")
    cleanup.familyId = signupFamily.id
    await service.from('parent_families').update({ guardian_name: familyName }).eq('id', cleanup.familyId)
    // Two children (Ada has a second record from another booking, which must count once).
    await service.from('students').insert([
      { id: `student-verify-${stamp}-1`, family_id: cleanup.familyId, parent_name: familyName, parent_email: parentEmail, name: `Ada Verify${tag}`, date_of_birth: '2016-04-02', membership_status: 'inactive' },
      { id: `student-verify-${stamp}-1b`, family_id: cleanup.familyId, parent_name: familyName, parent_email: parentEmail, name: `Ada Verify${tag}`, date_of_birth: '2016-04-02', membership_status: 'inactive' },
      { id: `student-verify-${stamp}-2`, family_id: cleanup.familyId, parent_name: familyName, parent_email: parentEmail, name: `Ben Verify${tag}`, date_of_birth: '2019-11-20', membership_status: 'inactive' },
    ])
    console.log(`Admin ${adminUser.email}, parent ${parentEmail}, months ${months.join(' + ')}\n`)

    /* ---------------- A. Manual arrears ---------------- */
    const admin = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
    await signIn(admin, adminEmail, adminPassword, 'Operations dashboard')
    await admin.goto(`${serverBase}/?r=1#ops/arrears`)
    await admin.getByRole('heading', { name: 'Arrears' }).first().waitFor({ timeout: 30000 })
    await admin.getByRole('button', { name: 'Create arrears' }).click()
    const arrearsForm = admin.getByRole('dialog', { name: 'Create arrears' })
    await arrearsForm.getByLabel('Parent / family').selectOption(cleanup.familyId)
    await arrearsForm.getByLabel('Amount owed (£)').fill('42.50')
    await arrearsForm.getByLabel('Reason').fill(reason)
    for (const month of months) await arrearsForm.getByRole('button', { name: monthName(month), exact: true }).click()
    const preview = await arrearsForm.innerText()
    check('Form preview: who, £42.50 and both months', preview.includes(parentEmail) && preview.includes('£42.50') && preview.includes(expectedLabel), expectedLabel)
    await shot(admin, 'arrears-create-form')
    const createdResponse = admin.waitForResponse((response) => response.url().endsWith('/api/invoices/arrears/manual') && response.request().method() === 'POST', { timeout: 60000 })
    await arrearsForm.getByRole('button', { name: 'Create and email parent' }).click()
    const created = await (await createdResponse).json()
    check('Arrears created and emailed', Boolean(created.id && created.emailId), `${created.invoiceNumber || created.error}, email ${created.emailId}`)
    if (!created.id) throw new Error(created.error || 'Arrears were not created')
    cleanup.bookingId = created.id
    await admin.getByText(`Arrears ${created.invoiceNumber} for £42.50`).waitFor({ timeout: 15000 })

    const { data: row } = await service.from('bookings').select('*').eq('id', created.id).single()
    check('Stored as a sent family invoice for £42.50', row.invoice_status === 'Sent' && row.family_id === cleanup.familyId && Number(row.price) === 42.5 && Boolean(row.invoice_sent_at) && row.invoice_number === created.invoiceNumber, `${row.invoice_number}, due ${row.invoice_due_date}`)
    check('Reason and both months stored', row.arrears_reason === reason && JSON.stringify(row.arrears_months) === JSON.stringify(months), JSON.stringify(row.arrears_months))

    // The email as Resend has it.
    const arrearsEmail = await waitFor(async () => { const email = await resendEmail(created.emailId); return email?.html ? email : null }, 'the arrears email in Resend')
    const payPath = `/api/invoices/pay/${row.invoice_pay_token}`
    check('Email to the parent, admin copied', arrearsEmail.to?.includes(parentEmail) && (!process.env.ADMIN_NOTIFICATION_EMAIL || (arrearsEmail.bcc || []).includes(process.env.ADMIN_NOTIFICATION_EMAIL)), `to ${arrearsEmail.to}, bcc ${arrearsEmail.bcc}`)
    check('Email subject: amount and months', arrearsEmail.subject.includes('£42.50') && arrearsEmail.subject.includes(expectedLabel), arrearsEmail.subject)
    check('Email body: amount, reason, months, invoice number, Pay now link', ['£42.50', reason, expectedLabel, created.invoiceNumber, 'Pay £42.50 now', payPath].every((text) => arrearsEmail.html.includes(text)))
    const arrearsEvent = await waitFor(async () => { const email = await resendEmail(created.emailId); return ['delivered', 'bounced'].includes(email.last_event) ? email.last_event : null }, 'Resend delivery', 20).catch(() => 'not yet')
    check('Resend delivered the arrears email', arrearsEvent === 'delivered', arrearsEvent)

    // Admin arrears dashboard.
    await admin.goto(`${serverBase}/?r=2#ops/arrears`)
    const payerRow = admin.locator('tr', { hasText: familyName })
    await payerRow.waitFor({ timeout: 30000 })
    await payerRow.click()
    const detail = admin.locator('td[colspan="5"]')
    await detail.getByText(`Covers ${expectedLabel}`).waitFor()
    const detailText = await detail.innerText()
    check('Arrears dashboard: family, £42.50, reason, months, manual tag', (await payerRow.innerText()).includes('£42.50') && detailText.includes(reason) && /manual arrears/i.test(detailText) && detailText.includes(created.invoiceNumber))
    await shot(admin, 'arrears-dashboard')

    // Parent's own Invoices tab, then pay it.
    const parent = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
    await signIn(parent, parentEmail, parentPassword, `Welcome, ${familyName}`)
    await parent.goto(`${serverBase}/?r=3#ops/invoices`)
    await parent.getByRole('heading', { name: 'Invoices' }).waitFor({ timeout: 30000 })
    const invoiceRow = parent.locator('tr', { hasText: created.invoiceNumber })
    const invoiceText = await invoiceRow.innerText()
    check("Parent's Invoices tab: £42.50, reason, months, To pay, Pay now", invoiceText.includes('£42.50') && invoiceText.includes(reason) && invoiceText.includes(`Covers ${expectedLabel}`) && /To pay/i.test(invoiceText) && await invoiceRow.getByRole('link', { name: 'Pay now' }).count() === 1, invoiceText.replace(/\s+/g, ' '))
    await shot(parent, 'parent-invoices-arrears')
    // Pay links point at APP_URL (the live site); open the same path on this server.
    const payHref = await invoiceRow.getByRole('link', { name: 'Pay now' }).getAttribute('href')
    check('Pay now is the same link as the email', new URL(payHref).pathname === payPath, payHref)
    await parent.goto(`${serverBase}${payPath}`)
    await parent.getByText(expectedLabel).first().waitFor()
    await shot(parent, 'arrears-pay-page')
    await parent.getByRole('button', { name: 'Pay £42.50 by card →' }).click()
    await parent.waitForURL(/checkout\.stripe\.com/, { timeout: 90000, waitUntil: 'commit' })
    const paySessionId = /\/(cs_test_[A-Za-z0-9]+)/.exec(parent.url())[1]
    const paySession = await stripe.checkout.sessions.retrieve(paySessionId)
    check('Stripe Checkout charges £42.50 for this invoice', paySession.amount_total === 4250 && paySession.mode === 'payment' && paySession.metadata.invoice_booking_id === created.id)
    await payWithTestCard(parent)
    await parent.waitForURL(/\/done\?session_id=/, { timeout: 60000 })
    const payDelivery = await replayCheckoutEvent(paySessionId)
    check('Webhook accepts the payment', payDelivery.status === 200, `HTTP ${payDelivery.status}`)
    const { data: paid } = await service.from('bookings').select('invoice_status,invoice_paid_amount_pence,invoice_payment_session_id').eq('id', created.id).single()
    check('Arrears marked Paid for £42.50', paid.invoice_status === 'Paid' && paid.invoice_paid_amount_pence === 4250 && paid.invoice_payment_session_id === paySessionId)
    await parent.goto(`${serverBase}/?r=4#ops/invoices`)
    await parent.getByRole('heading', { name: 'Invoices' }).waitFor({ timeout: 30000 })
    check("Parent's Invoices tab shows it Paid", /Paid/.test(await parent.locator('tr', { hasText: created.invoiceNumber }).innerText()))
    const arrearsAfter = await fetch(`${serverBase}/api/invoices/arrears`, { headers: { Authorization: `Bearer ${adminToken}` } }).then((response) => response.json())
    check('Paid arrears leave the arrears list', !(arrearsAfter.payers || []).some((payer) => payer.invoices.some((item) => item.id === created.id)))

    /* ---------------- B. Subscription request ---------------- */
    await admin.goto(`${serverBase}/?r=5#ops/subscriptions`)
    // Not subscribed yet: not in the Subscriptions table, but listed (collapsed)
    // under accounts without a subscription as confirmed with no plan.
    await admin.getByRole('heading', { name: 'Subscriptions', exact: true }).waitFor({ timeout: 30000 })
    await admin.getByText('No subscriptions yet').or(admin.locator('tr').nth(1)).first().waitFor()
    check('Unsubscribed family is not in the Subscriptions table', await admin.locator('tr', { hasText: familyName }).count() === 0)
    await admin.getByRole('button', { name: /Parent accounts without a subscription/ }).click()
    const familyRow = admin.locator('tr', { hasText: familyName })
    await familyRow.waitFor({ timeout: 30000 })
    await familyRow.getByText('Confirmed · no plan yet').waitFor({ timeout: 15000 })
    check('Listed under accounts without a subscription as "Confirmed · no plan yet"', true)
    await shot(admin, 'subscriptions-accounts-without')
    await familyRow.getByRole('button', { name: 'Subscription request…' }).click()
    const requestForm = admin.getByRole('dialog', { name: 'Send subscription request' })
    await requestForm.getByText('2 children = £50.00/month').first().waitFor({ timeout: 15000 })
    check('Form prices it per child: 2 children = £50.00/month', (await requestForm.innerText()).includes('for 2 children at £50.00/month (£25.00 per child)'))
    await shot(admin, 'subscription-request-form')
    const sentResponse = admin.waitForResponse((response) => response.url().endsWith('/api/admin/subscription-requests') && response.request().method() === 'POST', { timeout: 60000 })
    await requestForm.getByRole('button', { name: 'Send request' }).click()
    const sent = await (await sentResponse).json()
    check('Subscription request sent for 2 children, £50.00/month', Boolean(sent.id && sent.emailId) && sent.children === 2 && sent.totalPence === 5000, sent.error || `${sent.children} children, ${sent.totalPence}`)
    if (!sent.id) throw new Error(sent.error || 'Subscription request was not sent')
    await admin.locator('tr', { hasText: familyName }).getByText(/Request sent .* not completed yet/).waitFor({ timeout: 15000 })
    await shot(admin, 'subscription-request-sent')
    const { data: requestRow } = await service.from('subscription_requests').select('*').eq('id', sent.id).single()
    check('Request logged as sent for the Monthly plan', requestRow.status === 'sent' && requestRow.plan_type === 'monthly_membership' && requestRow.family_id === cleanup.familyId && requestRow.recipient === parentEmail)

    const requestEmail = await waitFor(async () => { const email = await resendEmail(sent.emailId); return email?.html ? email : null }, 'the subscription email in Resend')
    const subscribePath = `/api/subscribe/${requestRow.token}`
    check('Email: plan, £25.00 per child, 2 children = £50.00 a month, explanation and the link', requestEmail.to?.includes(parentEmail) && requestEmail.subject.includes('Monthly Membership') && requestEmail.subject.includes('£50.00/month') && ['Monthly Membership', '£25.00 a month per child', '2 children', '£50.00 a month', 'first payment of £50.00', 'secure checkout', 'cancel at any time', subscribePath].every((text) => requestEmail.html.includes(text)), requestEmail.subject)
    const requestEvent = await waitFor(async () => { const email = await resendEmail(sent.emailId); return ['delivered', 'bounced'].includes(email.last_event) ? email.last_event : null }, 'Resend delivery', 20).catch(() => 'not yet')
    check('Resend delivered the subscription email', requestEvent === 'delivered', requestEvent)

    // Click through: the email's link (APP_URL) opened on this server goes straight to Stripe.
    const emailLink = /href="([^"]*\/api\/subscribe\/[a-f0-9]{32})"/.exec(requestEmail.html)[1]
    await parent.goto(`${serverBase}${new URL(emailLink).pathname}`)
    await parent.waitForURL(/checkout\.stripe\.com/, { timeout: 90000, waitUntil: 'commit' })
    const subSessionId = /\/(cs_test_[A-Za-z0-9]+)/.exec(parent.url())[1]
    const subSession = await stripe.checkout.sessions.retrieve(subSessionId, { expand: ['line_items'] })
    check('Link opens Stripe Checkout in subscription mode: Monthly price × 2 children = £50.00', subSession.mode === 'subscription' && subSession.line_items.data[0]?.price?.id === process.env.STRIPE_MONTHLY_PRICE_ID && subSession.line_items.data[0]?.quantity === 2 && subSession.metadata.kind === 'subscription_request' && subSession.metadata.subscription_request_id === sent.id && subSession.amount_total === 5000, `${subSession.mode}, qty ${subSession.line_items.data[0]?.quantity}, ${subSession.amount_total}`)
    await shot(parent, 'subscription-stripe-checkout')
    await payWithTestCard(parent)
    await parent.waitForURL(/\/api\/subscribe\/[a-f0-9]{32}\/done\?session_id=/, { timeout: 90000 })
    const doneText = await parent.locator('body').innerText()
    check("Return page: You're all set", doneText.includes("You're all set"), doneText.split('\n').find((line) => line.trim()) || '')
    await shot(parent, 'subscription-done')

    const { data: family } = await service.from('parent_families').select('*').eq('id', cleanup.familyId).single()
    cleanup.subscriptionId = family.stripe_subscription_id
    check('Family is active on the Monthly Membership with the Stripe subscription', family.membership_status === 'active' && family.plan_type === 'monthly_membership' && /^sub_/.test(family.stripe_subscription_id || '') && /^cus_/.test(family.stripe_customer_id || ''), family.stripe_subscription_id)
    const subscription = await stripe.subscriptions.retrieve(family.stripe_subscription_id)
    check('Stripe subscription is active: £25/month × 2 = £50/month', subscription.status === 'active' && subscription.items.data[0]?.price?.id === process.env.STRIPE_MONTHLY_PRICE_ID && subscription.items.data[0]?.quantity === 2, `${subscription.status}, qty ${subscription.items.data[0]?.quantity}`)
    const { data: completedRequest } = await service.from('subscription_requests').select('status,completed_at,stripe_subscription_id').eq('id', sent.id).single()
    check('Request marked completed', completedRequest.status === 'completed' && completedRequest.stripe_subscription_id === family.stripe_subscription_id)
    const { data: kids } = await service.from('students').select('membership_status').eq('family_id', cleanup.familyId)
    check("Both children's memberships are now active", kids.length === 3 && kids.every((kid) => kid.membership_status === 'active'))

    const subDelivery = await replayCheckoutEvent(subSessionId)
    const { data: afterReplay } = await service.from('subscription_requests').select('completed_at').eq('id', sent.id).single()
    check('Webhook delivery of the same checkout is accepted and changes nothing', subDelivery.status === 200 && afterReplay.completed_at === completedRequest.completed_at, `HTTP ${subDelivery.status}`)

    // Admin record.
    await admin.goto(`${serverBase}/?r=6#ops/subscriptions`)
    const subscribedRow = admin.locator('tr', { hasText: familyName })
    await subscribedRow.getByText(/Subscription request completed/).waitFor({ timeout: 30000 })
    const familyText = await subscribedRow.innerText()
    check('Admin Subscriptions table: Monthly Membership, Active, Stripe subscription, request completed', familyText.includes('Monthly Membership') && /active/i.test(familyText) && familyText.includes(family.stripe_subscription_id.slice(0, 14)) && await subscribedRow.getByRole('button', { name: 'Subscription request…' }).count() === 0, familyText.replace(/\s+/g, ' '))
    await shot(admin, 'subscription-admin-active')

    // Parent dashboard.
    await parent.goto(`${serverBase}/?r=7#ops/dashboard`)
    await parent.getByText('Plan status').waitFor({ timeout: 30000 })
    const dashText = await parent.locator('main').innerText()
    check('Parent dashboard: £25 / month, active, Cancel subscription available', dashText.includes('£25 / month') && /active/.test(dashText) && dashText.includes('Cancel subscription'))
    await shot(parent, 'subscription-parent-dashboard')

    // Guards.
    const again = await fetch(`${serverBase}${subscribePath}`, { redirect: 'manual' })
    check('Old link now says Already set up (no new checkout)', again.status === 200 && (await again.text()).includes('Already set up'))
    const second = await fetch(`${serverBase}/api/admin/subscription-requests`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ familyId: cleanup.familyId, planType: 'monthly_membership' }) })
    check('A second request for a subscribed family is refused', second.status === 409, `HTTP ${second.status}`)
    const { data: emptyFamily } = await service.from('parent_families').insert({ id: `family-verify-empty-${stamp}`, guardian_name: `${familyName} (no children)`, guardian_email: `delivered+kada-arrears-empty-${stamp}@resend.dev`, membership_status: 'pending' }).select('id').single()
    const noKids = await fetch(`${serverBase}/api/admin/subscription-requests`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ familyId: emptyFamily.id, planType: 'monthly_membership' }) })
    check('A family with no children on file is refused (priced per child)', noKids.status === 400, `HTTP ${noKids.status}`)
    await service.from('parent_families').delete().eq('id', emptyFamily.id)
    const anonymous = await fetch(`${serverBase}/api/invoices/arrears/manual`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ familyId: cleanup.familyId, amount: 10, reason: 'x', months }) })
    check('Creating arrears needs a signed-in sales/admin user', anonymous.status === 401, `HTTP ${anonymous.status}`)
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
    console.log(`\nKEEP=1: left family ${cleanup.familyId}, arrears ${cleanup.bookingId}, subscription ${cleanup.subscriptionId} and the test logins in place.`)
  } else {
    if (cleanup.subscriptionId) await stripe.subscriptions.cancel(cleanup.subscriptionId).catch((error) => console.error('Stripe cancel failed:', error.message))
    if (cleanup.bookingId) await service.from('bookings').delete().eq('id', cleanup.bookingId)
    if (cleanup.familyId) {
      await service.from('students').delete().eq('family_id', cleanup.familyId)
      await service.from('profiles').update({ family_id: null }).eq('family_id', cleanup.familyId)
      await service.from('parent_families').delete().eq('id', cleanup.familyId) // cascades subscription_requests
    }
    for (const id of cleanup.users) {
      const { error } = await service.auth.admin.deleteUser(id)
      if (error) console.error(`Could not delete test user ${id}:`, error.message)
    }
    console.log('\nCleaned up the test family, arrears, Stripe test subscription and logins.')
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}
