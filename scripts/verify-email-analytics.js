import 'dotenv/config'
import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

// Checks campaign email analytics against Resend's own records, using the LIVE
// project and real Resend sends to Resend's test inboxes (no real people):
//   1. The audience preview counts every contact (not just the first 1,000)
//   2. A one-off campaign to delivered+…, bounced@ and complained@resend.dev,
//      started twice at once, is sent exactly once per address, each with its
//      Resend email id stored
//   3. Resend's webhook events arrive: Stats show delivered / bounced / marked as
//      spam, and every recipient's status matches Resend's own last_event for that
//      email (GET /emails/:id, the record Resend's dashboard shows)
//   4. Webhook security: a bad signature is refused; a redelivery changes nothing
//   5. "Check with Resend" restores a status the webhook missed
//   6. Opens and clicks: a real browser open/click counts, a mail-proxy fetch doesn't
// The campaign, its send rows and stored events are deleted at the end.
//
// Requires: the 20261001 migration, node server/index.js on PORT (default 4242)
// started with RESEND_WEBHOOK_SECRET, and a Resend webhook for this server's
// public /api/resend/webhook using that secret (same value in this process).

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const serverBase = `http://localhost:${process.env.PORT || 4242}`
const stamp = Date.now()
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures += 1
}
const resend = (path) => fetch(`https://api.resend.com/${path}`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } }).then((response) => response.json())

const recipients = {
  [`delivered+analytics-a-${stamp}@resend.dev`]: 'delivered',
  [`delivered+analytics-b-${stamp}@resend.dev`]: 'delivered',
  'bounced@resend.dev': 'bounced',
  'complained@resend.dev': 'complained',
}
const cleanup = { users: [], campaignId: null, emailIds: [] }

