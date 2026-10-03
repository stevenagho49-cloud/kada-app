import 'dotenv/config'
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// Live check of incomplete sign-ups (children in no class), against the LIVE
// Supabase project and Resend. A test parent signs up with two children and
// books nothing; their family is dated 5 days back. Then:
//   1. Students page: "Not yet in a class" lists the family, both children and
//      how long ago they signed up; the children's rows say "Not in a class yet".
//   2. The one-off reminder: the run emails the parent once (a real email to a
//      resend.dev test address, with the children's names and a "Book a class"
//      link), stamps the login, and a second run sends nothing.
//   3. Manual class assignment from the student record puts one child in
//      "Saturday Gospel Afrobeats" from today: the child is then on today's
//      register (database and Attendance page), and leaves the list.
//   4. The staff summary (sent on demand here; weekly on Mondays) reaches the
//      admin inbox and lists the family.
// Only the test family is ever reminded (the run is scoped to it). Everything is
// deleted at the end unless KEEP=1.
//
// Requires: node server/index.js on PORT (default 4242) serving a build of this
// code; PLAYWRIGHT_CORE=<path to playwright-core>.

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const serverBase = `http://localhost:${process.env.PORT || 4242}`
const CLASS = 'Saturday Gospel Afrobeats'
const stamp = Date.now()
const tag = String(stamp).slice(-6)
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
const parentEmail = `delivered+kada-noclass-${stamp}@resend.dev`
const parentName = `Noclass Verify ${tag}`
const kids = [{ name: `Ada Noclass${tag}`, dob: '2016-04-02' }, { name: `Ben Noclass${tag}`, dob: '2018-09-12' }]
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const shot = (page, name) => (process.env.SCREENSHOT_DIR ? page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/noclass-${name}.png`, fullPage: true }) : null)

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures += 1
}
const cleanup = { users: [], familyId: '' }
const resendEmail = (id) => fetch(`https://api.resend.com/emails/${id}`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } }).then((response) => response.json())

async function createUser(email, password, role, fullName, extra = {}) {
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role, full_name: fullName, ...extra }, app_metadata: { signup_notified_at: new Date().toISOString() } })
  if (error) throw error
  cleanup.users.push(data.user.id)
  await service.from('profiles').update({ role, full_name: fullName }).eq('id', data.user.id)
  return data.user
}

