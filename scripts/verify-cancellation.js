import 'dotenv/config'
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

// Live check that cancelling a membership really changes the children, against
// the LIVE Supabase project, Stripe TEST mode and Resend. Four test families,
// each with children on today's "Saturday Gospel Afrobeats" register:
//   A. admin cancels on Sales > Subscriptions ("Cancel subscription")
//   B. the parent cancels from their own dashboard
//   C. Stripe deletes the subscription (customer.subscription.deleted webhook)
//   D. admin uses "Mark cancelled" on a family with no Stripe subscription,
//      then "Mark active" to bring the children back
// With supabase/migrations/20261003_students_cancelled_status.sql applied, each
// child must end up 'cancelled' in the database, show red "cancelled" on the
// Students page, drop off the Attendance register, and the family must read
// "Cancelled" on Subscriptions. Without it, every path must fail LOUDLY: an
// error naming the migration on screen / non-200 to Stripe, and an alert email
// to the admin inbox (never a silent success).
// Everything created is deleted at the end unless KEEP=1.
//
// Requires: node server/index.js on PORT (default 4242) serving a build of this
// code; PLAYWRIGHT_CORE=<path to playwright-core>.

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const serverBase = `http://localhost:${process.env.PORT || 4242}`
const CLASS = 'Saturday Gospel Afrobeats'
const stamp = Date.now()
const tag = String(stamp).slice(-6)
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
const startedAt = new Date()
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const shot = (page, name) => (process.env.SCREENSHOT_DIR ? page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/cancel-${name}.png`, fullPage: true }) : null)

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures += 1
}
const cleanup = { users: [], families: [], subscriptions: [], customers: [] }

async function createUser(email, password, role, fullName) {
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role, full_name: fullName }, app_metadata: { signup_notified_at: new Date().toISOString() } })
  if (error) throw error
  cleanup.users.push(data.user.id)
  await service.from('profiles').update({ role, full_name: fullName }).eq('id', data.user.id)
  const { data: signedIn, error: signInError } = await createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  return { user: data.user, session: signedIn.session }
}

async function stripeSubscription(name) {
  const customer = await stripe.customers.create({ name, email: `delivered+kada-cancel-${stamp}@resend.dev`, payment_method: 'pm_card_visa', invoice_settings: { default_payment_method: 'pm_card_visa' } })
  cleanup.customers.push(customer.id)
  const subscription = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: process.env.STRIPE_MONTHLY_PRICE_ID, quantity: 1 }] })
  cleanup.subscriptions.push(subscription.id)
  return { customer: customer.id, subscription: subscription.id }
}

async function family(key, { familyId, withStripe, kids }) {
  const name = `Cancel Verify ${key} ${tag}`
  const id = familyId || `family-verify-cancel-${stamp}-${key}`
  const billing = withStripe ? await stripeSubscription(name) : null
  const row = { guardian_name: name, guardian_email: `delivered+kada-cancel-${key.toLowerCase()}-${stamp}@resend.dev`, plan_type: 'monthly_membership', membership_status: 'active', ...(billing ? { stripe_customer_id: billing.customer, stripe_subscription_id: billing.subscription } : {}) }
  const { error } = familyId ? await service.from('parent_families').update(row).eq('id', id) : await service.from('parent_families').insert({ id, ...row })
  if (error) throw error
  if (!familyId) cleanup.families.push(id)
  const children = Array.from({ length: kids }, (_, index) => ({ id: `student-vcancel-${stamp}-${key}${index}`, family_id: id, parent_name: name, parent_email: row.guardian_email, name: `${'AB'[index]}${key.toLowerCase()} Cancelverify${tag}`, date_of_birth: '2016-05-01', class_name: CLASS, term: today, membership_status: 'active' }))
  const { error: kidsError } = await service.from('students').insert(children)
  if (kidsError) throw kidsError
  return { id, name, subscription: billing?.subscription, children }
}

const statuses = async (fam) => (await service.from('students').select('id,membership_status').eq('family_id', fam.id)).data.map((row) => row.membership_status)
const familyStatus = async (fam) => (await service.from('parent_families').select('membership_status').eq('id', fam.id).single()).data.membership_status

async function openAs(browser, session, viewport = { width: 1280, height: 1000 }) {
  const context = await browser.newContext({ viewport })
  const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
  await context.addInitScript(([name, value]) => window.localStorage.setItem(name, value), [storageKey, JSON.stringify(session)])
  const page = await context.newPage()
  page.dialogs = []
  page.on('dialog', (dialog) => { page.dialogs.push(dialog.message()); return page.declineNext ? (page.declineNext = false, dialog.dismiss()) : dialog.accept() })
  return page
}

// The admin alert inbox: Resend's list of recently sent emails.
async function alertEmails() {
  const result = await fetch('https://api.resend.com/emails?limit=50', { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } }).then((response) => response.json())
  return (result.data || []).filter((email) => new Date(email.created_at) >= new Date(startedAt.getTime() - 5000) && /^\[KADA\] Not saved: Children of a cancelled membership/.test(email.subject || ''))
}

async function rosterIds(adminClient) {
  const { data, error } = await adminClient.rpc('attendance_roster', { p_class: CLASS, p_date: today })
  if (error) throw error
  return new Set(data.filter((row) => row.registered).map((row) => row.student_id))
}

async function registerShows(page, child) {
  await page.goto(`${serverBase}/?r=${Math.random()}#ops/attendance`)
  await page.getByLabel('Class').waitFor({ timeout: 30000 })
  await page.getByLabel('Class').selectOption(CLASS)
  await page.getByLabel('Session date').fill(today)
  await page.getByText(/not marked/).first().waitFor({ timeout: 30000 })
  return (await page.getByRole('button', { name: `${child.name}: Present` }).count()) > 0
}

