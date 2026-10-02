import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

// Verifies, against the LIVE project, session types and the Payments panel
// (supabase/migrations/20261002_session_types_and_payments.sql):
//   1. Only staff with the 'sessions' permission can use /api/session-types
//   2. A type created with 2 dates as a COMBINED job posts one job covering
//      both dates, paying pay-per-day × 2
//   3. Scheduling 3 dates as SEPARATE jobs posts three one-date jobs
//   4. An instructor claims the combined job (their own RLS); accepting it
//      assigns them to both dates; the Calendar shows those dates to them and
//      every date to staff
//   5. Cancelling a run with an accepted job needs force; forcing removes its jobs
//   6. Payments: a sent invoice is Pending; Mark as paid moves it to Paid with
//      method and marker; Undo moves it back
// Temporary users, school, instructor, session types and invoice are deleted at
// the end. Accepting the claim emails an admin alert (lands in the alerts inbox).
//
// Requires: node server/index.js running on PORT (default 4242).

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anonClient = () => createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const serverBase = `http://localhost:${process.env.PORT || 4242}`
const stamp = Date.now()
const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures += 1
}
const call = (path, token, body) => fetch(`${serverBase}${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => ({})) }))

const cleanup = { users: [], types: [], instructorId: '', schoolId: '', bookingId: '' }

async function tempUser(key, profile) {
  const email = `sessions-verify-${key}-${stamp}@example.com`
  const password = `Verify-${stamp}-${Math.random().toString(36).slice(2)}`
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Verify ${key}` }, app_metadata: { signup_notified_at: new Date().toISOString() } })
  if (error) throw new Error(`user ${key}: ${error.message}`)
  cleanup.users.push(data.user.id)
  await service.from('profiles').update({ full_name: `Verify ${key}`, ...profile }).eq('id', data.user.id)
  const client = anonClient()
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw new Error(`sign in ${key}: ${signInError.message}`)
  return { id: data.user.id, client, token: signIn.session.access_token }
}

