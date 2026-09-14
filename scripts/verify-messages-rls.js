import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY)

const suffix = Date.now()
const password = 'Temporary-test-password-123!'
const ids = {
  adminUser: null,
  instructorA: { userId: null, instructorId: `msg-instr-a-${suffix}`, email: `msg-instr-a-${suffix}@example.com` },
  instructorB: { userId: null, instructorId: `msg-instr-b-${suffix}`, email: `msg-instr-b-${suffix}@example.com` },
  schoolA: { userId: null, schoolId: `msg-school-a-${suffix}`, email: `msg-school-a-${suffix}@example.com` },
  schoolB: { userId: null, schoolId: `msg-school-b-${suffix}`, email: `msg-school-b-${suffix}@example.com` },
}
let failures = 0
const check = (label, ok, detail = '') => { if (!ok) failures += 1; console.log(`${ok ? 'PASS' : 'FAIL'} · ${label}${detail ? ` · ${detail}` : ''}`) }

async function makeUser(email, role, link) {
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error) throw created.error
  const { error } = await service.from('profiles').upsert({ id: created.data.user.id, role, full_name: email, ...link })
  if (error) throw error
  return created.data.user.id
}

async function clientFor(email) {
  const signedIn = await anon.auth.signInWithPassword({ email, password })
  if (signedIn.error) throw signedIn.error
  return createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${signedIn.data.session.access_token}` } } })
}

try {
  // Fixtures: admin + two instructors + two schools
  const adminEmail = `msg-admin-${suffix}@example.com`
  ids.adminUser = await makeUser(adminEmail, 'admin', {})
  for (const key of ['instructorA', 'instructorB']) {
    await service.from('instructors').insert({ id: ids[key].instructorId, name: key, email: ids[key].email, dbs_status: 'Approved' })
    ids[key].userId = await makeUser(ids[key].email, 'instructor', { instructor_id: ids[key].instructorId })
  }
  for (const key of ['schoolA', 'schoolB']) {
    await service.from('schools').insert({ id: ids[key].schoolId, name: key, email: ids[key].email })
    ids[key].userId = await makeUser(ids[key].email, 'school', { school_id: ids[key].schoolId })
  }
  const admin = await clientFor(adminEmail)
  const instructorA = await clientFor(ids.instructorA.email)
  const instructorB = await clientFor(ids.instructorB.email)
  const schoolA = await clientFor(ids.schoolA.email)
  const schoolB = await clientFor(ids.schoolB.email)

  // 1. Admin sends to instructor A and school A
  const m1 = await admin.from('messages').insert({ sender_kind: 'admin', recipient_kind: 'instructor', recipient_instructor_id: ids.instructorA.instructorId, body: 'Admin to instructor A' }).select().single()
  check('admin can message instructor A', !m1.error, m1.error?.message || m1.data?.id)
  const m2 = await admin.from('messages').insert({ sender_kind: 'admin', recipient_kind: 'school', recipient_school_id: ids.schoolA.schoolId, body: 'Admin to school A' }).select().single()
  check('admin can message school A', !m2.error, m2.error?.message || m2.data?.id)

  // 2. Recipients read only their own messages
  const readA = await instructorA.from('messages').select('id,body')
  check('instructor A sees exactly 1 message (their own)', !readA.error && readA.data.length === 1 && readA.data[0].body === 'Admin to instructor A', `rows=${readA.data?.length ?? 'error'}`)
  const readB = await instructorB.from('messages').select('id')
  check('instructor B sees 0 messages (isolation)', !readB.error && readB.data.length === 0, `rows=${readB.data?.length ?? 'error'}`)
  const readSchoolA = await schoolA.from('messages').select('id,body')
  check('school A sees exactly 1 message (their own)', !readSchoolA.error && readSchoolA.data.length === 1 && readSchoolA.data[0].body === 'Admin to school A', `rows=${readSchoolA.data?.length ?? 'error'}`)
  const readSchoolB = await schoolB.from('messages').select('id')
  check('school B sees 0 messages (isolation)', !readSchoolB.error && readSchoolB.data.length === 0, `rows=${readSchoolB.data?.length ?? 'error'}`)

  // 3. Instructor A replies; admin sees the reply
  const reply = await instructorA.from('messages').insert({ sender_kind: 'instructor', sender_instructor_id: ids.instructorA.instructorId, recipient_kind: 'admin', body: 'Reply from instructor A' }).select().single()
  check('instructor A can reply to admin', !reply.error, reply.error?.message || reply.data?.id)
  const adminRead = await admin.from('messages').select('id')
  check('admin sees all 3 messages', !adminRead.error && adminRead.data.length === 3, `rows=${adminRead.data?.length ?? 'error'}`)

  // 4. Recipient marks read; non-recipient cannot
  const mark = await instructorA.from('messages').update({ read_at: new Date().toISOString() }).eq('id', m1.data.id).select()
  check('instructor A can mark their message read', !mark.error && mark.data.length === 1, `updated=${mark.data?.length ?? 'error'}`)
  const badMark = await instructorB.from('messages').update({ read_at: new Date().toISOString() }).eq('id', m1.data.id).select()
  check('instructor B cannot mark A’s message (0 rows)', !badMark.error && badMark.data.length === 0, `updated=${badMark.data?.length ?? 'error'}`)

  // 5. Participants cannot spoof sender identity or message another participant
  const spoof = await instructorA.from('messages').insert({ sender_kind: 'instructor', sender_instructor_id: ids.instructorB.instructorId, recipient_kind: 'admin', body: 'spoof' })
  check('instructor A cannot send as instructor B', Boolean(spoof.error), spoof.error?.message || 'unexpectedly succeeded')
  const crossMessage = await instructorA.from('messages').insert({ sender_kind: 'instructor', sender_instructor_id: ids.instructorA.instructorId, recipient_kind: 'instructor', recipient_instructor_id: ids.instructorB.instructorId, body: 'cross' })
  check('instructor cannot message another instructor directly', Boolean(crossMessage.error), crossMessage.error?.message || 'unexpectedly succeeded')
} catch (error) {
  failures += 1
  console.log(`FAIL · script error · ${error.message}`)
} finally {
  await service.from('messages').delete().or(`sender_instructor_id.like.msg-%,recipient_instructor_id.like.msg-%,sender_school_id.like.msg-%,recipient_school_id.like.msg-%`)
  for (const key of ['instructorA', 'instructorB']) {
    await service.from('profiles').delete().eq('id', ids[key].userId || 'none')
    await service.from('instructors').delete().eq('id', ids[key].instructorId)
    if (ids[key].userId) await service.auth.admin.deleteUser(ids[key].userId)
  }
  for (const key of ['schoolA', 'schoolB']) {
    await service.from('profiles').delete().eq('id', ids[key].userId || 'none')
    await service.from('schools').delete().eq('id', ids[key].schoolId)
    if (ids[key].userId) await service.auth.admin.deleteUser(ids[key].userId)
  }
  await service.from('profiles').delete().eq('id', ids.adminUser || 'none')
  if (ids.adminUser) await service.auth.admin.deleteUser(ids.adminUser)
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
  if (failures) process.exitCode = 1
}
