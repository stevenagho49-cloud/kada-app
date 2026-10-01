import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

// Verifies, against the LIVE project, that a staff member's real account can use
// the Job board and message instructors and schools, while instructors still
// can't message each other. Signs in as STAFF_EMAIL (default Annedrea) with a
// one-time sign-in token from the service role: no email is sent and her
// password is untouched; that session is revoked at the end.
//   1. Her profile has the 'jobs' permission
//   2. API: she can publish a job and accept a claim (/api/jobs/*); an admin
//      alert is emailed on acceptance
//   3. Browser (PLAYWRIGHT_CORE + CHROMIUM_PATH): her sidebar shows Job board, she
//      posts a job through "Post a job", and accepts an instructor's claim
//   4. Browser: Messages lists instructors and schools under "New conversation",
//      and a message she sends lands as admin → instructor / admin → school
//   5. RLS: as an instructor, a message to another instructor is refused, and a
//      message to KADA admin is allowed
// Temporary instructors, school, bookings, jobs and messages are deleted at the end.
//
// Requires: node server/index.js running on PORT (default 4242), serving a build
// of this code (npm run build).

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anonClient = () => createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const serverBase = `http://localhost:${process.env.PORT || 4242}`
const STAFF_EMAIL = process.env.STAFF_EMAIL || 'annedrea@kingsarkdance.com'
const stamp = Date.now()
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures += 1
}
const post = (path, token, body) => fetch(`${serverBase}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body || {}) }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => ({})) }))

const cleanup = { users: [], instructors: [], bookings: [], schools: [], messageMarker: `verify-${stamp}`, staffSessions: [] }

// One-time sign-in token for an existing account (no email is sent).
async function signInToken(email) {
  const { data, error } = await service.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error(`Sign-in token for ${email}: ${error.message}`)
  return data.properties.hashed_token
}

async function tempInstructor(letter) {
  const id = `msg-instr-${letter}-${stamp}`
  const email = `msg-instr-${letter}-${stamp}@example.com`
  cleanup.instructors.push(id)
  await service.from('instructors').insert({ id, name: `Verify Instructor ${letter.toUpperCase()} ${stamp}`, email, dbs_status: 'Approved' })
  const password = `Verify-${stamp}-${letter}!x`
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: 'instructor', full_name: `Verify Instructor ${letter.toUpperCase()}` }, app_metadata: { signup_notified_at: new Date().toISOString() } })
  if (error) throw error
  cleanup.users.push(data.user.id)
  await service.from('profiles').update({ instructor_id: id }).eq('id', data.user.id)
  const client = anonClient()
  const { data: signIn } = await client.auth.signInWithPassword({ email, password })
  return { id, client, token: signIn.session.access_token, name: `Verify Instructor ${letter.toUpperCase()} ${stamp}` }
}

async function run() {
  const { data: users } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const staffUser = users.users.find((user) => user.email?.toLowerCase() === STAFF_EMAIL)
  if (!staffUser) throw new Error(`${STAFF_EMAIL} not found`)
  const { data: staffProfile } = await service.from('profiles').select('role,full_name,permissions').eq('id', staffUser.id).single()
  check(`${staffProfile.full_name} is staff with the jobs permission`, staffProfile.role === 'staff' && staffProfile.permissions.includes('jobs'), staffProfile.permissions.join(', '))
  check(`${staffProfile.full_name} has the messages permission`, staffProfile.permissions.includes('messages'))

  const staff = anonClient()
  const { data: staffSession, error: otpError } = await staff.auth.verifyOtp({ token_hash: await signInToken(STAFF_EMAIL), type: 'magiclink' })
  if (otpError) throw otpError
  cleanup.staffSessions.push(staffSession.session.access_token)
  const staffToken = staffSession.session.access_token

  // Fixtures: a school with two upcoming bookings, two DBS-approved instructors.
  const schoolId = `msg-school-${stamp}`
  cleanup.schools.push(schoolId)
  await service.from('schools').insert({ id: schoolId, name: `Verify School ${stamp}`, contact_name: 'Verify Contact', email: 'delivered@resend.dev' })
  const apiBooking = `msg-booking-api-${stamp}`
  const uiBooking = `msg-booking-ui-${stamp}`
  cleanup.bookings.push(apiBooking, uiBooking)
  await service.from('bookings').insert([
    { id: apiBooking, school_id: schoolId, contact_name: 'Verify Contact', contact_email: 'delivered@resend.dev', date: inDays(30), session_type: 'Half day', price: 260, student_count: 20, status: 'Confirmed', invoice_status: 'Not sent' },
    { id: uiBooking, school_id: schoolId, contact_name: 'Verify Contact', contact_email: 'delivered@resend.dev', date: inDays(31), session_type: 'Single workshop', price: 150, student_count: 18, status: 'Confirmed', invoice_status: 'Not sent' },
  ])
  const instrA = await tempInstructor('a')
  const instrB = await tempInstructor('b')

  // 2. API: publish + accept as the staff member.
  const published = await post('/api/jobs/publish', staffToken, { bookingId: apiBooking, pay: 95, location: 'Verify area' })
  check('Staff publishes a job (API)', published.status === 200, published.body.error)
  await instrA.client.from('job_board_jobs').update({ status: 'pending', claimed_by: instrA.id, claimed_at: new Date().toISOString() }).eq('id', published.body.job?.id)
  const accepted = await post(`/api/jobs/${published.body.job?.id}/decision`, staffToken, { decision: 'accepted' })
  check('Staff accepts a claim (API)', accepted.status === 200 && accepted.body.job?.status === 'accepted', accepted.body.error)
  check('Admin is emailed that the job was accepted', accepted.body.notification?.sent === true, accepted.body.notification?.reason)
  const { data: readable, error: readError } = await staff.from('job_board_jobs').select('id').eq('id', published.body.job?.id)
  check('Staff can read the job board (RLS)', !readError && readable?.length === 1, readError?.message)

  // 5. RLS on messages, as an instructor.
  const toInstructor = await instrA.client.from('messages').insert({ id: `${cleanup.messageMarker}-i2i`, sender_kind: 'instructor', sender_instructor_id: instrA.id, recipient_kind: 'instructor', recipient_instructor_id: instrB.id, body: 'instructor to instructor' }).select('id')
  check('Instructor → instructor message is refused (RLS)', Boolean(toInstructor.error), toInstructor.error ? toInstructor.error.message : 'INSERTED: the database still allows it')
  const toAdmin = await instrA.client.from('messages').insert({ id: `${cleanup.messageMarker}-i2a`, sender_kind: 'instructor', sender_instructor_id: instrA.id, recipient_kind: 'admin', body: 'instructor to admin' }).select('id')
  check('Instructor → KADA admin message is allowed', !toAdmin.error, toAdmin.error?.message)
  const spoofed = await instrA.client.from('messages').insert({ id: `${cleanup.messageMarker}-spoof`, sender_kind: 'instructor', sender_instructor_id: instrB.id, recipient_kind: 'admin', body: 'pretending to be B' }).select('id')
  check('Instructor cannot send as another instructor', Boolean(spoofed.error), spoofed.error ? spoofed.error.message : 'INSERTED')

  // Schools can still write to KADA admin, but only as their own school.
  const schoolPassword = `Verify-${stamp}-school!`
  const { data: schoolUser } = await service.auth.admin.createUser({ email: `msg-school-${stamp}@example.com`, password: schoolPassword, email_confirm: true, user_metadata: { role: 'staff' }, app_metadata: { signup_notified_at: new Date().toISOString() } })
  cleanup.users.push(schoolUser.user.id)
  await service.from('profiles').update({ role: 'school', school_id: schoolId }).eq('id', schoolUser.user.id)
  const schoolClient = anonClient()
  await schoolClient.auth.signInWithPassword({ email: `msg-school-${stamp}@example.com`, password: schoolPassword })
  const schoolToAdmin = await schoolClient.from('messages').insert({ id: `${cleanup.messageMarker}-s2a`, sender_kind: 'school', sender_school_id: schoolId, recipient_kind: 'admin', body: 'school to admin' }).select('id')
  check('School → KADA admin message is allowed', !schoolToAdmin.error, schoolToAdmin.error?.message)
  const schoolToInstructor = await schoolClient.from('messages').insert({ id: `${cleanup.messageMarker}-s2i`, sender_kind: 'school', sender_school_id: schoolId, recipient_kind: 'instructor', recipient_instructor_id: instrA.id, body: 'school to instructor' }).select('id')
  check('School → instructor message is refused', Boolean(schoolToInstructor.error), schoolToInstructor.error?.message || 'INSERTED')

  if (!process.env.PLAYWRIGHT_CORE) return
  const { chromium } = await import(process.env.PLAYWRIGHT_CORE)
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
    // The app signs in from a token_hash link (same mechanism as invite links).
    await page.goto(`${serverBase}/#token_hash=${await signInToken(STAFF_EMAIL)}&type=magiclink`)
    await page.locator('h2.display', { hasText: 'Team dashboard' }).waitFor({ timeout: 30000 })
    const browserToken = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((item) => item.endsWith('-auth-token'))
      return key ? JSON.parse(localStorage.getItem(key)).access_token : ''
    })
    if (browserToken) cleanup.staffSessions.push(browserToken)
    const sidebar = await page.locator('aside.ops-sidebar').innerText()
    check(`${staffProfile.full_name}'s sidebar shows Job board`, /Job board/.test(sidebar))
    check(`${staffProfile.full_name}'s sidebar hides Workshop template (no template permission)`, !/Workshop template/.test(sidebar))

    // 3. Post a job through the page, then accept a claim on it.
    await page.locator('aside.ops-sidebar').getByRole('button', { name: 'Job board' }).click()
    await page.getByRole('heading', { name: 'Job board' }).waitFor()
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/staff-jobboard.png`, fullPage: true })
    await page.getByRole('button', { name: 'Post a job' }).first().click()
    const bookingSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'Choose a booking' }) })
    const optionValue = await bookingSelect.locator('option', { hasText: `Verify School ${stamp}` }).getAttribute('value')
    await bookingSelect.selectOption(optionValue)
    await page.getByLabel('Instructor pay (£)').fill('110')
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/staff-post-job.png` })
    await page.getByRole('button', { name: 'Post to job board' }).click()
    await page.getByText('Job posted to the job board.').waitFor({ timeout: 15000 })
    const { data: uiJob } = await service.from('job_board_jobs').select('*').eq('booking_id', uiBooking).maybeSingle()
    check('Job posted from the page is on the board', uiJob?.status === 'open' && Number(uiJob.instructor_pay) === 110, uiJob ? `${uiJob.status}, £${uiJob.instructor_pay}` : 'not found')
    await instrB.client.from('job_board_jobs').update({ status: 'pending', claimed_by: instrB.id, claimed_at: new Date().toISOString() }).eq('id', uiJob.id)
    await page.goto(`${serverBase}/?r=${stamp}#ops/jobs`)
    await page.getByRole('heading', { name: 'Job board' }).waitFor({ timeout: 30000 })
    const row = page.locator('div').filter({ hasText: `Claimed by ${instrB.name}` }).filter({ has: page.getByRole('button', { name: 'Accept' }) }).last()
    await row.getByRole('button', { name: 'Accept' }).click()
    await page.getByText('Claim accepted.').first().waitFor({ timeout: 15000 })
    const { data: decided } = await service.from('job_board_jobs').select('status').eq('id', uiJob.id).single()
    const { data: assigned } = await service.from('bookings').select('instructor_id').eq('id', uiBooking).single()
    check('Claim accepted from the page; instructor assigned', decided.status === 'accepted' && assigned.instructor_id === instrB.id)

    // 4. Messages: start conversations with an instructor and a school.
    await page.locator('aside.ops-sidebar').getByRole('button', { name: /^Messages/ }).click()
    await page.getByRole('heading', { name: 'Messages' }).waitFor()
    const starter = page.getByLabel('Start a conversation')
    const options = await starter.locator('option').allInnerTexts()
    check('New conversation lists instructors', options.some((text) => text === `Instructor · ${instrA.name}`), `${options.filter((text) => text.startsWith('Instructor')).length} instructors`)
    check('New conversation lists schools', options.some((text) => text === `School · Verify School ${stamp}`), `${options.filter((text) => text.startsWith('School')).length} schools`)
    for (const [label, optionText, body] of [['instructor', `Instructor · ${instrA.name}`, `Hello from staff ${cleanup.messageMarker} (instructor)`], ['school', `School · Verify School ${stamp}`, `Hello from staff ${cleanup.messageMarker} (school)`]]) {
      await starter.selectOption({ label: optionText })
      await page.getByRole('button', { name: 'Open', exact: true }).click()
      await page.getByPlaceholder('Write a message…').fill(body)
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      await page.getByText(body).waitFor({ timeout: 15000 })
      const { data: sent } = await service.from('messages').select('*').eq('body', body).maybeSingle()
      check(`Staff message to the ${label} is saved as KADA admin → ${label}`, sent?.sender_kind === 'admin' && sent.recipient_kind === label && (label === 'instructor' ? sent.recipient_instructor_id === instrA.id : sent.recipient_school_id === schoolId))
    }
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/staff-messages.png`, fullPage: true })
    // The instructor sees the staff member's message in their own inbox (RLS read).
    const { data: inbox } = await instrA.client.from('messages').select('body').eq('recipient_instructor_id', instrA.id)
    check('The instructor can read the staff message', (inbox || []).some((message) => message.body.includes(cleanup.messageMarker)))
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
  await service.from('messages').delete().like('id', `${cleanup.messageMarker}%`)
  await service.from('messages').delete().like('body', `%${cleanup.messageMarker}%`)
  await service.from('messages').delete().in('sender_instructor_id', cleanup.instructors)
  await service.from('messages').delete().in('sender_school_id', cleanup.schools)
  await service.from('job_board_jobs').delete().in('booking_id', cleanup.bookings)
  await service.from('bookings').delete().in('id', cleanup.bookings)
  await service.from('instructors').delete().in('id', cleanup.instructors)
  await service.from('schools').delete().in('id', cleanup.schools)
  for (const id of cleanup.users) {
    await service.from('profiles').delete().eq('id', id)
    await service.auth.admin.deleteUser(id)
  }
  // End the staff member's verification sessions (her own sign-ins are untouched).
  for (const token of cleanup.staffSessions) await service.auth.admin.signOut(token, 'local').catch(() => {})
  console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.')
  process.exit(failures ? 1 : 0)
}
