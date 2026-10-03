import 'dotenv/config'
import fs from 'node:fs'
import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

// Live check of campaign audiences, exclusions and unsubscribes, against the
// LIVE Supabase project and Resend. Only temporary test contacts (resend.dev
// addresses) are ever emailed: the two audience segments ticked are two
// contact tags made for this run.
//   Tag A: c1, c3, c4, c7      Tag B: c2, c3, c5
//   c3 is in both (one email); c4 is excluded from this campaign only;
//   c5 unsubscribes through the link in a real campaign email (confirm page,
//   then the button); c7 uses mail apps' one-click unsubscribe; c1 is also
//   typed into "Also send to" (still one email).
// Expected: 6 different people, 1 duplicate, 2 unsubscribed, 1 excluded, so
// exactly c1, c2, c3 are sent to. Then: a queued email to someone who
// unsubscribed is held back at send time, and a spam complaint (signed Resend
// webhook) unsubscribes that person too.
// Everything is deleted at the end unless KEEP=1.
//
// Requires: node server/index.js on PORT serving a build of this code, started
// with RESEND_WEBHOOK_SECRET set to the same value as here; the migration
// 20261004_campaign_segments_unsubscribes.sql applied; PLAYWRIGHT_CORE.

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const serverBase = `http://localhost:${process.env.PORT || 4242}`
const stamp = Date.now()
const tag = String(stamp).slice(-6)
const TAG_A = `Verify segment A ${tag}`
const TAG_B = `Verify segment B ${tag}`
const address = (n) => `delivered+kada-seg-c${n}-${stamp}@resend.dev`
const people = {
  c1: { tags: [TAG_A] }, c2: { tags: [TAG_B] }, c3: { tags: [TAG_A, TAG_B] }, c4: { tags: [TAG_A] }, c5: { tags: [TAG_B] }, c7: { tags: [TAG_A] },
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const shot = (page, name) => (process.env.SCREENSHOT_DIR ? page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/segments-${name}.png`, fullPage: true }) : null)

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures += 1
}
const cleanup = { users: [], campaigns: [], contacts: [] }
const resendEmail = (id) => fetch(`https://api.resend.com/emails/${id}`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } }).then((response) => response.json())
const sendsFor = async (campaignId) => (await service.from('campaign_sends').select('*').eq('campaign_id', campaignId)).data || []
async function waitForSends(campaignId, expected) {
  for (let i = 0; i < 60; i += 1) {
    const rows = await sendsFor(campaignId) // eslint-disable-line no-await-in-loop
    if (rows.length >= expected && rows.every((row) => row.status !== 'queued')) return rows
    await sleep(1500) // eslint-disable-line no-await-in-loop
  }
  return sendsFor(campaignId)
}
const unsubscribeToken = (email) => `${Buffer.from(email).toString('base64url')}.${createHmac('sha256', process.env.UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY).update(`unsubscribe:${email}`).digest('base64url').slice(0, 32)}`
const unsubscribed = async (email) => (await service.from('email_unsubscribes').select('source').eq('email', email).maybeSingle()).data

async function run() {
  const probe = await service.from('email_unsubscribes').select('email').limit(0)
  if (probe.error) throw new Error(`Migration not applied: ${probe.error.message}`)
  const { data: contacts, error } = await service.from('contacts').insert(Object.entries(people).map(([key, person]) => ({ kind: 'other', name: `Seg ${key.toUpperCase()} ${tag}`, email: address(key.slice(1)), source: 'manual', tags: person.tags }))).select('id,email')
  if (error) throw error
  cleanup.contacts = contacts.map((row) => row.id)

  const email = `segments-admin-${stamp}@example.com`
  const password = `Verify-${stamp}-admin!`
  const { data: created } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: 'admin', full_name: 'Segments Verify Admin' }, app_metadata: { signup_notified_at: new Date().toISOString() } })
  cleanup.users.push(created.user.id)
  await service.from('profiles').update({ role: 'admin' }).eq('id', created.user.id)
  const session = (await createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password })).data.session
  const api = (path, body) => fetch(`${serverBase}${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, ...(body ? { body: JSON.stringify(body) } : {}) }).then((response) => response.json())

  const { chromium } = await import(process.env.PLAYWRIGHT_CORE)
  const root = `${process.env.HOME}/.cache/ms-playwright`
  const dir = fs.readdirSync(root).find((name) => /^chromium-\d+$/.test(name))
  const browser = await chromium.launch({ executablePath: `${root}/${dir}/${fs.readdirSync(`${root}/${dir}`).find((name) => name.startsWith('chrome-linux'))}/chrome` })
  try {
    /* c5 unsubscribes through the link in a real campaign email */
    const first = await api('/api/admin/campaigns', { name: `Unsubscribe link (verify ${tag})`, subject: `Unsubscribe check ${tag}`, bodyHtml: '<div style="padding:28px 28px 8px"><p style="margin:0 0 14px;font-size:15px">Hi {{name}}</p></div><div style="padding:18px 28px 26px">You\'re receiving this because you\'re part of the KADA community.</div>', customEmails: [address(5)], recurrence: 'none' })
    if (!first.campaign) throw new Error(first.error || 'Test campaign not created')
    cleanup.campaigns.push(first.campaign.id)
    await api(`/api/admin/campaigns/${first.campaign.id}/send-now`, {})
    const [firstSend] = await waitForSends(first.campaign.id, 1)
    const firstEmail = await resendEmail(firstSend.resend_id)
    const link = (firstEmail.html || '').match(/href="([^"]+\/api\/unsubscribe\/[^"]+)"[^>]*>Unsubscribe</)?.[1]?.replace(/&amp;/g, '&')
    check('Campaign email has an Unsubscribe link in the footer (not click-tracked)', Boolean(link) && link.includes('/api/unsubscribe/') && !link.includes('/api/t/click/'), link)
    const local = link.replace(/^https?:\/\/[^/]+/, serverBase)
    const page = await browser.newPage()
    await page.goto(local)
    await page.getByRole('button', { name: 'Unsubscribe' }).waitFor({ timeout: 15000 })
    check('Opening the link only shows a confirm page (not unsubscribed yet)', !(await unsubscribed(address(5))) && (await page.content()).includes(address(5)))
    await page.getByRole('button', { name: 'Unsubscribe' }).click()
    await page.getByRole('heading', { name: "You're unsubscribed" }).waitFor({ timeout: 15000 })
    const c5 = await unsubscribed(address(5))
    check('Pressing Unsubscribe records it (source: link)', c5?.source === 'link', JSON.stringify(c5))
    await shot(page, '1-unsubscribed')

    /* c7: mail apps' one-click unsubscribe */
    const oneClick = await fetch(`${serverBase}/api/unsubscribe/${unsubscribeToken(address(7))}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' })
    check('One-click unsubscribe (mail app button) records it', oneClick.status === 200 && (await unsubscribed(address(7)))?.source === 'one-click')
    const forged = await fetch(`${serverBase}/api/unsubscribe/${Buffer.from(address(1)).toString('base64url')}.forgedsignature000000000000000`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' })
    check('A forged link unsubscribes nobody', forged.status === 404 && !(await unsubscribed(address(1))))

    /* The campaign: two segments, one exclusion, a typed duplicate */
    const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } })
    await context.addInitScript(([name, value]) => window.localStorage.setItem(name, value), [`sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`, JSON.stringify(session)])
    const admin = await context.newPage()
    let dialogText = ''
    admin.on('dialog', (dialog) => { dialogText = dialog.message(); dialog.accept() })
    await admin.goto(`${serverBase}/#ops/campaigns`)
    await admin.getByRole('button', { name: /Contact tags/ }).click()
    await admin.getByLabel(new RegExp(`^${TAG_A}`)).check()
    await admin.getByLabel(new RegExp(`^${TAG_B}`)).check()
    const total = admin.getByTestId('recipient-total')
    const working = admin.getByTestId('recipient-working')
    await total.filter({ hasText: 'Will be sent to 4 people' }).waitFor({ timeout: 20000 })
    const workingText = await working.innerText()
    check('Two segments: 4 + 3 = 6 different people, 1 counted once, minus 2 unsubscribed → 4', workingText.includes(`Tag: ${TAG_A} 4 + Tag: ${TAG_B} 3 = 6 different people (1 in more than one group, counted once), minus 2 unsubscribed`), workingText)
    await admin.getByLabel('Find a recipient').fill(`seg-c5-${stamp}`)
    check('An unsubscribed person shows as "Unsubscribed" and cannot be sent to', await admin.getByText('Unsubscribed', { exact: true }).count() === 1)
    await admin.getByLabel('Find a recipient').fill(`seg-c4-${stamp}`)
    await admin.getByRole('button', { name: 'Exclude' }).click()
    await total.filter({ hasText: 'Will be sent to 3 people' }).waitFor({ timeout: 20000 })
    check('Excluding one person: count drops to 3, "minus 1 excluded"', (await working.innerText()).includes('minus 1 excluded'))
    await admin.getByLabel('Extra email addresses').fill(address(1))
    await sleep(1200)
    await total.filter({ hasText: 'Will be sent to 3 people' }).waitFor({ timeout: 20000 })
    check('Typing an address already in a segment still counts them once', (await working.innerText()).includes('Typed addresses 1 = 6 different people (2 in more than one group'), await working.innerText())
    await shot(admin, '2-audience')
    await admin.locator('label', { hasText: 'Campaign name (internal)' }).locator('input').fill(`Segments (verify ${tag})`)
    await admin.locator('label', { hasText: 'Subject line' }).locator('input').fill(`Segments check ${tag}`)
    await admin.getByRole('button', { name: 'Send now' }).click()
    await admin.getByText('Sending has started').waitFor({ timeout: 30000 })
    check('"Send now" asks to confirm with the exact count', dialogText === `Send "Segments check ${tag}" to 3 people now?`, dialogText)
    const { data: campaign } = await service.from('campaigns').select('*').ilike('name', `%(verify ${tag})%`).neq('id', first.campaign.id).single()
    cleanup.campaigns.push(campaign.id)
    check('Campaign stores both segments and the exclusion', campaign.audience === 'multi' && campaign.audiences.join('|') === `tag:${TAG_A}|tag:${TAG_B}` && campaign.excluded_emails.join() === address(4), JSON.stringify({ audiences: campaign.audiences, excluded: campaign.excluded_emails }))
    const rows = await waitForSends(campaign.id, 3)
    const sentTo = rows.map((row) => row.email).sort()
    check('Actual send list is exactly c1, c2, c3, once each', sentTo.join() === [address(1), address(2), address(3)].sort().join() && rows.every((row) => row.status === 'sent'), sentTo.join(', '))
    check('Never sent to: the excluded person or either unsubscribed person', ![address(4), address(5), address(7)].some((item) => sentTo.includes(item)))
    const c3Mail = await resendEmail(rows.find((row) => row.email === address(3)).resend_id)
    check('Each email carries its own unsubscribe link', (c3Mail.html || '').includes(`/api/unsubscribe/${unsubscribeToken(address(3))}`))
    check('c4 is excluded only from this campaign, not unsubscribed', !(await unsubscribed(address(4))))

    /* Send-time check: a queued email to someone who has since unsubscribed */
    await service.from('campaign_sends').insert({ campaign_id: campaign.id, email: address(5), status: 'queued' })
    await api(`/api/admin/campaigns/${campaign.id}/send-now`, {})
    let late
    for (let i = 0; i < 30 && late?.status !== 'skipped'; i += 1) { late = (await service.from('campaign_sends').select('status,error,resend_id').eq('campaign_id', campaign.id).eq('email', address(5)).single()).data; if (late?.status === 'queued') await sleep(1000) } // eslint-disable-line no-await-in-loop
    check('A queued email to an unsubscribed person is held back at send time', late?.status === 'skipped' && !late.resend_id, JSON.stringify(late))
    check('The re-send did not email c1, c2, c3 again', (await sendsFor(campaign.id)).filter((row) => row.status === 'sent').length === 3)

    /* A spam complaint unsubscribes too */
    const c2Row = rows.find((row) => row.email === address(2))
    if (process.env.RESEND_WEBHOOK_SECRET && c2Row.resend_id) {
      const payload = JSON.stringify({ type: 'email.complained', created_at: new Date().toISOString(), data: { email_id: c2Row.resend_id } })
      const id = `msg_verify_${stamp}`
      const timestamp = String(Math.floor(Date.now() / 1000))
      const signature = createHmac('sha256', Buffer.from(process.env.RESEND_WEBHOOK_SECRET.replace(/^whsec_/, ''), 'base64')).update(`${id}.${timestamp}.${payload}`).digest('base64')
      const webhook = await fetch(`${serverBase}/api/resend/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` }, body: payload })
      check('A spam complaint unsubscribes the person (source: spam-complaint)', webhook.status === 200 && (await unsubscribed(address(2)))?.source === 'spam-complaint')
      await service.from('resend_events').delete().eq('svix_id', id)
    } else {
      check('A spam complaint unsubscribes the person (needs RESEND_WEBHOOK_SECRET)', false, 'skipped: no secret')
    }

    /* The campaign list */
    await admin.goto(`${serverBase}/?r=1#ops/campaigns`)
    const listRow = admin.locator('div', { hasText: `Segments (verify ${tag})` }).filter({ has: admin.getByRole('button', { name: 'Delete' }) }).last()
    await listRow.waitFor({ timeout: 20000 })
    const listText = (await listRow.innerText()).replace(/\s+/g, ' ')
    check('Campaign list shows both segments, the exclusion and the held-back email', listText.includes(`Tag: ${TAG_A} + Tag: ${TAG_B} + 1 typed address (1 excluded)`) && listText.includes('3 accepted by Resend') && listText.includes('1 held back (unsubscribed)'), listText)
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
  if (process.env.KEEP === '1') {
    console.log('\nKEEP=1: left the test contacts, campaigns and unsubscribes in place.')
  } else {
    for (const id of cleanup.campaigns) await service.from('campaigns').delete().eq('id', id) // eslint-disable-line no-await-in-loop
    await service.from('email_unsubscribes').delete().like('email', `delivered+kada-seg-%-${stamp}@resend.dev`)
    if (cleanup.contacts.length) await service.from('contacts').delete().in('id', cleanup.contacts)
    for (const id of cleanup.users) await service.auth.admin.deleteUser(id) // eslint-disable-line no-await-in-loop
    console.log('\nCleaned up the test contacts, campaigns, unsubscribes and admin login.')
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}
