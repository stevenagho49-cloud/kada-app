import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { childStats, sessionStats, trend, overallByDate } from '../src/ops/attendanceStats.js'

// End-to-end verification for the attendance register against the LIVE Supabase
// project. Creates test children in the real "Saturday Gospel Afrobeats" class
// and three temporary staff logins, then checks:
//   1. Who is on the register: members from their start date, Day Passes on
//      their date only; cancelled and unpaid bookings excluded
//   2. Permission gate: attendance-only staff can take the register (without
//      reading the students table); staff without the permission, and anonymous
//      visitors, can't read, write or list anything
//   3. History is editable, and the statistics module's numbers match figures
//      worked out by hand from the marks
//   4. (With ATTENDANCE_UI=<path to playwright-core>) the real app on a phone-
//      sized screen: taking today's register by tapping, "mark rest absent",
//      un-tapping a mis-tap, editing a past session, the saved state after a
//      reload, statistics and the Students tab summary, touch-target size,
//      and that staff without the permission never see Attendance
// Everything created is deleted at the end (pass --keep to leave it).
//
// Requires: node server/index.js running on PORT (default 4242) serving dist/
// (npm run build first) for the UI checks.

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const appBase = `http://localhost:${process.env.PORT || 4242}`
const CLASS = 'Saturday Gospel Afrobeats'
const stamp = Date.now()
const keep = process.argv.includes('--keep')

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures += 1
}

const londonToday = () => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = (type) => parts.find((part) => part.type === type).value
  return `${get('year')}-${get('month')}-${get('day')}`
}
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
// Today if it is Saturday, else the most recent Saturday: the "real session".
const today = londonToday()
const session = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() - 6 + 7) % 7))
const week = (n) => addDays(session, -7 * n) // n weeks before the session

// Test data ids.
const familyId = `att-verify-family-${stamp}`
const ids = { member: `att-verify-member-${stamp}`, dayToday: `att-verify-daypass-${stamp}`, dayCancelled: `att-verify-cancelled-${stamp}`, dayPast: `att-verify-past-${stamp}`, unpaid: `att-verify-unpaid-${stamp}` }
const kids = {
  ada: { id: `att-verify-ada-${stamp}`, name: `Ada Verify ${stamp}`, booking: ids.member, term: week(4) },
  ben: { id: `att-verify-ben-${stamp}`, name: `Ben Verify ${stamp}`, booking: ids.member, term: week(4) },
  cara: { id: `att-verify-cara-${stamp}`, name: `Cara Verify ${stamp}`, booking: ids.dayToday, term: session },
  xavi: { id: `att-verify-xavi-${stamp}`, name: `Xavi Verify ${stamp}`, booking: ids.dayCancelled, term: session },
  dami: { id: `att-verify-dami-${stamp}`, name: `Dami Verify ${stamp}`, booking: ids.dayPast, term: week(1) },
  ines: { id: `att-verify-ines-${stamp}`, name: `Ines Verify ${stamp}`, booking: ids.unpaid, term: week(4), status: 'inactive' },
}
const testIds = new Set(Object.values(kids).map((kid) => kid.id))

