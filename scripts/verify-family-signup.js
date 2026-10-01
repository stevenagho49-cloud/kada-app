import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

// Browser walk-through, against the LIVE Supabase project, Stripe TEST mode and
// Resend, of an offline family who already owes an invoice signing up:
//   1. Admin (temporary account) records an offline family's booking through
//      Bookings > New booking > Parent / family; it is confirmed, so the invoice
//      is emailed; the admin then takes £5 off it in the invoice editor
//   2. The parent signs up through the real sign-up form with the same email
//      (different letter case) and three children, one of whom the admin already
//      had on file; Supabase's confirmation email is checked in Resend, then the
//      address is confirmed with the service role (the link went to a test inbox)
//   3. The parent's dashboard shows the invoice (£55.00, Pay now) and each child
//      once; the empty sign-up family is folded into the existing one
//   4. They add a fourth child afterwards from the Children tab
//   5. Pay now → Stripe Checkout (test card) → the webhook event is delivered to
//      this server → the invoice is Paid in the parent's Invoices tab
//   6. They book a class for two of their children (100% code, so no card):
//      the children are attached to the booking, not duplicated
//   7. Admin Students and Bookings pages list every child once and the booking
// Everything created is deleted at the end (Stripe test payment stays in Stripe).
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

const parentEmail = `delivered+kada-family-${stamp}@resend.dev`
const familyName = `Verify Family ${tag}`
const children = [
  { name: `Ada Verify${tag}`, dateOfBirth: '2016-04-02' },
  { name: `Ben Verify${tag}`, dateOfBirth: '2019-11-20' },
  { name: `Chloe Verify${tag}`, dateOfBirth: '2014-03-03' }, // already on file from the offline booking
]
const laterChild = { name: `Dan Verify${tag}`, dateOfBirth: '2020-06-15' }
const freeCode = `VFAM${tag}`
const cleanup = { users: [], familyEmail: parentEmail.toLowerCase(), codeIds: [] }