async function studentsBadge(page, child) {
  await page.goto(`${serverBase}/?r=${Math.random()}#ops/students`)
  const row = page.locator('.student-row-link', { hasText: child.name })
  await row.waitFor({ timeout: 30000 })
  return (await row.innerText()).toLowerCase()
}

async function subscriptionRow(page, fam) {
  await page.goto(`${serverBase}/?r=${Math.random()}#ops/subscriptions`)
  await page.getByRole('heading', { name: 'Subscriptions', exact: true }).waitFor({ timeout: 30000 })
  const row = page.locator('tr', { hasText: fam.name })
  await row.waitFor({ timeout: 30000 })
  return row
}

async function toastText(page) {
  const toast = page.locator('[role=status], .toast').last()
  await toast.waitFor({ timeout: 15000 }).catch(() => {})
  return (await toast.innerText().catch(() => '')).trim()
}

async function run() {
  // Is the migration applied? Probe the constraint directly.
  const probeId = `student-vcancel-${stamp}-probe`
  const probe = await service.from('students').insert({ id: probeId, name: 'Probe', parent_name: 'Probe', parent_email: 'delivered@resend.dev', date_of_birth: '2016-01-01', membership_status: 'cancelled' })
  await service.from('students').delete().eq('id', probeId)
  const migrated = !probe.error
  console.log(migrated ? 'Migration applied: expecting every cancellation to stick.\n' : `Migration NOT applied (${probe.error.message}): expecting every cancellation to fail loudly.\n`)

  const admin = await createUser(`cancel-admin-${stamp}@example.com`, `Verify-${stamp}-admin!`, 'admin', 'Cancel Verify Admin')
  const parentEmail = `delivered+kada-cancel-parent-${stamp}@resend.dev`
  const parent = await createUser(parentEmail, `Verify-${stamp}-parent!`, 'parent', `Cancel Verify B ${tag}`)
  const signupFamily = await (async () => { for (let i = 0; i < 20; i += 1) { const { data } = await service.from('parent_families').select('id').eq('owner_user_id', parent.user.id).maybeSingle(); if (data) return data; await sleep(1000) } throw new Error('No sign-up family') })()
  cleanup.families.push(signupFamily.id)

  const A = await family('A', { withStripe: true, kids: 2 })
  const B = await family('B', { familyId: signupFamily.id, withStripe: true, kids: 1 })
  const C = await family('C', { withStripe: true, kids: 1 })
  const D = await family('D', { withStripe: false, kids: 2 })
  const all = [A, B, C, D]
  const adminClient = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${admin.session.access_token}` } } })

  const before = await rosterIds(adminClient)
  check('Before: every test child is on today\'s register', all.every((fam) => fam.children.every((child) => before.has(child.id))))

  const { chromium } = await import(process.env.PLAYWRIGHT_CORE)
  const root = `${process.env.HOME}/.cache/ms-playwright`
  const dir = fs.readdirSync(root).find((name) => /^chromium-\d+$/.test(name))
  const browser = await chromium.launch({ executablePath: `${root}/${dir}/${fs.readdirSync(`${root}/${dir}`).find((name) => name.startsWith('chrome-linux'))}/chrome` })
  try {
    const page = await openAs(browser, admin.session)
    check('Before: Attendance page lists a test child', await registerShows(page, A.children[0]))

    /* A. Admin: Sales > Subscriptions > Cancel subscription (asks first) */
    let row = await subscriptionRow(page, A)
    page.declineNext = true
    await row.locator('.ops-status-btn').click()
    await page.getByRole('button', { name: 'Cancel subscription' }).click()
    await sleep(2000)
    check('A: admin is asked "Are you sure…" first', /^Are you sure you want to cancel Cancel Verify A \d+'s subscription\?/.test(page.dialogs.at(-1) || ''), page.dialogs.at(-1))
    check('A: answering No changes nothing', (await stripe.subscriptions.retrieve(A.subscription)).status === 'active' && await familyStatus(A) === 'active')
    const cancelResponse = page.waitForResponse((response) => response.url().includes(`/api/admin/subscriptions/${A.id}/cancel`), { timeout: 60000 })
    await row.locator('.ops-status-btn').click()
    await page.getByRole('button', { name: 'Cancel subscription' }).click()
    const aResponse = await cancelResponse
    const aBody = await aResponse.json()
    const aToast = await toastText(page)
    await shot(page, 'A-after-cancel')
    check('A: Stripe subscription is cancelled', (await stripe.subscriptions.retrieve(A.subscription)).status === 'canceled')
    check('A: family is cancelled in the database', await familyStatus(A) === 'cancelled')
    if (migrated) {
      check('A: admin sees success', aResponse.status() === 200 && /Subscription cancelled/.test(aToast), `HTTP ${aResponse.status()}, "${aToast}"`)
      check('A: both children cancelled in the database', (await statuses(A)).every((status) => status === 'cancelled'), (await statuses(A)).join())
    } else {
      check('A: admin sees an error naming the migration (not "cancelled")', aResponse.status() === 500 && /20261003_students_cancelled_status/.test(aBody.error) && aToast.includes('20261003_students_cancelled_status'), `HTTP ${aResponse.status()}, "${aToast}"`)
      check('A: children unchanged (still active)', (await statuses(A)).every((status) => status === 'active'))
    }

    /* B. Parent: dashboard > Cancel subscription */
    const parentPage = await openAs(browser, parent.session, { width: 390, height: 844 })
    await parentPage.goto(`${serverBase}/#ops/dashboard`)
    await parentPage.getByRole('button', { name: 'Cancel subscription' }).waitFor({ timeout: 30000 })
    const parentResponse = parentPage.waitForResponse((response) => response.url().endsWith('/api/parent/cancel-subscription'), { timeout: 60000 })
    await parentPage.getByRole('button', { name: 'Cancel subscription' }).click()
    const bResponse = await parentResponse
    check('B: parent is asked "Are you sure…" first', /^Are you sure you want to cancel your Monthly Membership\?/.test(parentPage.dialogs.at(-1) || ''))
    const bToast = await toastText(parentPage)
    await shot(parentPage, 'B-parent-after-cancel')
    check('B: Stripe subscription is cancelled', (await stripe.subscriptions.retrieve(B.subscription)).status === 'canceled')
    const planStatus = (await parentPage.getByText('Plan status').locator('xpath=..').innerText()).toLowerCase()
    check('B: parent dashboard now shows the plan as cancelled', planStatus.includes('cancelled'), planStatus.replace(/\s+/g, ' '))
    if (migrated) {
      check('B: parent sees "Subscription cancelled."', bResponse.status() === 200 && bToast.includes('Subscription cancelled.'), `HTTP ${bResponse.status()}, "${bToast}"`)
      check('B: family and child cancelled in the database', await familyStatus(B) === 'cancelled' && (await statuses(B)).every((status) => status === 'cancelled'), `${await familyStatus(B)} / ${(await statuses(B)).join()}`)
    } else {
      check('B: parent is told the records were not updated (not a clean "cancelled")', bResponse.status() === 500 && /could not be updated/.test(bToast) && !/^Subscription cancelled\.$/.test(bToast), `HTTP ${bResponse.status()}, "${bToast}"`)
    }

    /* C. Stripe deletes the subscription: the webhook */
    const deleted = await stripe.subscriptions.cancel(C.subscription)
    const payload = JSON.stringify({ id: `evt_verify_cancel_${stamp}`, object: 'event', type: 'customer.subscription.deleted', created: Math.floor(Date.now() / 1000), data: { object: deleted } })
    const webhook = await fetch(`${serverBase}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET }) }, body: payload })
    check('C: family cancelled by the webhook', await familyStatus(C) === 'cancelled')
    if (migrated) {
      check('C: webhook answers 200 and the child is cancelled', webhook.status === 200 && (await statuses(C)).every((status) => status === 'cancelled'), `HTTP ${webhook.status}, ${(await statuses(C)).join()}`)
    } else {
      check('C: webhook answers 500 so Stripe retries (child still active)', webhook.status === 500 && (await statuses(C)).every((status) => status === 'active'), `HTTP ${webhook.status}`)
    }

    /* D. No Stripe subscription: "Mark cancelled", then "Mark active" */
    row = await subscriptionRow(page, D)
    await row.locator('.ops-status-btn').click()
    await page.getByRole('button', { name: 'Mark cancelled' }).click()
    const dToast = await toastText(page)
    await shot(page, 'D-after-mark-cancelled')
    check('D: family marked cancelled', await familyStatus(D) === 'cancelled')
    if (migrated) {
      check('D: admin told 2 children were cancelled, and they are', dToast.includes('Family marked cancelled, with 2 children') && (await statuses(D)).every((status) => status === 'cancelled'), `"${dToast}"`)
    } else {
      check('D: admin sees the children were NOT cancelled, naming the migration', dToast.includes('could NOT be') && dToast.includes('20261003_students_cancelled_status'), `"${dToast}"`)
    }

    if (migrated) {
      /* Reflected everywhere */
      const after = await rosterIds(adminClient)
      check('Attendance (database): no cancelled child is on today\'s register', all.every((fam) => fam.children.every((child) => !after.has(child.id))))
      check('Attendance page: cancelled child A is not listed', !(await registerShows(page, A.children[0])))
      await shot(page, 'attendance-after')
      check('Attendance page: cancelled child D is not listed', !(await registerShows(page, D.children[1])))
      for (const [fam, child] of [[A, A.children[0]], [B, B.children[0]], [C, C.children[0]], [D, D.children[1]]]) {
        const text = await studentsBadge(page, child) // eslint-disable-line no-await-in-loop
        check(`Students page: ${fam.name.split(' ')[2]}'s child shows "cancelled"`, /\bcancelled\b/.test(text) && !/\bactive\b/.test(text), text.replace(/\s+/g, ' '))
      }
      await shot(page, 'students-after')
      for (const fam of [A, C, D]) {
        const text = (await (await subscriptionRow(page, fam)).innerText()).replace(/\s+/g, ' ') // eslint-disable-line no-await-in-loop
        check(`Subscriptions page: family ${fam.name.split(' ')[2]} reads "Cancelled"`, /\bcancelled\b/i.test(text), text.slice(0, 160))
      }
      await shot(page, 'subscriptions-after')

      /* D again: "Mark active" brings the children back onto the register */
      row = await subscriptionRow(page, D)
      await row.locator('.ops-status-btn').click()
      await page.getByRole('button', { name: 'Mark active' }).click()
      const restoreToast = await toastText(page)
      check('D: "Mark active" restores both children', restoreToast.includes('Family marked active, with 2 children') && (await statuses(D)).every((status) => status === 'active'), `"${restoreToast}"`)
      check('D: restored child is back on the Attendance page', await registerShows(page, D.children[0]))
    } else {
      check('Nothing showed as cancelled: test children are all still on the register', all.every((fam) => fam.children.every((child) => before.has(child.id))))
    }
  } finally {
    await browser.close()
  }

  if (!migrated) {
    let alerts = []
    for (let i = 0; i < 10 && !alerts.length; i += 1) { alerts = await alertEmails(); if (!alerts.length) await sleep(2000) } // eslint-disable-line no-await-in-loop
    check('Admin alert email sent to the alert inbox ("Not saved: Children of a cancelled membership…")', alerts.length > 0, alerts.map((email) => `${email.to} · ${email.subject}`).join(' | ') || 'none found (an alert for the same error is held back for 30 minutes per server run)')
  }
}

try {
  await run()
} catch (error) {
  failures += 1
  console.error('Verification aborted:', error.message)
} finally {
  if (process.env.KEEP === '1') {
    console.log(`\nKEEP=1: left families ${cleanup.families.join(', ')} and the test logins in place.`)
  } else {
    for (const id of cleanup.subscriptions) await stripe.subscriptions.cancel(id).catch(() => {}) // eslint-disable-line no-await-in-loop
    for (const id of cleanup.customers) await stripe.customers.del(id).catch(() => {}) // eslint-disable-line no-await-in-loop
    for (const id of cleanup.families) {
      await service.from('students').delete().eq('family_id', id) // eslint-disable-line no-await-in-loop
      await service.from('profiles').update({ family_id: null }).eq('family_id', id) // eslint-disable-line no-await-in-loop
      await service.from('parent_families').delete().eq('id', id) // eslint-disable-line no-await-in-loop
    }
    for (const id of cleanup.users) {
      const { error } = await service.auth.admin.deleteUser(id) // eslint-disable-line no-await-in-loop
      if (error) console.error(`Could not delete test user ${id}:`, error.message)
    }
    console.log('\nCleaned up the test families, children, Stripe test subscriptions/customers and logins.')
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}