async function run() {
  cleanup.schoolId = `sessions-verify-school-${stamp}`
  await service.from('schools').insert({ id: cleanup.schoolId, name: `Verify School ${stamp}`, contact_name: 'Verify Contact', email: 'delivered@resend.dev' })
  cleanup.instructorId = `sessions-verify-instr-${stamp}`
  await service.from('instructors').insert({ id: cleanup.instructorId, name: `Verify Instructor ${stamp}`, email: `sessions-verify-instr-${stamp}@example.com`, dbs_status: 'Approved' })

  const staff = await tempUser('staff', { role: 'staff', permissions: ['sessions', 'jobs', 'sales'] })
  const outsider = await tempUser('outsider', { role: 'staff', permissions: ['bookings'] })
  const instructor = await tempUser('instructor', { role: 'instructor', instructor_id: cleanup.instructorId })

  // 1. Permission
  const denied = await call('/api/session-types', outsider.token)
  check('Staff without the sessions permission are refused', denied.status === 403, `status ${denied.status}`)

  // 2. Combined
  const created = await call('/api/session-types', staff.token, {
    name: `Verify 2 Full Days ${stamp}`, defaultPrice: 900, defaultInstructorPay: 150,
    schedule: { dates: [{ date: inDays(10), startTime: '09:00', endTime: '15:00' }, { date: inDays(11), startTime: '09:00', endTime: '15:00' }], postingMode: 'combined', instructorPayPerDay: 150, studentCount: 40, schoolId: cleanup.schoolId, locationArea: 'Verify Area' },
  })
  if (created.body.type) cleanup.types.push(created.body.type.id)
  check('Create a type with 2 dates as a combined job', created.status === 200 && created.body.jobs?.length === 1, created.body.error || `${created.body.jobs?.length} jobs`)
  const combinedJob = created.body.jobs?.[0]
  check('The combined job covers both dates', combinedJob?.session_dates?.length === 2 && combinedJob.booking_id === null)
  check('The combined job pays £150 × 2', Number(combinedJob?.instructor_pay) === 300, `£${combinedJob?.instructor_pay}`)

  const duplicate = await call('/api/session-types', staff.token, { name: `verify 2 full days ${stamp}` })
  check('A duplicate name (any case) is refused', duplicate.status === 409, `status ${duplicate.status}`)

  // 3. Separate
  const typeId = created.body.type?.id
  const separate = await call(`/api/session-types/${typeId}/schedule`, staff.token, { dates: [12, 13, 14].map((day) => ({ date: inDays(day), startTime: '10:00', endTime: '12:00' })), postingMode: 'separate', instructorPayPerDay: 80, studentCount: 20 })
  check('Schedule 3 dates as separate jobs', separate.status === 200 && separate.body.jobs?.length === 3, separate.body.error || `${separate.body.jobs?.length} jobs`)
  check('Each separate job covers one date and pays £80', (separate.body.jobs || []).every((job) => job.session_dates.length === 1 && Number(job.instructor_pay) === 80))
  const past = await call(`/api/session-types/${typeId}/schedule`, staff.token, { dates: [{ date: inDays(-2) }], postingMode: 'combined', instructorPayPerDay: 80 })
  check('A date in the past is refused', past.status === 400, past.body.error)

  // 4. Claim, accept, calendar
  const { data: claimed, error: claimError } = await instructor.client.from('job_board_jobs').update({ status: 'pending', claimed_by: cleanup.instructorId, claimed_at: new Date().toISOString(), decided_at: null }).eq('id', combinedJob.id).eq('status', 'open').select('*')
  check('The instructor can claim the combined job', !claimError && claimed?.length === 1, claimError?.message || `${claimed?.length} rows`)
  const accepted = await call(`/api/jobs/${encodeURIComponent(combinedJob.id)}/decision`, staff.token, { decision: 'accepted' })
  check('Staff accept the claim', accepted.status === 200, accepted.body.error)
  const { data: assigned } = await service.from('scheduled_session_dates').select('instructor_id').eq('scheduled_session_id', created.body.session.id)
  check('Accepting assigns the instructor to both dates', assigned?.length === 2 && assigned.every((row) => row.instructor_id === cleanup.instructorId))

  const staffCalendar = await call('/api/sessions/calendar', staff.token)
  const mine = (staffCalendar.body.entries || []).filter((entry) => entry.title.includes(String(stamp)))
  check('Staff see all 5 session days on the calendar', mine.length === 5, `${mine.length} entries`)
  const instructorCalendar = await call('/api/sessions/calendar', instructor.token)
  const theirs = (instructorCalendar.body.entries || []).filter((entry) => entry.title.includes(String(stamp)))
  check('The instructor sees only their 2 assigned days', theirs.length === 2 && theirs.every((entry) => entry.postingMode === 'combined' && entry.dayCount === 2), `${theirs.length} entries`)

  // 5. Cancel
  const sessionId = created.body.session.id
  const unforced = await call(`/api/scheduled-sessions/${sessionId}/cancel`, staff.token, {})
  check('Cancelling a run with an accepted job asks for confirmation', unforced.status === 409 && unforced.body.needsForce)
  const forced = await call(`/api/scheduled-sessions/${sessionId}/cancel`, staff.token, { force: true })
  const { data: leftJobs } = await service.from('job_board_jobs').select('id').eq('scheduled_session_id', sessionId)
  check('Forcing the cancel removes its job from the board', forced.status === 200 && leftJobs?.length === 0)

  // 6. Payments
  cleanup.bookingId = `sessions-verify-booking-${stamp}`
  const reference = `TEST-PAYMENTS-${stamp}`
  const { error: bookingError } = await service.from('bookings').insert({ id: cleanup.bookingId, school_id: cleanup.schoolId, contact_name: 'Verify Contact', contact_email: 'delivered@resend.dev', date: inDays(-5), session_type: 'Payments verification', price: 250, student_count: 30, status: 'Confirmed', invoice_status: 'Sent', invoice_number: reference, invoice_sent_at: new Date().toISOString(), invoice_due_date: inDays(9), notes: 'Created by scripts/verify-session-types-payments.js' })
  if (bookingError) throw new Error(`test invoice: ${bookingError.message}`)
  const before = await call('/api/payments?days=30', staff.token)
  const pendingItem = before.body.pending?.items.find((item) => item.reference === reference)
  check('A sent invoice shows under Pending for £250', pendingItem?.amountPence === 25000, before.body.error || JSON.stringify(pendingItem?.amountPence))
  const marked = await call(`/api/payments/invoices/${cleanup.bookingId}/mark-paid`, staff.token, { amountPence: 24000, paidOn: inDays(0), method: 'bank_transfer', note: 'verify ref' })
  check('Mark as paid (short by £10)', marked.status === 200 && marked.body.shortBy === 1000, marked.body.error)
  const after = await call('/api/payments?days=30', staff.token)
  const paidItem = after.body.paid?.items.find((item) => item.reference === reference)
  check('It moves to Paid with method, marker and note', !after.body.pending.items.some((item) => item.reference === reference) && paidItem?.method === 'Bank transfer' && paidItem.markedBy === 'Verify staff' && paidItem.note === 'verify ref' && paidItem.amountPence === 24000, JSON.stringify(paidItem))
  check('A sales-only staff member sees invoices only under Paid', after.body.paid.scope === 'invoices')
  const again = await call(`/api/payments/invoices/${cleanup.bookingId}/mark-paid`, staff.token, {})
  check('Marking it paid twice is refused', again.status === 409)
  const undone = await call(`/api/payments/invoices/${cleanup.bookingId}/mark-unpaid`, staff.token, {})
  const reopened = await call('/api/payments?days=30', staff.token)
  check('Undo moves it back to Pending', undone.status === 200 && reopened.body.pending.items.some((item) => item.reference === reference))
  const outsiderPayments = await call('/api/payments', outsider.token)
  check('Staff without invoice access cannot see Payments', outsiderPayments.status === 403, `status ${outsiderPayments.status}`)
}

async function tidy() {
  if (cleanup.types.length) {
    const { data: sessions } = await service.from('scheduled_sessions').select('id').in('session_type_id', cleanup.types)
    const ids = (sessions || []).map((row) => row.id)
    if (ids.length) {
      await service.from('job_board_jobs').delete().in('scheduled_session_id', ids)
      await service.from('scheduled_sessions').delete().in('id', ids)
    }
    await service.from('session_types').delete().in('id', cleanup.types)
  }
  if (cleanup.bookingId) await service.from('bookings').delete().eq('id', cleanup.bookingId)
  for (const id of cleanup.users) await service.auth.admin.deleteUser(id)
  if (cleanup.instructorId) await service.from('instructors').delete().eq('id', cleanup.instructorId)
  if (cleanup.schoolId) await service.from('schools').delete().eq('id', cleanup.schoolId)
}

run()
  .catch((error) => { console.error('ERROR', error.message); failures += 1 })
  .finally(async () => {
    await tidy().catch((error) => console.error('Cleanup failed:', error.message))
    console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
    process.exit(failures ? 1 : 0)
  })
