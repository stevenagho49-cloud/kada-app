import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY)

const suffix = Date.now()
const password = 'Temporary-test-password-123!'
const fixture = {
  approved: { userId: null, instructorId: `dbs-approved-${suffix}`, email: `dbs-approved-${suffix}@example.com` },
  pending: { userId: null, instructorId: `dbs-pending-${suffix}`, email: `dbs-pending-${suffix}@example.com` },
  bookingId: `dbs-booking-${suffix}`,
  jobId: `dbs-job-${suffix}`,
}

async function makeInstructor(key, status) {
  const item = fixture[key]
  const created = await service.auth.admin.createUser({ email: item.email, password, email_confirm: true })
  if (created.error) throw created.error
  item.userId = created.data.user.id
  const { error: instructorError } = await service.from('instructors').insert({ id: item.instructorId, name: `DBS ${status} Test`, email: item.email, rate: 100, dbs_status: status })
  if (instructorError) throw instructorError
  const { error: profileError } = await service.from('profiles').upsert({ id: item.userId, role: 'instructor', full_name: `DBS ${status} Test`, instructor_id: item.instructorId })
  if (profileError) throw profileError
}

async function jobQueryAs(email) {
  const signedIn = await anon.auth.signInWithPassword({ email, password })
  if (signedIn.error) throw signedIn.error
  const client = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${signedIn.data.session.access_token}` } } })
  const { data, error } = await client.from('job_board_jobs').select('id,status').eq('id', fixture.jobId)
  const claim = await client.from('job_board_jobs').update({ status: 'pending', claimed_by: email.includes('pending') ? fixture.pending.instructorId : fixture.approved.instructorId, claimed_at: new Date().toISOString() }).eq('id', fixture.jobId).select('id,status,claimed_by')
  return { readError: error?.message || null, readCount: data?.length || 0, claimError: claim.error?.message || null, claimCount: claim.data?.length || 0 }
}

try {
  await makeInstructor('approved', 'Approved')
  await makeInstructor('pending', 'Pending')
  const { error: bookingError } = await service.from('bookings').insert({ id: fixture.bookingId, date: '2026-10-01', session_type: 'DBS RLS test', price: 100, student_count: 10, status: 'Confirmed', invoice_status: 'Not sent' })
  if (bookingError) throw bookingError
  const { error: jobError } = await service.from('job_board_jobs').insert({ id: fixture.jobId, booking_id: fixture.bookingId, date: '2026-10-01', session_type: 'DBS RLS test', student_count: 10, instructor_pay: 100, status: 'open' })
  if (jobError) throw jobError

  const pendingResult = await jobQueryAs(fixture.pending.email)
  await service.from('job_board_jobs').update({ status: 'open', claimed_by: null, claimed_at: null }).eq('id', fixture.jobId)
  const approvedResult = await jobQueryAs(fixture.approved.email)

  console.log(JSON.stringify({ pendingResult, approvedResult }, null, 2))
  if (pendingResult.readCount !== 0 || pendingResult.claimCount !== 0 || approvedResult.readCount !== 1 || approvedResult.claimCount !== 1) process.exitCode = 1
} finally {
  await service.from('job_board_jobs').delete().eq('id', fixture.jobId)
  await service.from('bookings').delete().eq('id', fixture.bookingId)
  for (const item of [fixture.approved, fixture.pending]) {
    await service.from('profiles').delete().eq('id', item.userId || 'none')
    await service.from('instructors').delete().eq('id', item.instructorId)
    if (item.userId) await service.auth.admin.deleteUser(item.userId)
  }
}