async function run() {
  const { error: migrationError } = await service.from('campaign_sends').select('resend_id,last_event,delivered_at').limit(0)
  const { error: eventsError } = await service.from('resend_events').select('svix_id').limit(0)
  if (migrationError || eventsError) throw new Error('Apply supabase/migrations/20261001_delivery_tracking_jobs_messaging.sql first.')
  if (!process.env.RESEND_WEBHOOK_SECRET) throw new Error('Set RESEND_WEBHOOK_SECRET (the webhook signing secret) for this script too.')

  const password = `Verify-${stamp}-analytics!`
  const { data: created } = await service.auth.admin.createUser({ email: `analytics-admin-${stamp}@example.com`, password, email_confirm: true, user_metadata: { role: 'staff' }, app_metadata: { signup_notified_at: new Date().toISOString() } })
  cleanup.users.push(created.user.id)
  await service.from('profiles').update({ role: 'admin', full_name: 'Analytics Verify' }).eq('id', created.user.id)
  const { data: signIn } = await createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.signInWithPassword({ email: `analytics-admin-${stamp}@example.com`, password })
  const token = signIn.session.access_token
  const api = (path, body, method = 'POST') => fetch(`${serverBase}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => ({})) }))

  // 1. Audience size: every contact, deduplicated, beyond PostgREST's 1,000-row page.
  const emails = new Set()
  for (let from = 0; ; from += 1000) {
    const { data } = await service.from('contacts').select('email').order('id').range(from, from + 999)
    ;(data || []).forEach((row) => { if (row.email) emails.add(row.email.toLowerCase()) })
    if ((data || []).length < 1000) break
  }
  const audience = await api('/api/admin/campaigns/audience-count', { audience: 'all' })
  check('"All contacts" reaches every contact, not just the first 1,000', audience.body.count === emails.size && emails.size > 1000, `${audience.body.count} recipients, ${emails.size} unique contact emails`)

  // 2. Send, with two "Send now" presses at once.
  const campaign = await api('/api/admin/campaigns', { name: `Analytics verify ${stamp}`, subject: `KADA analytics check ${stamp}`, bodyHtml: '<div><p>Hi {{name}}, this is a delivery-tracking check.</p><p><a href="https://kingsarkdance.com/">Visit KADA</a></p></div>', audience: 'custom', customEmails: Object.keys(recipients).join('\n') })
  cleanup.campaignId = campaign.body.campaign?.id
  check('One-off campaign saved', campaign.status === 200, campaign.body.error)
  await Promise.all([api(`/api/admin/campaigns/${cleanup.campaignId}/send-now`), api(`/api/admin/campaigns/${cleanup.campaignId}/send-now`)])
  let rows = []
  for (let attempt = 0; attempt < 40; attempt += 1) {
    ;({ data: rows } = await service.from('campaign_sends').select('*').eq('campaign_id', cleanup.campaignId))
    if (rows.length && rows.every((row) => row.status !== 'queued')) break
    await sleep(1500)
  }
  cleanup.emailIds = rows.map((row) => row.resend_id).filter(Boolean)
  check('Each address gets exactly one email (no double send)', rows.length === 4 && new Set(rows.map((row) => row.email)).size === 4, `${rows.length} send rows`)
  check('Every send was accepted by Resend and its email id stored', rows.every((row) => row.status === 'sent' && row.resend_id), rows.map((row) => `${row.email.split('@')[0]}:${row.status}`).join(', '))

  // 3. Webhook events → Stats, compared with Resend's own record of each email.
  let stats = null
  for (let attempt = 0; attempt < 60; attempt += 1) {
    stats = (await api(`/api/admin/campaigns/${cleanup.campaignId}/analytics`, null, 'GET')).body
    if (stats.delivered === 3 && stats.bounced === 1 && stats.complained === 1) break
    await sleep(3000)
  }
  check('Stats: 4 accepted, 3 delivered, 1 bounced, 1 marked as spam, none pending', stats.sent === 4 && stats.delivered === 3 && stats.bounced === 1 && stats.complained === 1 && stats.awaiting === 0, `accepted ${stats.sent}, delivered ${stats.delivered}, bounced ${stats.bounced}, spam ${stats.complained}, awaiting ${stats.awaiting}`)
  for (const row of stats.recipients) {
    const email = await resend(`emails/${row.resend_id}`)
    const ours = row.complained_at ? 'complained' : row.bounced_at ? 'bounced' : row.delivered_at ? 'delivered' : row.last_event
    check(`${row.email}: app status matches Resend (${email.last_event})`, ours === email.last_event && email.last_event === recipients[row.email], `app=${ours}, Resend=${email.last_event}${row.bounce_type ? `, bounce: ${row.bounce_type}` : ''}`)
  }
  const { data: events } = await service.from('resend_events').select('type,email_id').in('email_id', cleanup.emailIds)
  const types = events.reduce((counts, event) => ({ ...counts, [event.type]: (counts[event.type] || 0) + 1 }), {})
  check('Resend events were received and stored', events.length >= 4, JSON.stringify(types))

  // 4. Webhook security and redelivery.
  const sample = await service.from('resend_events').select('*').in('email_id', cleanup.emailIds).eq('type', 'email.delivered').limit(1).single()
  const body = JSON.stringify(sample.data.payload)
  const forged = await fetch(`${serverBase}/api/resend/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'svix-id': `msg_forged_${stamp}`, 'svix-timestamp': String(Math.floor(Date.now() / 1000)), 'svix-signature': 'v1,Zm9yZ2Vk' }, body })
  check('A webhook call with a bad signature is refused', forged.status === 401)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = createHmac('sha256', Buffer.from(process.env.RESEND_WEBHOOK_SECRET.replace(/^whsec_/, ''), 'base64')).update(`${sample.data.svix_id}.${timestamp}.${body}`).digest('base64')
  const replay = await fetch(`${serverBase}/api/resend/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'svix-id': sample.data.svix_id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` }, body }).then((response) => response.json())
  check('A redelivered event is recognised and ignored', replay.duplicate === true)

  // 5. "Check with Resend" fills in a missed event.
  const target = stats.recipients.find((row) => recipients[row.email] === 'delivered')
  await service.from('campaign_sends').update({ delivered_at: null, last_event: 'sent' }).eq('id', target.id)
  const missing = (await api(`/api/admin/campaigns/${cleanup.campaignId}/analytics`, null, 'GET')).body
  check('With the event missing, Stats show it as awaiting a result', missing.delivered === 2 && missing.awaiting === 1)
  const sync = await api(`/api/admin/campaigns/${cleanup.campaignId}/sync-resend`)
  check('Check with Resend starts', sync.body.started === true, `checking ${sync.body.checking}`)
  let restored = null
  for (let attempt = 0; attempt < 20; attempt += 1) {
    restored = (await api(`/api/admin/campaigns/${cleanup.campaignId}/analytics`, null, 'GET')).body
    if (restored.delivered === 3) break
    await sleep(1500)
  }
  check('Check with Resend restores the delivered status from Resend', restored.delivered === 3 && restored.awaiting === 0)

  // 6. Opens and clicks. Fetches in the first 2 minutes after sending are treated
  // as delivery-time prefetches, so the reader's open is made after that.
  const reader = rows.find((row) => recipients[row.email] === 'delivered')
  await fetch(`${serverBase}/api/t/open/${reader.id}.gif`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko; compatible; GoogleImageProxy)' } })
  const wait = Math.max(0, Date.parse(reader.sent_at) + 125000 - Date.now())
  console.log(`      waiting ${Math.round(wait / 1000)}s so the open is outside the 2-minute prefetch window…`)
  await sleep(wait)
  await fetch(`${serverBase}/api/t/open/${reader.id}.gif`, { headers: { 'User-Agent': BROWSER_UA } })
  await fetch(`${serverBase}/api/t/click/${reader.id}?u=${encodeURIComponent('https://kingsarkdance.com/')}`, { headers: { 'User-Agent': BROWSER_UA }, redirect: 'manual' })
  await sleep(2000)
  const engagement = (await api(`/api/admin/campaigns/${cleanup.campaignId}/analytics`, null, 'GET')).body
  check('A real reader open and click are counted (1 opened, 1 clicked)', engagement.opened === 1 && engagement.clicked === 1)
  check('The mail-proxy fetch is not counted as an open', engagement.machineOpens >= 1, `${engagement.machineOpens} machine fetch(es) filtered`)
}

try {
  await run()
} catch (error) {
  failures += 1
  console.error('Verification aborted:', error.stack || error.message)
} finally {
  if (cleanup.emailIds.length) await service.from('resend_events').delete().in('email_id', cleanup.emailIds)
  if (cleanup.campaignId) await service.from('campaigns').delete().eq('id', cleanup.campaignId)
  for (const id of cleanup.users) {
    await service.from('profiles').delete().eq('id', id)
    await service.auth.admin.deleteUser(id)
  }
  console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.')
  process.exit(failures ? 1 : 0)
}