const users = {}
async function makeStaff(key, permissions) {
  const email = `att-verify-${key}-${stamp}@example.com`
  const password = `Verify-${stamp}-${Math.random().toString(36).slice(2)}`
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Verify ${key}` } })
  if (error) throw new Error(`staff login ${key}: ${error.message}`)
  await service.from('profiles').update({ role: 'staff', permissions, full_name: `Verify ${key}` }).eq('id', data.user.id)
  const client = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw new Error(`sign in ${key}: ${signInError.message}`)
  users[key] = { id: data.user.id, client, session: signIn.session }
}


async function setup() {
  const { data: klass } = await service.from('class_sessions').select('name,day_of_week').eq('name', CLASS).maybeSingle()
  if (!klass) throw new Error(`class "${CLASS}" not found`)
  console.log(`Real session: ${CLASS} on ${session}${session === today ? ' (today)' : ''}`)
  const { error: familyError } = await service.from('parent_families').insert({ id: familyId, guardian_name: 'Attendance Verify', guardian_email: 'delivered@resend.dev', plan_type: 'monthly_membership', membership_status: 'active' })
  if (familyError) throw new Error(`family: ${familyError.message}`)
  const booking = (id, plan, date, extra = {}) => ({ id, family_id: familyId, contact_name: 'Attendance Verify', contact_email: 'delivered@resend.dev', date, session_type: `${CLASS} (${plan})`, price: plan === 'monthly_membership' ? 25 : 10, student_count: 1, status: 'Confirmed', invoice_status: 'Paid', payment_status: 'paid', ...extra })
  const { error: bookingError } = await service.from('bookings').insert([
    booking(ids.member, 'monthly_membership', week(4)),
    booking(ids.dayToday, 'day_pass', session),
    booking(ids.dayCancelled, 'day_pass', session, { status: 'Cancelled' }),
    booking(ids.dayPast, 'day_pass', week(1)),
    booking(ids.unpaid, 'monthly_membership', week(4), { status: 'Enquiry', payment_status: 'pending', invoice_status: 'Not sent' }),
  ])
  if (bookingError) throw new Error(`bookings: ${bookingError.message}`)
  const { error: studentError } = await service.from('students').insert(Object.values(kids).map((kid) => ({ id: kid.id, booking_id: kid.booking, family_id: familyId, parent_name: 'Attendance Verify', parent_email: 'delivered@resend.dev', name: kid.name, date_of_birth: '2016-05-01', class_name: CLASS, term: kid.term, membership_status: kid.status || 'active' })))
  if (studentError) throw new Error(`students: ${studentError.message}`)
  await makeStaff('leader', ['attendance'])
  await makeStaff('nopermission', ['students', 'bookings'])
  await makeStaff('both', ['students', 'attendance'])
}

const rosterIds = async (client, date) => {
  const { data, error } = await client.rpc('attendance_roster', { p_class: CLASS, p_date: date })
  if (error) return { error: error.message, ids: [] }
  return { rows: data, ids: data.filter((row) => testIds.has(row.student_id)).map((row) => row.student_id).sort() }
}
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
const leaderMark = (kid, date, status) => users.leader.client.from('attendance').upsert({ student_id: kid.id, student_name: kid.name, class_name: CLASS, session_date: date, status, marked_by: users.leader.id }, { onConflict: 'student_id,class_name,session_date' })
const testRows = async (client) => (await client.from('attendance').select('student_id,student_name,class_name,session_date,status,marked_by').in('student_id', [...testIds])).data || []

async function run() {
  const leader = users.leader.client

  // 1. Who is on the register.
  let roster = await rosterIds(leader, session)
  check('register for the session: both members + today\'s Day Pass', sameSet(roster.ids, [kids.ada.id, kids.ben.id, kids.cara.id]), roster.error || roster.ids.map((id) => id.split('-')[2]).join(','))
  check('cancelled Day Pass and unpaid membership are not on it', !roster.ids.includes(kids.xavi.id) && !roster.ids.includes(kids.ines.id))
  check('nobody starts marked', roster.rows?.filter((row) => testIds.has(row.student_id)).every((row) => row.status === null))
  roster = await rosterIds(leader, week(1))
  check('last week: members + that week\'s Day Pass only', sameSet(roster.ids, [kids.ada.id, kids.ben.id, kids.dami.id]))
  roster = await rosterIds(leader, week(5))
  check('before the membership started: nobody', roster.ids.length === 0)

  // 2. Permission gate.
  const leaderStudents = await leader.from('students').select('id').in('id', [...testIds])
  check('attendance-only staff cannot read the students table', (leaderStudents.data || []).length === 0)
  const firstMark = await leaderMark(kids.ada, week(4), 'present')
  check('attendance-only staff can mark attendance', !firstMark.error, firstMark.error?.message)

  const outsider = users.nopermission.client
  check('staff without the permission read no attendance', ((await outsider.from('attendance').select('id').in('student_id', [...testIds])).data || []).length === 0)
  const outsiderWrite = await outsider.from('attendance').insert({ student_id: kids.ben.id, student_name: kids.ben.name, class_name: CLASS, session_date: week(4), status: 'absent' })
  check('staff without the permission cannot mark attendance', Boolean(outsiderWrite.error), outsiderWrite.error?.message)
  const outsiderUpdate = await outsider.from('attendance').update({ status: 'absent' }).eq('student_id', kids.ada.id).select('id')
  check('staff without the permission cannot change a mark', (outsiderUpdate.data || []).length === 0)
  const outsiderDelete = await outsider.from('attendance').delete().eq('student_id', kids.ada.id).select('id')
  check('staff without the permission cannot delete a mark', (outsiderDelete.data || []).length === 0)
  check('staff without the permission get an empty register', (await rosterIds(outsider, session)).ids.length === 0)
  check('anonymous visitors read no attendance', ((await anon.from('attendance').select('id').limit(5)).data || []).length === 0)
  const anonRoster = await anon.rpc('attendance_roster', { p_class: CLASS, p_date: session })
  check('anonymous visitors cannot call the register function', Boolean(anonRoster.error), anonRoster.error?.message)
  const anonWrite = await anon.from('attendance').insert({ student_id: kids.ada.id, student_name: 'x', class_name: CLASS, session_date: week(3), status: 'absent' })
  check('anonymous visitors cannot mark attendance', Boolean(anonWrite.error))

  // History for the previous four weeks, taken by the session leader.
  for (const [kid, date, status] of [
    [kids.ben, week(4), 'present'],
    [kids.ada, week(3), 'present'], [kids.ben, week(3), 'absent'],
    [kids.ada, week(2), 'absent'], [kids.ben, week(2), 'present'],
    [kids.ada, week(1), 'present'], [kids.ben, week(1), 'absent'], [kids.dami, week(1), 'present'],
  ]) {
    const { error } = await leaderMark(kid, date, status)
    if (error) check(`history mark ${kid.name} ${date}`, false, error.message)
  }

  // 4a. Today's register and a past-session correction, in the real app.
  if (process.env.ATTENDANCE_UI) await uiRegister()
  else {
    console.log('SKIP  UI checks (set ATTENDANCE_UI to a playwright-core path); marking via the API instead')
    await leaderMark(kids.ada, session, 'present')
    await leaderMark(kids.cara, session, 'present')
    await leaderMark(kids.ben, session, 'absent')
    await leaderMark(kids.ada, week(2), 'present')
  }

  // 3. Saved marks and statistics.
  const rows = await testRows(leader)
  const status = (kid, date) => rows.find((row) => row.student_id === kid.id && row.session_date === date)?.status
  check(`${session}: Ada present, Ben absent, Cara present`, status(kids.ada, session) === 'present' && status(kids.ben, session) === 'absent' && status(kids.cara, session) === 'present')
  check('past session edited: Ada now present 2 weeks ago', status(kids.ada, week(2)) === 'present')
  check('every mark records who took it', rows.every((row) => row.marked_by === users.leader.id))
  check('12 marks saved in total', rows.length === 12, String(rows.length))

  // Worked by hand: Ada P P P P P = 5/5; Ben P A P A A = 2/5; Cara 1/1; Dami 1/1.
  // Sessions (oldest first): 2/2, 1/2, 2/2, 2/3, 2/3. Overall 9/12 = 75%.
  // Last 4 = 7/10 = 70% vs the one before 2/2 = 100% (-30 pts). Low (<= 60%): week(3) at 50%.
  const children = new Map(childStats(rows).map((child) => [child.studentId, child]))
  const expectChild = (kid, present, marked) => {
    const child = children.get(kid.id)
    check(`${kid.name.split(' ')[0]}: attended ${present} of ${marked} (${Math.round((present / marked) * 100)}%)`, child?.present === present && child?.marked === marked && Math.abs(child.rate - present / marked) < 1e-9, child ? `${child.present}/${child.marked}` : 'missing')
  }
  expectChild(kids.ada, 5, 5)
  expectChild(kids.ben, 2, 5)
  expectChild(kids.cara, 1, 1)
  expectChild(kids.dami, 1, 1)
  check('Ben\'s last-sessions history is newest first: A A P A P', children.get(kids.ben.id)?.history.map((item) => item.status[0].toUpperCase()).join(' ') === 'A A P A P')
  const sessions = sessionStats(rows)
  check('per-session rates: 100%, 50%, 100%, 67%, 67%', sessions.map((item) => Math.round(item.rate * 100)).join(',') === '100,50,100,67,67', sessions.map((item) => `${item.date}:${item.present}/${item.marked}`).join(' '))
  const summary = trend(overallByDate(sessions))
  check('overall rate 75% (9 of 12)', Math.abs(summary.average - 0.75) < 1e-9, String(summary.average))
  check('last 4 sessions 70%, down 30 pts on the one before', Math.abs(summary.recentRate - 0.7) < 1e-9 && Math.abs(summary.change + 0.3) < 1e-9, `${summary.recentRate} / ${summary.change}`)
  check('low-turnout week flagged: 3 weeks ago (50%)', summary.lowSessions.map((item) => item.date).join() === week(3), summary.lowSessions.map((item) => item.date).join())

  if (process.env.ATTENDANCE_UI) await uiStatsAndGate()
}

/* ----------------------------- browser ----------------------------- */

let browser
async function openAs(key) {
  const { chromium } = await import(process.env.ATTENDANCE_UI)
  if (!browser) {
    const fs = await import('node:fs')
    const root = `${process.env.HOME}/.cache/ms-playwright`
    const dir = fs.readdirSync(root).find((name) => /^chromium-\d+$/.test(name))
    const sub = fs.readdirSync(`${root}/${dir}`).find((name) => name.startsWith('chrome-linux'))
    browser = await chromium.launch({ executablePath: `${root}/${dir}/${sub}/chrome` })
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
  await context.addInitScript(([name, value]) => window.localStorage.setItem(name, value), [storageKey, JSON.stringify(users[key].session)])
  const page = await context.newPage()
  page.on('dialog', (dialog) => dialog.accept())
  return page
}
const shot = (page, name) => page.screenshot({ path: `${process.env.SCREENSHOT_DIR || '.'}/attendance-${name}.png`, fullPage: true })
const waitForMark = async (kid, date, expected) => {
  for (let i = 0; i < 20; i += 1) {
    const { data } = await service.from('attendance').select('status').eq('student_id', kid.id).eq('session_date', date).maybeSingle()
    if ((data?.status || null) === expected) return true
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return false
}

async function uiRegister() {
  const page = await openAs('leader')
  await page.goto(`${appBase}/#ops/attendance`)
  await page.getByRole('button', { name: `${kids.ada.name}: Present` }).waitFor({ timeout: 20000 })
  check('phone: register opens on the latest session for the class', await page.getByLabel('Session date').inputValue() === session)
  await shot(page, 'register-before')
  const box = await page.getByRole('button', { name: `${kids.ada.name}: Present` }).boundingBox()
  check('phone: tap targets are at least 48px tall', box.height >= 48, `${Math.round(box.width)}x${Math.round(box.height)}`)
  check('phone: no sideways scrolling', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), await page.evaluate(() => `${document.documentElement.scrollWidth} vs ${window.innerWidth}`))
  check('phone: "Mark rest absent" hidden until someone is marked', await page.getByRole('button', { name: 'Mark rest absent' }).count() === 0)

  await page.getByRole('button', { name: `${kids.ada.name}: Present` }).click()
  check('one tap marks Ada present', await waitForMark(kids.ada, session, 'present'))
  await page.getByRole('button', { name: `${kids.cara.name}: Absent` }).click() // mis-tap…
  check('mis-tap saves Cara absent', await waitForMark(kids.cara, session, 'absent'))
  await page.getByRole('button', { name: `${kids.cara.name}: Absent` }).click() // …tap again to clear
  check('tapping the same status again clears it', await waitForMark(kids.cara, session, null))
  await page.getByRole('button', { name: `${kids.cara.name}: Present` }).click()
  check('then Cara present', await waitForMark(kids.cara, session, 'present'))
  await page.getByRole('button', { name: 'Mark rest absent' }).click()
  check('"Mark rest absent" marks Ben absent', await waitForMark(kids.ben, session, 'absent'))
  await shot(page, 'register-done')

  await page.reload()
  await page.getByRole('button', { name: `${kids.ada.name}: Present` }).waitFor()
  const pressed = async (kid, label) => page.getByRole('button', { name: `${kid.name}: ${label}` }).getAttribute('aria-pressed')
  check('after reload the register shows what was saved', await pressed(kids.ada, 'Present') === 'true' && await pressed(kids.ben, 'Absent') === 'true' && await pressed(kids.cara, 'Present') === 'true')
  check('summary reads 2 present · 1 absent · 0 not marked', (await page.getByText(/present · \d+ absent/).first().textContent()).replace(/\s+/g, ' ').includes('2 present · 1 absent · 0 not marked'))

  // Two sessions back, fix a mis-mark after the fact.
  await page.getByRole('button', { name: 'Previous session' }).click()
  await page.getByRole('button', { name: 'Previous session' }).click()
  await page.getByRole('button', { name: `${kids.ada.name}: Present` }).waitFor()
  check('past session opens with its saved marks', await pressed(kids.ada, 'Absent') === 'true' && await page.getByText('past session, still editable').count() > 0)
  await page.getByRole('button', { name: `${kids.ada.name}: Present` }).click()
  check('past session edited in the app: Ada now present', await waitForMark(kids.ada, week(2), 'present'))
  await page.context().close()
}