async function run() {
  const parent = await createUser(parentEmail, `Verify-${stamp}-parent!`, 'parent', parentName)
  let family
  for (let i = 0; i < 20 && !family; i += 1) { family = (await service.from('parent_families').select('id').eq('owner_user_id', parent.id).maybeSingle()).data; if (!family) await sleep(500) } // eslint-disable-line no-await-in-loop
  cleanup.familyId = family.id
  const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString()
  await service.from('parent_families').update({ guardian_name: parentName, created_at: fiveDaysAgo }).eq('id', family.id)
  const children = kids.map((kid, index) => ({ id: `student-noclass-${stamp}-${index}`, family_id: family.id, parent_name: parentName, parent_email: parentEmail, name: kid.name, date_of_birth: kid.dob, membership_status: 'inactive' }))
  const { error: kidsError } = await service.from('students').insert(children)
  if (kidsError) throw kidsError

  const adminEmail = `noclass-admin-${stamp}@example.com`
  const adminPassword = `Verify-${stamp}-admin!`
  await createUser(adminEmail, adminPassword, 'admin', 'Noclass Verify Admin')
  const session = (await createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.signInWithPassword({ email: adminEmail, password: adminPassword })).data.session
  const api = (path, body) => fetch(`${serverBase}${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, ...(body ? { body: JSON.stringify(body) } : {}) }).then((response) => response.json())
  const adminClient = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${session.access_token}` } } })

  /* 1. The staff list */
  const listed = (await api('/api/admin/families/not-in-class')).families?.find((item) => item.familyId === family.id)
  check('List: family with both children and its sign-up date', listed && listed.children.length === 2 && listed.signedUpAt.slice(0, 10) === fiveDaysAgo.slice(0, 10), JSON.stringify(listed && { children: listed.children.map((kid) => kid.name), signedUpAt: listed.signedUpAt }))

  const { chromium } = await import(process.env.PLAYWRIGHT_CORE)
  const root = `${process.env.HOME}/.cache/ms-playwright`
  const dir = fs.readdirSync(root).find((name) => /^chromium-\d+$/.test(name))
  const browser = await chromium.launch({ executablePath: `${root}/${dir}/${fs.readdirSync(`${root}/${dir}`).find((name) => name.startsWith('chrome-linux'))}/chrome` })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
    await context.addInitScript(([name, value]) => window.localStorage.setItem(name, value), [`sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`, JSON.stringify(session)])
    const page = await context.newPage()
    await page.goto(`${serverBase}/#ops/students`)
    const card = page.getByRole('region', { name: 'Not yet in a class' })
    const familyRow = card.locator('div', { hasText: parentName }).filter({ has: page.getByRole('button', { name: `${kids[0].name} →` }) }).last()
    await familyRow.waitFor({ timeout: 30000 })
    const rowText = (await familyRow.innerText()).replace(/\s+/g, ' ')
    check('Students page: "Not yet in a class" shows the family, "signed up 5 days ago" and both children', rowText.includes('signed up 5 days ago') && rowText.includes(kids[0].name) && rowText.includes(kids[1].name), rowText)
    const childRow = page.locator('.student-row-link', { hasText: kids[1].name })
    check('Students page: the child\'s row says "Not in a class yet"', (await childRow.innerText()).includes('Not in a class yet'))
    await shot(page, '1-list')

    /* 2. The one-off reminder (scoped to this family) */
    const first = await api('/api/admin/families/class-reminders/run', { familyId: family.id })
    const mine = (first.sent || []).find((item) => item.familyId === family.id)
    check('Reminder: sent to the parent', mine?.sent === true && Boolean(mine.emailId), JSON.stringify(first))
    if (mine?.emailId) {
      const email = await resendEmail(mine.emailId)
      check('Reminder email: to the parent, names both children (first names), "Book a class" link, says it is the only reminder', email.to?.[0] === parentEmail && email.html.includes('We noticed Ada and Ben ') && email.html.includes('/#ops/book-class') && email.html.includes("This is the only reminder we'll send"), email.subject)
    }
    const { data: stamped } = await service.auth.admin.getUserById(parent.id)
    check('Reminder: recorded on the parent\'s login', Boolean(stamped.user.app_metadata?.class_reminder_sent_at))
    const second = await api('/api/admin/families/class-reminders/run', { familyId: family.id })
    check('Reminder: a second run sends nothing (no repeat)', (second.sent || []).length === 0, JSON.stringify(second))
    await page.reload()
    await card.getByText('Reminder emailed today').first().waitFor({ timeout: 20000 })
    check('Students page: the list notes "Reminder emailed today"', true)

    /* 3. Put one child in a class by hand */
    await card.getByRole('button', { name: `${kids[0].name} →` }).click()
    const record = page.getByRole('dialog', { name: 'Student record' })
    await record.getByRole('button', { name: 'Put in class' }).waitFor({ timeout: 20000 })
    await record.getByLabel('Class', { exact: true }).selectOption(CLASS)
    await record.getByLabel('Start date').fill(today)
    await record.getByRole('button', { name: 'Put in class' }).click()
    const message = await record.getByRole('status').innerText({ timeout: 20000 })
    check('Record: confirms the child is in the class and on its register', message.includes(`is now in ${CLASS}`), message)
    await shot(page, '3-assigned')
    const { data: saved } = await service.from('students').select('class_name,term,membership_status,booking_id').eq('id', children[0].id).single()
    check('Database: class and start date set, status still inactive, no booking made', saved.class_name === CLASS && saved.term === today && saved.membership_status === 'inactive' && !saved.booking_id, JSON.stringify(saved))
    const { data: roster } = await adminClient.rpc('attendance_roster', { p_class: CLASS, p_date: today })
    check("Register (database): the child is on today's register", (roster || []).some((row) => row.student_id === children[0].id && row.registered))
    check('Register (database): the other child is still not', !(roster || []).some((row) => row.student_id === children[1].id))
    await record.getByRole('button', { name: 'Close' }).click()
    await page.goto(`${serverBase}/?r=1#ops/attendance`)
    await page.getByLabel('Class').selectOption(CLASS)
    await page.getByLabel('Session date').fill(today)
    await page.getByRole('button', { name: `${kids[0].name}: Present` }).waitFor({ timeout: 30000 })
    check("Attendance page: the child is on today's register", true)
    await shot(page, '3-register')
    await page.goto(`${serverBase}/?r=2#ops/students`)
    await card.waitFor({ timeout: 30000 })
    await page.getByRole('button', { name: `${kids[1].name} →` }).waitFor({ timeout: 30000 })
    check('List: the placed child is gone, the other is still listed', (await page.getByRole('button', { name: `${kids[0].name} →` }).count()) === 0)
  } finally {
    await browser.close()
  }

  /* 4. The staff summary */
  const summary = await api('/api/admin/families/summary/send', {})
  check('Summary: sent to the admin inbox', summary.sent === true && Boolean(summary.emailId), JSON.stringify(summary))
  if (summary.emailId) {
    const email = await resendEmail(summary.emailId)
    check('Summary email lists this family and both sections', /^\[KADA\] Weekly: \d+ not in a class, \d+ not paid$/.test(email.subject) && email.html.includes(parentName) && email.html.includes('Not yet in a class (') && email.html.includes('In a class, nothing paid yet ('), `${email.subject} → ${email.to}`)
  }
}

try {
  await run()
} catch (error) {
  failures += 1
  console.error('Verification aborted:', error.message)
} finally {
  if (process.env.KEEP === '1') {
    console.log(`\nKEEP=1: left family ${cleanup.familyId} and the test logins in place.`)
  } else {
    if (cleanup.familyId) {
      await service.from('students').delete().eq('family_id', cleanup.familyId)
      await service.from('profiles').update({ family_id: null }).eq('family_id', cleanup.familyId)
      await service.from('parent_families').delete().eq('id', cleanup.familyId)
    }
    for (const id of cleanup.users) await service.auth.admin.deleteUser(id) // eslint-disable-line no-await-in-loop
    console.log('\nCleaned up the test family, children and logins.')
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}
