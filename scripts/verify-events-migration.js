import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

// Verifies migration 20260918_events_and_subscription_pause.sql against the live project:
//  1. public.events exists and is queryable
//  2. parent_families.paused_at exists and is writable
//  3. RLS: anonymous visitors only see published + show_on_homepage events (the App.jsx homepage query)
//  4. RLS: an admin user can insert/update/delete events (the Operations > Events write path)

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY)

const suffix = Date.now()
const password = 'Temporary-test-password-123!'
const events = {
  homepage: `verify-evt-home-${suffix}`,     // published + show_on_homepage  -> visible publicly
  hidden: `verify-evt-hidden-${suffix}`,     // published but not homepage    -> hidden publicly
  draft: `verify-evt-draft-${suffix}`,       // draft + homepage flag         -> hidden publicly
}
const familyId = `verify-family-${suffix}`
const adminEmail = `verify-admin-${suffix}@example.com`
let adminUserId = null

const results = {}
let failed = false
function check(name, ok, detail) {
  results[name] = { ok, detail }
  if (!ok) failed = true
}

try {
  // --- Fixtures (service role bypasses RLS) ---
  const { error: seedError } = await service.from('events').insert([
    { id: events.homepage, title: 'Homepage event', status: 'published', show_on_homepage: true, event_date: '2026-10-01' },
    { id: events.hidden, title: 'Published not on homepage', status: 'published', show_on_homepage: false, event_date: '2026-10-02' },
    { id: events.draft, title: 'Draft flagged for homepage', status: 'draft', show_on_homepage: true, event_date: '2026-10-03' },
  ])
  if (seedError) throw new Error(`seed events failed (does public.events exist?): ${seedError.message}`)

  // --- 1. events table exists ---
  const { data: allEvents, error: readError } = await service.from('events').select('id,title,status,show_on_homepage,event_date,created_at').in('id', Object.values(events))
  check('events table exists & queryable', !readError && allEvents.length === 3, readError?.message || `${allEvents.length}/3 fixture rows read back`)

  // --- 2. parent_families.paused_at exists and is writable ---
  const { error: familyError } = await service.from('parent_families').insert({ id: familyId, guardian_name: 'Verify Pause', guardian_email: `verify-pause-${suffix}@example.com`, membership_status: 'active' })
  if (familyError) {
    check('paused_at column writable', false, `family fixture insert failed: ${familyError.message}`)
  } else {
    const pausedAt = new Date().toISOString()
    const { error: pauseError } = await service.from('parent_families').update({ paused_at: pausedAt }).eq('id', familyId)
    const { data: family, error: readPauseError } = await service.from('parent_families').select('paused_at').eq('id', familyId).single()
    check('paused_at column writable', !pauseError && !readPauseError && !!family?.paused_at, pauseError?.message || readPauseError?.message || `paused_at read back: ${family?.paused_at}`)
  }

  // --- 3. Anon sees only published + homepage events (exact query from src/App.jsx) ---
  const { data: publicEvents, error: publicError } = await anon
    .from('events').select('*').eq('status', 'published').eq('show_on_homepage', true).order('event_date', { ascending: true }).limit(6)
  const publicIds = (publicEvents || []).map((e) => e.id)
  check(
    'anon RLS: only published+homepage visible',
    !publicError && publicIds.includes(events.homepage) && !publicIds.includes(events.hidden) && !publicIds.includes(events.draft),
    publicError?.message || `anon saw fixture ids: [${publicIds.filter((id) => Object.values(events).includes(id)).join(', ') || 'none'}] (expected only homepage event)`
  )

  // --- 4. Admin can manage events through RLS (Operations > Events write path) ---
  const created = await service.auth.admin.createUser({ email: adminEmail, password, email_confirm: true })
  if (created.error) throw created.error
  adminUserId = created.data.user.id
  const { error: profileError } = await service.from('profiles').upsert({ id: adminUserId, role: 'admin', full_name: 'Verify Admin' })
  if (profileError) throw profileError

  const signedIn = await anon.auth.signInWithPassword({ email: adminEmail, password })
  if (signedIn.error) throw signedIn.error
  const asAdmin = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${signedIn.data.session.access_token}` } } })

  const adminEventId = `verify-evt-admin-${suffix}`
  const { error: insertError } = await asAdmin.from('events').upsert({ id: adminEventId, title: 'Admin write test', status: 'draft', show_on_homepage: false }, { onConflict: 'id' })
  const { error: updateError } = insertError ? { error: null } : await asAdmin.from('events').update({ status: 'published', show_on_homepage: true }).eq('id', adminEventId)
  const { data: adminRead, error: adminReadError } = updateError ? { data: null } : await asAdmin.from('events').select('id,status,show_on_homepage').eq('id', adminEventId)
  const { error: deleteError } = updateError ? { error: null } : await asAdmin.from('events').delete().eq('id', adminEventId)
  check(
    'admin RLS: insert/update/read/delete',
    !insertError && !updateError && !adminReadError && (adminRead || []).length === 1 && adminRead[0].status === 'published' && !deleteError,
    insertError?.message || updateError?.message || adminReadError?.message || deleteError?.message || 'full admin CRUD cycle succeeded'
  )

  // --- 5. Anon cannot write events ---
  const { error: anonWriteError, count: anonWriteCount } = await anon.from('events').upsert({ id: `verify-evt-anon-${suffix}`, title: 'should fail', status: 'published', show_on_homepage: true }, { onConflict: 'id' }).select('id')
  check('anon RLS: writes blocked', !!anonWriteError || (anonWriteCount ?? 0) === 0, anonWriteError?.message || 'anon write unexpectedly returned rows')
} finally {
  await service.from('events').delete().in('id', [...Object.values(events), `verify-evt-admin-${suffix}`, `verify-evt-anon-${suffix}`])
  await service.from('parent_families').delete().eq('id', familyId)
  if (adminUserId) {
    await service.from('profiles').delete().eq('id', adminUserId)
    await service.auth.admin.deleteUser(adminUserId)
  }
}

console.log(JSON.stringify(results, null, 2))
if (failed) process.exitCode = 1