async function uiStatsAndGate() {
  let page = await openAs('leader')
  await page.goto(`${appBase}/#ops/attendance`)
  await page.getByRole('tab', { name: 'Statistics' }).click()
  await page.getByText('Overall attendance').waitFor()
  await page.getByLabel('Search children').fill(String(stamp))
  const adaRow = page.getByRole('row').filter({ hasText: kids.ada.name })
  check('statistics: Ada attended 5 of 5 at 100%', (await adaRow.textContent()).includes('5 of 5') && (await adaRow.textContent()).includes('100%'))
  const benRow = page.getByRole('row').filter({ hasText: kids.ben.name })
  check('statistics: Ben attended 2 of 5 at 40%', (await benRow.textContent()).includes('2 of 5') && (await benRow.textContent()).includes('40%'))
  check('statistics: Ben\'s history shows 5 sessions', (await benRow.getByRole('img').getAttribute('aria-label')) === 'Last 5 sessions: 2 present, 3 absent')
  check('statistics: class chart drawn', await page.getByRole('img', { name: `${CLASS} attendance rate by session` }).count() === 1)
  const overflow = await page.evaluate(() => {
    const offenders = [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && !el.closest('[style*="overflow-x: auto"]'))
    const outermost = offenders.filter((el) => !offenders.includes(el.parentElement))
    const describe = (el) => `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ')[0]}` : ''}[${Math.round(el.getBoundingClientRect().width)}px]`
    return { scroll: document.documentElement.scrollWidth, width: window.innerWidth, offenders: outermost.slice(0, 2).map((el) => {
      const chain = []
      for (let node = el.parentElement; node && chain.length < 4; node = node.parentElement) chain.push(describe(node))
      return `${describe(el)} in ${chain.join(' < ')}; children: ${[...el.children].map(describe).join(', ')}`
    }) }
  })
  check('statistics: nothing spills past a phone screen', overflow.scroll <= overflow.width && overflow.offenders.length === 0, `${overflow.scroll} vs ${overflow.width} ${overflow.offenders.join(' ')}`)
  await shot(page, 'statistics')
  await page.context().close()

  page = await openAs('both')
  await page.goto(`${appBase}/#ops/students`)
  const studentRow = page.getByText(kids.ben.name).locator('xpath=ancestor::div[2]')
  await studentRow.waitFor({ timeout: 20000 })
  await page.getByText(/^Attended/).first().waitFor({ timeout: 20000 }) // attendance loads after the student list
  check('Students tab shows Ben\'s attendance summary', (await studentRow.textContent()).replace(/\s+/g, ' ').includes('Attended 2 of 5 · 40%'))
  await shot(page, 'students-tab')
  await page.context().close()

  page = await openAs('nopermission')
  await page.goto(`${appBase}/#ops/attendance`)
  await page.getByText('Team dashboard').waitFor({ timeout: 20000 })
  await page.waitForTimeout(1500)
  const html = await page.content()
  check('staff without the permission: no Attendance in the menu', !/>Attendance</.test(html))
  check('staff without the permission: #ops/attendance shows no register', await page.getByRole('tab', { name: 'Register' }).count() === 0 && !html.includes('Mark rest absent'))
  await page.context().close()
  page = await openAs('nopermission') // a hash-only change doesn't re-route, so load the Students tab fresh
  await page.goto(`${appBase}/#ops/students`)
  await page.getByText(kids.ben.name).waitFor({ timeout: 20000 })
  await page.waitForTimeout(1500)
  check('staff without the permission: Students tab shows no attendance', !(await page.content()).includes('Attended '))
  await page.context().close()
  await browser.close()
}

try {
  await setup()
  await run()
} catch (error) {
  console.error('Verification aborted:', error.message)
  failures += 1
} finally {
  if (keep) console.log(`\n--keep: test family ${familyId} and its children were left in place.`)
  else {
    await service.from('students').delete().in('id', [...testIds]) // cascades their attendance
    await service.from('bookings').delete().in('id', Object.values(ids))
    await service.from('parent_families').delete().eq('id', familyId)
  }
  for (const user of Object.values(users)) await service.auth.admin.deleteUser(user.id)
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
