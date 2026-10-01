import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

// End-to-end check that every admin alert fires, against the LIVE Supabase
// project and Resend, using temporary accounts that are removed at the end:
//   1. Parent and instructor sign-ups made with the real Supabase signUp call
//      (the same call the website's sign-up form makes) → admin email, and both
//      listed by /api/admin/recent-signups for the Needs attention panel
//   2. Job claimed (instructor claims through RLS, then the browser's notify call)
//   3. Job accepted (/api/jobs/:id/decision) → admin email, instructor assigned
//   4. Session marked done by the instructor → admin email
//   5. DBS certificate uploaded by an instructor → admin email
//   6. School enquiry → admin email
// Each email is looked up in Resend and must reach "delivered" in the alert inbox.
// With PLAYWRIGHT_CORE (path to playwright-core) set, the Needs attention panel
// is also checked in a real browser signed in as a temporary admin.
//
// Requires: node server/index.js running on PORT (default 4242).

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anonClient = () => createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const serverBase = `http://localhost:${process.env.PORT || 4242}`
const stamp = Date.now()
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures += 1
}

const resend = (path) => fetch(`https://api.resend.com/${path}`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } }).then((response) => response.json())

// Waits until Resend reports the email as delivered (or a final failure).
async function resendOutcome(id) {
  let email = null
  for (let attempt = 0; attempt < 30; attempt += 1) {
    email = await resend(`emails/${id}`)
    if (['delivered', 'bounced', 'complained', 'failed'].includes(email?.last_event)) break
    await sleep(2000)
  }
  return email
}

// Finds an alert by subject in Resend's recent sends (for alerts whose id the API doesn't return).
async function findAlert(subjectPart, since) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const list = await resend('emails?limit=50')
    const found = (list.data || []).find((email) => email.subject.includes(subjectPart) && Date.parse(email.created_at.replace(' ', 'T').replace(/\+00$/, 'Z')) >= since - 5000)
    if (found) return found
    await sleep(2000)
  }
  return null
}

async function expectDelivered(label, id) {
  if (!id) return check(`${label}: alert email sent`, false, 'no Resend id')
  const email = await resendOutcome(id)
  check(`${label}: alert email delivered`, email?.last_event === 'delivered', `${email?.to?.join(', ')} · "${email?.subject}" · Resend last_event=${email?.last_event}`)
}

const cleanup = { users: [], instructors: [], schools: [], bookings: [], files: [], families: [] }

async function tempUser({ email, role, metadata = {}, profile = {} }) {
  const password = `Verify-${stamp}-${Math.random().toString(36).slice(2)}`
  // signup_notified_at stops these helper accounts raising sign-up alerts of their own.
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role, full_name: metadata.full_name || email, ...metadata }, app_metadata: { signup_notified_at: new Date().toISOString() } })
  if (error) throw new Error(`Could not create ${email}: ${error.message}`)
  cleanup.users.push(data.user.id)
  if (Object.keys(profile).length) await service.from('profiles').update(profile).eq('id', data.user.id)
  const client = anonClient()
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  return { id: data.user.id, email, password, client, token: signIn.session.access_token }
}

