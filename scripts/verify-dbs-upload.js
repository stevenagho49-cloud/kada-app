import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY)

const suffix = Date.now()
const password = 'Temporary-test-password-123!'
const instructorId = `dbs-upload-${suffix}`
const email = `dbs-upload-${suffix}@example.com`
let userId = null
let adminUserId = null
let storagePath = null
let failures = 0

const check = (label, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} · ${label}${detail ? ` · ${detail}` : ''}`)
}

try {
  // Fixture: instructor user, row (Missing), linked profile
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error) throw created.error
  userId = created.data.user.id
  const { error: instructorError } = await service.from('instructors').insert({ id: instructorId, name: 'DBS Upload Test', email, rate: 100, dbs_status: 'Missing' })
  if (instructorError) throw instructorError
  const { error: profileError } = await service.from('profiles').upsert({ id: userId, role: 'instructor', full_name: 'DBS Upload Test', instructor_id: instructorId })
  if (profileError) throw profileError

  const signedIn = await anon.auth.signInWithPassword({ email, password })
  if (signedIn.error) throw signedIn.error
  const instructorClient = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${signedIn.data.session.access_token}` } } })

  // 1. Prove the old code path (upsert via instructor token) is rejected by RLS
  const upsertAttempt = await instructorClient.from('instructors').upsert({ id: instructorId, name: 'DBS Upload Test', email, rate: 100, dbs_status: 'Pending' }, { onConflict: 'id' })
  check('old upsert path is rejected (root cause)', Boolean(upsertAttempt.error), upsertAttempt.error?.message || 'unexpectedly succeeded')

  // 2. Upload a real PDF file to the private bucket as the instructor
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
  storagePath = `${instructorId}/${Date.now()}-test-dbs.pdf`
  const { error: uploadError } = await instructorClient.storage.from('dbs-certificates').upload(storagePath, pdf, { contentType: 'application/pdf' })
  check('instructor can upload PDF to private bucket', !uploadError, uploadError?.message || storagePath)

  // 3. Run the new update path exactly as uploadDbs now does
  const { data: updatedRow, error: updateError } = await instructorClient.from('instructors').update({ dbs_status: 'Pending', dbs_file_path: storagePath, dbs_uploaded_at: new Date().toISOString(), dbs_decided_at: null, dbs_rejection_reason: null }).eq('id', instructorId).select().single()
  check('direct update sets dbs_status Pending', !updateError && updatedRow?.dbs_status === 'Pending', updateError?.message || `dbs_status=${updatedRow?.dbs_status}`)

  // 4. Confirm the database row itself
  const { data: dbRow } = await service.from('instructors').select('dbs_status,dbs_file_path,dbs_uploaded_at').eq('id', instructorId).single()
  check('database row has Pending status', dbRow?.dbs_status === 'Pending', `dbs_status=${dbRow?.dbs_status}`)
  check('database row has file path', dbRow?.dbs_file_path === storagePath, dbRow?.dbs_file_path || 'null')
  check('database row has upload timestamp', Boolean(dbRow?.dbs_uploaded_at), dbRow?.dbs_uploaded_at || 'null')

  // 5. Confirm the file is really stored in the private bucket
  const { data: stored } = await service.storage.from('dbs-certificates').list(instructorId)
  check('file exists in private bucket', (stored || []).some((object) => storagePath.endsWith(object.name)), `${stored?.length || 0} file(s) in folder`)

  // 6. Confirm the admin view sees the Pending row (same query the app uses)
  const adminEmail = `dbs-admin-${suffix}@example.com`
  const adminCreated = await service.auth.admin.createUser({ email: adminEmail, password, email_confirm: true })
  if (adminCreated.error) throw adminCreated.error
  adminUserId = adminCreated.data.user.id
  const { error: adminProfileError } = await service.from('profiles').upsert({ id: adminUserId, role: 'admin', full_name: 'DBS Admin Test' })
  if (adminProfileError) throw adminProfileError
  const adminSignIn = await anon.auth.signInWithPassword({ email: adminEmail, password })
  if (adminSignIn.error) throw adminSignIn.error
  const adminClient = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${adminSignIn.data.session.access_token}` } } })
  const { data: adminRows, error: adminError } = await adminClient.from('instructors').select('*')
  const adminRow = (adminRows || []).find((row) => row.id === instructorId)
  check('admin query sees instructor as Pending', !adminError && adminRow?.dbs_status === 'Pending', adminError?.message || `dbs_status=${adminRow?.dbs_status}`)
  check('admin query sees the file path', adminRow?.dbs_file_path === storagePath, adminRow?.dbs_file_path || 'null')
} catch (error) {
  failures += 1
  console.log(`FAIL · script error · ${error.message}`)
} finally {
  if (storagePath) await service.storage.from('dbs-certificates').remove([storagePath])
  await service.from('profiles').delete().eq('id', userId || 'none')
  await service.from('profiles').delete().eq('id', adminUserId || 'none')
  await service.from('instructors').delete().eq('id', instructorId)
  if (userId) await service.auth.admin.deleteUser(userId)
  if (adminUserId) await service.auth.admin.deleteUser(adminUserId)
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
  if (failures) process.exitCode = 1
}