async function waitFor(fn, label, tries = 30) {
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

async function run() {
  const { chromium } = await import(process.env.PLAYWRIGHT_CORE)
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
  try {
    // Temporary admin.
    const adminEmail = `family-admin-${stamp}@example.com`
    const adminPassword = `Verify-${stamp}-admin!`
    const { data: adminUser } = await service.auth.admin.createUser({ email: adminEmail, password: adminPassword, email_confirm: true, user_metadata: { role: 'staff' }, app_metadata: { signup_notified_at: new Date().toISOString() } })
    cleanup.users.push(adminUser.user.id)
    await service.from('profiles').update({ role: 'admin', full_name: 'Family Verify Admin' }).eq('id', adminUser.user.id)
    const adminToken = (await createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.signInWithPassword({ email: adminEmail, password: adminPassword })).data.session.access_token
    const code = await fetch(`${serverBase}/api/admin/discount-codes`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ code: freeCode, appliesTo: ['class'], type: 'percent', value: 100 }) }).then((response) => response.json())
    cleanup.codeIds.push(code.code?.id)

    // 1. Admin records the offline family's booking; confirming it emails the invoice.
    const admin = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
    await signIn(admin, adminEmail, adminPassword, 'Operations dashboard')
    await admin.goto(`${serverBase}/?r=1#ops/bookings`)
    await admin.getByRole('button', { name: '+ New booking' }).first().click()
    const form = admin.locator('form').filter({ hasText: 'Parent / family' })
    await form.getByLabel('Parent / family', { exact: true }).check()
    await form.getByLabel(/^Family/).selectOption('__new')
    await form.getByLabel('Parent / guardian name').fill(familyName)
    await form.getByLabel('Parent / guardian email').fill(parentEmail.replace('kada-family', 'KADA-Family'))
    await form.getByLabel('Date', { exact: true }).fill(new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10))
    await form.getByLabel('Session type').selectOption('Custom')
    await form.getByLabel('Price (£)').fill('60')
    await form.getByLabel('Students').fill('1')
    await form.getByLabel('Booking status').selectOption('Confirmed')
    await form.getByLabel('Notes').fill('Saturday classes, September (paid offline, then lapsed)')
    await shot(admin, 'family-new-booking')
    await form.getByRole('button', { name: 'Save booking' }).click()
    const booking = await waitFor(async () => (await service.from('bookings').select('*').ilike('contact_email', cleanup.familyEmail).eq('invoice_status', 'Sent').maybeSingle()).data, 'the invoice to be sent')
    cleanup.bookingId = booking.id
    const { data: family } = await service.from('parent_families').select('*').eq('id', booking.family_id).single()
    cleanup.familyId = family.id
    check('Offline family created with no login; booking invoiced to them', family.owner_user_id === null && booking.family_id === family.id && !booking.school_id && booking.invoice_number?.startsWith('KADA-'), `${booking.invoice_number}, due ${booking.invoice_due_date}`)
    // The child the family already had on file from the offline booking.
    await service.from('students').insert({ id: `student-offline-${stamp}`, family_id: family.id, booking_id: booking.id, parent_name: familyName, parent_email: family.guardian_email, name: children[2].name, date_of_birth: children[2].dateOfBirth, class_name: 'Saturday Gospel Afrobeats', term: booking.date, membership_status: 'active' })

    // £5 off in the invoice editor.
    await admin.goto(`${serverBase}/?r=2#ops/bookings`)
    await admin.getByPlaceholder('Search bookings').fill(familyName)
    await admin.locator('tr', { hasText: familyName }).getByRole('button', { name: 'Invoice' }).click({ timeout: 30000 })
    await admin.locator('select').filter({ has: admin.locator('option[value=amount]') }).selectOption('amount')
    await admin.getByLabel('Discount in pounds').fill('5')
    await admin.getByRole('button', { name: 'Save changes' }).click()
    const discounted = await waitFor(async () => { const { data } = await service.from('bookings').select('invoice_overrides').eq('id', booking.id).single(); return data.invoice_overrides?.discountAmount === 5 ? data : null }, 'the discount to save')
    check('Admin takes £5 off the invoice', discounted.invoice_overrides.discountType === 'amount')
    await shot(admin, 'family-invoice-discount')

    // 2. Parent signs up through the real form, with three children.
    const parent = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
    const signupStart = Date.now()
    await parent.goto(`${serverBase}/`)
    await parent.getByRole('button', { name: 'Sign in' }).first().click()
    await parent.getByRole('button', { name: 'Create a new account' }).click()
    await parent.getByLabel('Account type').selectOption('parent')
    await parent.getByLabel('Full name').fill(familyName)
    for (const [index, child] of children.entries()) {
      if (index > 0) await parent.getByRole('button', { name: '+ Add another child' }).click()
      await parent.getByLabel(`Child ${index + 1} name`).fill(child.name)
      await parent.getByLabel(`Child ${index + 1} date of birth`).fill(child.dateOfBirth)
    }
    await parent.locator('input[type=email]').fill(parentEmail)
    const parentPassword = `Verify-${stamp}-parent!`
    await parent.locator('input[type=password]').fill(parentPassword)
    await shot(parent, 'family-signup-form')
    await parent.getByRole('button', { name: 'Create account' }).click()
    await parent.getByText('Account created.').waitFor({ timeout: 20000 })
    const { data: users } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const parentUser = users.users.find((user) => user.email === cleanup.familyEmail)
    cleanup.users.push(parentUser.id)
    check('Sign-up stores the three children on the account', parentUser.user_metadata.children?.length === 3)
    const confirmation = await waitFor(async () => ((await fetch('https://api.resend.com/emails?limit=30', { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } }).then((response) => response.json())).data || []).find((email) => email.to.includes(cleanup.familyEmail) && email.subject === 'Confirm your email address' && Date.parse(email.created_at.replace(' ', 'T').replace(/\+00$/, 'Z')) >= signupStart - 5000), 'the confirmation email')
    check('Supabase sent the confirmation email (via Resend)', Boolean(confirmation), confirmation?.last_event)
    await service.auth.admin.updateUserById(parentUser.id, { email_confirm: true }) // stands in for clicking the link

    // 3. Their dashboard.
    await signIn(parent, parentEmail, parentPassword, 'Welcome, ' + familyName)
    await parent.getByText('You have 1 invoice to pay (£55.00)').waitFor({ timeout: 20000 })
    check('Dashboard shows the outstanding invoice: 1 to pay, £55.00', true)
    await shot(parent, 'family-dashboard')
    const { data: claimed } = await service.from('parent_families').select('*').eq('id', family.id).single()
    const { data: owned } = await service.from('parent_families').select('id').eq('owner_user_id', parentUser.id)
    const { data: parentProfile } = await service.from('profiles').select('family_id').eq('id', parentUser.id).single()
    check('Existing family now belongs to the new login; sign-up shell removed', claimed.owner_user_id === parentUser.id && owned.length === 1 && parentProfile.family_id === family.id)
    await parent.getByRole('button', { name: 'View invoices' }).click()
    const invoiceRow = parent.locator('tr', { hasText: booking.invoice_number })
    await invoiceRow.waitFor()
    const rowText = await invoiceRow.innerText()
    check('Invoices tab: £55.00, to pay, Pay now', rowText.includes('£55.00') && /Overdue|To pay/i.test(rowText) && await invoiceRow.getByRole('link', { name: 'Pay now' }).count() === 1, rowText.replace(/\s+/g, ' '))
    await shot(parent, 'family-invoices')
    await parent.locator('aside.ops-sidebar').getByRole('button', { name: 'Children' }).click()
    const childrenText = await parent.locator('table').first().innerText()
    for (const child of children) check(`Children tab lists ${child.name.replace(tag, '')} once`, childrenText.split(child.name).length - 1 === 1)
    const { data: familyStudents } = await service.from('students').select('name').eq('family_id', family.id)
    check('Family has 3 child records (no duplicate of the child already on file)', familyStudents.length === 3, familyStudents.map((row) => row.name).join(', '))

    // 4. Add a fourth child afterwards.
    await parent.getByLabel('Child 1 name').fill(laterChild.name)
    await parent.getByLabel('Child 1 date of birth').fill(laterChild.dateOfBirth)
    await parent.getByRole('button', { name: 'Add child', exact: true }).click()
    await parent.getByText(`Added ${laterChild.name}.`).waitFor({ timeout: 15000 })
    check('Child added after sign-up appears in the Children tab', (await parent.locator('table').first().innerText()).includes(laterChild.name))
    await shot(parent, 'family-children')

    // 5. Pay now through Stripe Checkout (test card), then the webhook.
    await parent.locator('aside.ops-sidebar').getByRole('button', { name: /^Invoices/ }).click()
    // Pay links point at APP_URL (the live site); open the same path on this server.
    const payHref = await parent.getByRole('link', { name: 'Pay now' }).getAttribute('href')
    check('Pay now links to the invoice pay page', /\/api\/invoices\/pay\/[a-f0-9]{32}$/.test(payHref), payHref)
    await parent.goto(`${serverBase}${new URL(payHref).pathname}`)
    await parent.getByText('Pay £55.00').first().waitFor()
    await parent.getByRole('button', { name: 'Pay £55.00 by card →' }).click()
    await parent.waitForURL(/checkout\.stripe\.com/, { timeout: 90000, waitUntil: 'commit' })
    const sessionId = /\/(cs_test_[A-Za-z0-9]+)/.exec(parent.url())[1]
    const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId)
    check('Stripe Checkout amount is the discounted £55.00', checkoutSession.amount_total === 5500 && checkoutSession.metadata.invoice_booking_id === booking.id)
    await payWithTestCard(parent)
    await parent.waitForURL(/\/done\?session_id=/, { timeout: 60000 })
    const event = await waitFor(async () => (await stripe.events.list({ type: 'checkout.session.completed', limit: 20 })).data.find((item) => item.data.object.id === sessionId), 'the Stripe event')
    const payload = JSON.stringify(event)
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET })
    const delivered = await fetch(`${serverBase}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': signature }, body: payload })
    check('Stripe checkout.session.completed accepted by the webhook', delivered.status === 200)
    const { data: paid } = await service.from('bookings').select('invoice_status,invoice_paid_amount_pence').eq('id', booking.id).single()
    check('Invoice marked Paid for £55.00', paid.invoice_status === 'Paid' && paid.invoice_paid_amount_pence === 5500)
    await parent.goto(`${serverBase}/?r=3#ops/invoices`)
    await parent.getByRole('heading', { name: 'Invoices' }).waitFor({ timeout: 30000 })
    check("Parent's Invoices tab now shows it as Paid", /Paid/.test(await parent.locator('tr', { hasText: booking.invoice_number }).innerText()))

    // 6. Book a class for two of the children (free code: no card needed).
    await parent.locator('aside.ops-sidebar').getByRole('button', { name: 'Book a class' }).click()
    await parent.getByRole('heading', { name: 'Book a class' }).waitFor()
    const rows = parent.getByLabel(/^Child \d$/)
    for (let index = (await rows.count()) - 1; index >= 2; index -= 1) await parent.getByRole('button', { name: 'Remove' }).nth(index).click()
    await parent.locator('select').filter({ has: parent.locator('option[value=day_pass]') }).selectOption('day_pass')
    await parent.getByLabel('Child 1', { exact: true }).selectOption({ label: children[0].name })
    await parent.getByLabel('Child 2', { exact: true }).selectOption({ label: children[1].name })
    await parent.getByLabel('Discount code').fill(freeCode)
    await parent.getByRole('button', { name: 'Apply' }).click()
    await parent.getByText(`${freeCode}: 100% off`).waitFor()
    await shot(parent, 'family-book-class')
    await parent.getByRole('button', { name: 'Confirm free booking' }).click()
    await parent.getByText("You're booked in!").waitFor({ timeout: 30000 })
    const { data: classBooking } = await service.from('bookings').select('*').eq('family_id', family.id).eq('payment_status', 'paid').like('stripe_checkout_session_id', 'free-%').maybeSingle()
    const { data: afterBooking } = await service.from('students').select('id,name,booking_id,membership_status').eq('family_id', family.id)
    check('Class booking holds both children', classBooking?.student_count === 2)
    check('Booked children reuse their records (still 4 children, none duplicated)', afterBooking.length === 4 && afterBooking.filter((row) => row.booking_id === classBooking?.id).map((row) => row.name).sort().join() === [children[0].name, children[1].name].sort().join(), afterBooking.map((row) => `${row.name}:${row.membership_status}`).join(', '))

    // 7. Admin views.
    await admin.goto(`${serverBase}/?r=4#ops/students`)
    await admin.getByRole('heading', { name: 'Students' }).waitFor({ timeout: 30000 })
    const studentsText = await admin.locator('main').innerText()
    for (const child of [...children, laterChild]) check(`Admin Students lists ${child.name.replace(tag, '')} once`, studentsText.split(child.name).length - 1 === 1)
    await admin.goto(`${serverBase}/?r=5#ops/bookings`)
    await admin.getByPlaceholder('Search bookings').fill(familyName)
    const familyRows = admin.locator('tr', { hasText: familyName })
    await familyRows.first().waitFor({ timeout: 30000 })
    await waitFor(async () => (await familyRows.count()) >= 2, 'both family bookings', 10)
    const rowsText = await familyRows.allInnerTexts()
    check('Admin Bookings shows the family invoice and the class booking, labelled Parent / family', rowsText.length === 2 && rowsText.every((text) => text.includes('Parent / family')) && rowsText.some((text) => /\b2\b/.test(text)), rowsText.map((text) => text.replace(/\s+/g, ' ').slice(0, 90)).join(' | '))
    await shot(admin, 'family-admin-bookings')
  } finally {
    await browser.close()
  }
}