const post = (path, token, body) => fetch(`${serverBase}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => ({})) }))

async function run() {
  const admin = await tempUser({ email: `alerts-admin-${stamp}@example.com`, role: 'staff', metadata: { full_name: 'Alerts Verify Admin' }, profile: { role: 'admin', full_name: 'Alerts Verify Admin' } })

  // 1. Real sign-ups through Supabase Auth, exactly as the website form does it.
  const signupStart = Date.now()
  const parentEmail = `delivered+kada-parent-${stamp}@resend.dev`
  const instructorEmail = `delivered+kada-instructor-${stamp}@resend.dev`
  const parentSignup = await anonClient().auth.signUp({ email: parentEmail, password: `Verify-${stamp}-p!`, options: { data: { role: 'parent', full_name: `Verify Parent ${stamp}`, children: [{ name: 'Ada Verify', dateOfBirth: '2016-04-02' }, { name: 'Ben Verify', dateOfBirth: '2019-11-20' }] } } })
  const instructorSignup = await anonClient().auth.signUp({ email: instructorEmail, password: `Verify-${stamp}-i!`, options: { data: { role: 'instructor', full_name: `Verify Instructor ${stamp}` } } })
  check('Parent sign-up accepted by Supabase', !parentSignup.error && parentSignup.data.user, parentSignup.error?.message)
  check('Instructor sign-up accepted by Supabase', !instructorSignup.error && instructorSignup.data.user, instructorSignup.error?.message)
  const signupIds = [parentSignup.data.user?.id, instructorSignup.data.user?.id].filter(Boolean)
  cleanup.users.push(...signupIds)
  await fetch(`${serverBase}/api/public/signup-ping`, { method: 'POST' })
  for (const [label, id] of [['parent', signupIds[0]], ['instructor', signupIds[1]]]) {
    let stamped = null
    for (let attempt = 0; attempt < 20 && !stamped; attempt += 1) {
      const { data } = await service.auth.admin.getUserById(id)
      stamped = data.user?.app_metadata?.signup_notified_at
      if (!stamped) await sleep(1500)
    }
    check(`New ${label} sign-up: account stamped as alerted`, Boolean(stamped))
    const alert = await findAlert(`New ${label} sign-up: Verify ${label === 'parent' ? 'Parent' : 'Instructor'} ${stamp}`, signupStart)
    await expectDelivered(`New ${label} sign-up`, alert?.id)
  }
  const recent = await fetch(`${serverBase}/api/admin/recent-signups`, { headers: { Authorization: `Bearer ${admin.token}` } }).then((response) => response.json())
  check('Needs attention data lists both new sign-ups', signupIds.every((id) => recent.signups?.some((item) => item.id === id)), `${recent.signups?.length || 0} recent sign-ups`)
  // A second sweep must not alert again.
  await post('/api/public/signup-ping')
  await sleep(4000)
  const repeat = (await resend('emails?limit=30')).data.filter((email) => email.subject.includes(`Verify Parent ${stamp}`))
  check('Sign-up alert is sent once, not on every sweep', repeat.length === 1, `${repeat.length} alert(s)`)

  // Fixtures for the job board: a school booking, two DBS-approved instructors.
  const schoolId = `alerts-school-${stamp}`
  cleanup.schools.push(schoolId)
  await service.from('schools').insert({ id: schoolId, name: `Alerts Verify School ${stamp}`, contact_name: 'Verify Contact', email: 'delivered@resend.dev' })
  const bookingId = `alerts-booking-${stamp}`
  cleanup.bookings.push(bookingId)
  await service.from('bookings').insert({ id: bookingId, school_id: schoolId, contact_name: 'Verify Contact', contact_email: 'delivered@resend.dev', date: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10), session_type: 'Half day', price: 260, student_count: 25, status: 'Confirmed', invoice_status: 'Not sent' })
  const instructorA = `alerts-instr-a-${stamp}`
  const instructorB = `alerts-instr-b-${stamp}`
  cleanup.instructors.push(instructorA, instructorB)
  await service.from('instructors').insert([
    { id: instructorA, name: `Alerts Instructor A ${stamp}`, email: `alerts-instr-a-${stamp}@example.com`, dbs_status: 'Approved' },
    { id: instructorB, name: `Alerts Instructor B ${stamp}`, email: `alerts-instr-b-${stamp}@example.com`, dbs_status: 'Missing' },
  ])
  const instrA = await tempUser({ email: `alerts-instr-a-${stamp}@example.com`, role: 'instructor', profile: { instructor_id: instructorA } })
  const instrB = await tempUser({ email: `alerts-instr-b-${stamp}@example.com`, role: 'instructor', profile: { instructor_id: instructorB } })
  const school = await tempUser({ email: `alerts-school-user-${stamp}@example.com`, role: 'staff', profile: { role: 'school', school_id: schoolId } })

  // 2. Job claimed.
  const published = await post('/api/jobs/publish', admin.token, { bookingId, pay: 120, location: 'Verify area' })
  check('Admin publishes a job', published.status === 200, published.body.error)
  const jobId = published.body.job?.id
  const { data: claimed, error: claimError } = await instrA.client.from('job_board_jobs').update({ status: 'pending', claimed_by: instructorA, claimed_at: new Date().toISOString() }).eq('id', jobId).select('id')
  check('Instructor claims the job (RLS)', !claimError && claimed?.length === 1, claimError?.message)
  const claimAlert = await post('/api/notify-admin', instrA.token, { type: 'job-claim', detail: { sessionType: 'Half day', date: 'verify', claimedBy: `Alerts Instructor A ${stamp}` } })
  check('Job claim alert accepted by Resend', claimAlert.body.sent === true, claimAlert.body.reason)
  await expectDelivered('Job claimed', claimAlert.body.id)

  // 5. DBS upload (before the browser check, so it shows as needing review).
  const dbsPath = `${instructorB}/${stamp}-verify.pdf`
  const { error: uploadError } = await instrB.client.storage.from('dbs-certificates').upload(dbsPath, new Blob(['%PDF-1.4 verify'], { type: 'application/pdf' }), { contentType: 'application/pdf' })
  if (!uploadError) cleanup.files.push(dbsPath)
  const { error: dbsError } = await instrB.client.from('instructors').update({ dbs_status: 'Pending', dbs_file_path: dbsPath, dbs_uploaded_at: new Date().toISOString() }).eq('id', instructorB)
  check('Instructor uploads a DBS certificate (storage + RLS)', !uploadError && !dbsError, uploadError?.message || dbsError?.message)
  const dbsAlert = await post('/api/notify-admin', instrB.token, { type: 'dbs-upload', detail: { instructorName: `Alerts Instructor B ${stamp}`, instructorId: instructorB } })
  await expectDelivered('DBS certificate submitted', dbsAlert.body.id)

  const browserLabels = { before: [], after: [] }
  const browserCheck = process.env.PLAYWRIGHT_CORE ? await openAdminBrowser(admin) : null
  if (browserCheck) browserLabels.before = await browserCheck.panel('alerts-before')

  // 3. Job accepted.
  const decision = await post(`/api/jobs/${jobId}/decision`, admin.token, { decision: 'accepted' })
  check('Admin accepts the claim', decision.status === 200 && decision.body.job?.status === 'accepted', decision.body.error)
  const { data: assigned } = await service.from('bookings').select('instructor_id').eq('id', bookingId).single()
  check('Accepted instructor is assigned to the booking', assigned.instructor_id === instructorA)
  await expectDelivered('Job accepted', decision.body.notification?.id)

  // 4. Session marked done.
  const doneStart = Date.now()
  const done = await post('/api/instructor/mark-done', instrA.token, { bookingId })
  check('Instructor marks the session done', done.status === 200, done.body.error)
  const doneAlert = await findAlert('Session marked done', doneStart)
  await expectDelivered('Session done', doneAlert?.id)

  // 6. School enquiry.
  const enquiryAlert = await post('/api/notify-admin', school.token, { type: 'school-enquiry', detail: { schoolName: `Alerts Verify School ${stamp}`, contactName: 'Verify Contact', email: 'delivered@resend.dev', sessionType: 'Half day', date: 'verify', studentCount: 25, schoolId } })
  await expectDelivered('School enquiry', enquiryAlert.body.id)

  if (browserCheck) {
    browserLabels.after = await browserCheck.panel('alerts-after')
    const all = [...browserLabels.before, ...browserLabels.after].join('\n')
    check('Needs attention shows the new parent sign-up', all.includes(`New parent sign-up · Verify Parent ${stamp}`))
    check('Needs attention shows the new instructor sign-up', all.includes(`New instructor sign-up · Verify Instructor ${stamp}`))
    check('Needs attention shows the pending job claim', browserLabels.before.some((label) => label.startsWith('Job claim pending approval') && label.includes(`Alerts Instructor A ${stamp}`)))
    check('Needs attention shows the DBS upload', all.includes(`DBS certificate uploaded · review required · Alerts Instructor B ${stamp}`))
    check('Needs attention shows the accepted job', browserLabels.after.some((label) => label.startsWith('Job accepted') && label.includes(`Alerts Instructor A ${stamp}`)))
    check('Needs attention shows the delivered session', browserLabels.after.some((label) => label.startsWith('Session delivered · payment review needed')))
    await browserCheck.close()
  }
}

// Signs a temporary admin in through the real sign-in screen and reads the panel.
async function openAdminBrowser(admin) {
  const { chromium } = await import(process.env.PLAYWRIGHT_CORE)
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  await page.goto(`${serverBase}/`)
  await page.getByRole('button', { name: 'Sign in' }).first().click()
  await page.locator('input[type=email]').fill(admin.email)
  await page.locator('input[type=password]').fill(admin.password)
  await page.locator('form button[type=submit]').click()
  try {
    await page.locator('h2.display', { hasText: 'Operations dashboard' }).waitFor({ timeout: 30000 })
  } catch {
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/signin-failed.png` })
    throw new Error(`Admin sign-in did not reach the dashboard: ${(await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300)}`)
  }
  return {
    async panel(name) {
      // A deep link reloads straight into the dashboard (a plain reload opens the public site).
      await page.goto(`${serverBase}/?r=${Date.now()}#ops/dashboard`)
      await page.locator('h2.display', { hasText: 'Operations dashboard' }).waitFor({ timeout: 30000 })
      await page.getByRole('heading', { name: 'Needs attention' }).waitFor({ timeout: 20000 })
      await sleep(2500) // recent sign-ups load separately
      const panel = page.locator('div', { has: page.getByRole('heading', { name: 'Needs attention' }) }).last()
      if (process.env.SCREENSHOT_DIR) await panel.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png` })
      return panel.locator('button[type=button]:not([aria-label])').allInnerTexts()
    },
    close: () => browser.close(),
  }
}

try {
  await run()
} catch (error) {
  failures += 1
  console.error('Verification aborted:', error.message)
} finally {
  if (cleanup.files.length) await service.storage.from('dbs-certificates').remove(cleanup.files)
  await service.from('job_board_jobs').delete().in('booking_id', cleanup.bookings)
  await service.from('bookings').delete().in('id', cleanup.bookings)
  await service.from('instructors').delete().in('id', cleanup.instructors)
  for (const id of cleanup.users) {
    const { data: profile } = await service.from('profiles').select('school_id,family_id').eq('id', id).maybeSingle()
    if (profile?.family_id) await service.from('parent_families').delete().eq('id', profile.family_id)
    if (profile?.school_id && !cleanup.schools.includes(profile.school_id)) cleanup.schools.push(profile.school_id)
    await service.from('parent_families').delete().eq('owner_user_id', id)
    await service.from('profiles').delete().eq('id', id)
    await service.auth.admin.deleteUser(id)
  }
  await service.from('schools').delete().in('id', cleanup.schools)
  console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.')
  process.exit(failures ? 1 : 0)
}
