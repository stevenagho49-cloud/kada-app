import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anonKey = process.env.VITE_SUPABASE_ANON_KEY
const password = 'Temporary-invoice-test-123!'
const suffix = Date.now()
const fixture = { admin: null, regular: null, sender: null }
let failures = 0
const check = (label, ok, detail = '') => { if (!ok) failures += 1; console.log(`${ok ? 'PASS' : 'FAIL'} · ${label}${detail ? ` · ${detail}` : ''}`) }

async function makeUser(email, canSendInvoices = false) {
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error) throw created.error
  const { error } = await service.from('profiles').upsert({ id: created.data.user.id, role: 'school', full_name: email, can_send_invoices: canSendInvoices })
  if (error) throw error
  return created.data.user.id
}

async function asUser(email) {
  const auth = await createClient(url, anonKey).auth.signInWithPassword({ email, password })
  if (auth.error) throw auth.error
  return createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${auth.data.session.access_token}` } } })
}

try {
  const adminEmail = `invoice-admin-${suffix}@example.com`
  fixture.admin = await makeUser(adminEmail)
  fixture.regular = await makeUser(`invoice-regular-${suffix}@example.com`)
  fixture.sender = await makeUser(`invoice-sender-${suffix}@example.com`, true)
  const { error: settingsError } = await service.from('invoice_settings').upsert({ id: 'default', account_name: 'RLS Test Account', sort_code: '00-00-00', account_number: '00000000', updated_by: fixture.admin })
  if (settingsError) throw settingsError
  await service.from('profiles').update({ role: 'admin' }).eq('id', fixture.admin)

  const regular = await asUser(`invoice-regular-${suffix}@example.com`)
  const sender = await asUser(`invoice-sender-${suffix}@example.com`)
  const regularRead = await regular.from('invoice_settings').select('account_name')
  const senderRead = await sender.from('invoice_settings').select('account_name')
  check('regular non-admin cannot read bank settings', !regularRead.error && regularRead.data.length === 0, `rows=${regularRead.data?.length ?? 'error'}`)
  check('invoice sender cannot read bank settings', !senderRead.error && senderRead.data.length === 0, `rows=${senderRead.data?.length ?? 'error'}`)
  const regularWrite = await regular.from('invoice_settings').update({ account_name: 'spoof' }).eq('id', 'default').select()
  const senderWrite = await sender.from('invoice_settings').update({ account_name: 'spoof' }).eq('id', 'default').select()
  check('regular non-admin cannot write bank settings', !regularWrite.error && regularWrite.data.length === 0, `rows=${regularWrite.data?.length ?? 'error'}`)
  check('invoice sender cannot write bank settings', !senderWrite.error && senderWrite.data.length === 0, `rows=${senderWrite.data?.length ?? 'error'}`)

  const adminAuth = await createClient(url, anonKey).auth.signInWithPassword({ email: adminEmail, password })
  if (adminAuth.error) throw adminAuth.error
  const admin = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${adminAuth.data.session.access_token}` } } })
  const adminRead = await admin.from('invoice_settings').select('account_name,sort_code,account_number').eq('id', 'default').single()
  check('admin can read bank settings', !adminRead.error && adminRead.data.account_name === 'RLS Test Account', adminRead.error?.message || JSON.stringify(adminRead.data))
  const adminWrite = await admin.from('invoice_settings').update({ account_name: 'RLS Test Account Updated' }).eq('id', 'default').select().single()
  check('admin can write bank settings', !adminWrite.error && adminWrite.data.account_name === 'RLS Test Account Updated', adminWrite.error?.message || JSON.stringify(adminWrite.data))
  await service.from('invoice_settings').update({ account_name: '', sort_code: '', account_number: '', updated_by: null }).eq('id', 'default')
} catch (error) {
  failures += 1
  console.log(`FAIL · script error · ${error.message}`)
} finally {
  for (const userId of Object.values(fixture)) {
    if (!userId) continue
    await service.from('profiles').delete().eq('id', userId)
    await service.auth.admin.deleteUser(userId)
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
  if (failures) process.exitCode = 1
}