// Stripe-hosted Checkout, test card 4242 4242 4242 4242.
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

try {
  await run()
} catch (error) {
  failures += 1
  console.error('Verification aborted:', error.stack || error.message)
} finally {
  const { data: current } = await service.from('app_settings').select('value').eq('key', 'discount_codes').maybeSingle()
  await service.from('app_settings').upsert({ key: 'discount_codes', value: { codes: (current?.value?.codes || []).filter((item) => !cleanup.codeIds.includes(item.id)) }, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  const { data: families } = await service.from('parent_families').select('id').ilike('guardian_email', cleanup.familyEmail)
  const familyIds = [...new Set([cleanup.familyId, ...(families || []).map((row) => row.id)].filter(Boolean))]
  const { data: bookings } = familyIds.length ? await service.from('bookings').select('id').in('family_id', familyIds) : { data: [] }
  const bookingIds = (bookings || []).map((row) => row.id)
  await service.from('students').delete().in('family_id', familyIds)
  await service.from('invoice_reminders').delete().in('booking_id', bookingIds)
  await service.from('bookings').delete().in('id', bookingIds)
  // Families first: owner_user_id references the login, which blocks deleting it.
  await service.from('parent_families').delete().in('id', familyIds)
  for (const id of cleanup.users) {
    await service.from('parent_families').delete().eq('owner_user_id', id)
    await service.from('profiles').delete().eq('id', id)
    const { error } = await service.auth.admin.deleteUser(id)
    if (error) console.error(`Could not delete test login ${id}: ${error.message}`)
  }
  console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.')
  process.exit(failures ? 1 : 0)
}
