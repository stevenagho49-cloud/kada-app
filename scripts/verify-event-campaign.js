import 'dotenv/config'
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// Live check of event-linked campaigns, against the LIVE Supabase project and
// Resend, on the real "It's Time to Rise" event (which is only read, never
// changed):
//   1. Events > "Promote this event" opens a campaign pre-filled with the title
//      as subject, the flyer, date/time/venue and a "Get tickets" button to
//      /event/<id>.
//   2. "Insert event" drops the same block below the block last clicked into.
//   3. A real send to a one-off test address: the email Resend accepted has the
//      flyer, date and button, and clicking the button lands on the real
//      public event page.
//   4. Send-time data: a campaign saved with a stale copy of the block (dated
//      1 January 2020) goes out with the event's current date instead.
//   5. A block for an event that doesn't exist (or isn't published) is never
//      sent; the send fails with the reason.
// The test campaigns and admin login are deleted at the end unless KEEP=1.
//
// Requires: node server/index.js on PORT (default 4242) serving a build of this
// code; PLAYWRIGHT_CORE=<path to playwright-core>.

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const serverBase = `http://localhost:${process.env.PORT || 4242}`
const SITE = (process.env.APP_URL || 'https://kingsarkdance.com').replace(/\/$/, '')
const EVENT_ID = 'its-time-to-rise-2026'
const EVENT_URL = `${SITE}/event/${EVENT_ID}`
const stamp = Date.now()
const tag = String(stamp).slice(-6)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const shot = (page, name) => (process.env.SCREENSHOT_DIR ? page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/promote-${name}.png`, fullPage: true }) : null)
const inbox = (key) => `delivered+kada-promote-${key}-${stamp}@resend.dev`

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures += 1
}
const cleanup = { users: [], campaigns: [] }

async function waitFor(fn, label, tries = 40) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const value = await fn()
    if (value) return value
    await sleep(1500)
  }
  throw new Error(`Timed out waiting for ${label}`)
}
const resendEmail = (id) => fetch(`https://api.resend.com/emails/${id}`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } }).then((response) => response.json())
const sendsFor = async (campaignId) => (await service.from('campaign_sends').select('*').eq('campaign_id', campaignId)).data || []

async function run() {
  const { data: event } = await service.from('events').select('*').eq('id', EVENT_ID).single()
  const longDate = new Date(`${event.event_date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' })
  console.log(`Event: ${event.title}, ${longDate}, ${event.location}\n`)

  const email = `promote-admin-${stamp}@example.com`
  const password = `Verify-${stamp}-admin!`
  const { data: created, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: 'admin', full_name: 'Promote Verify Admin' }, app_metadata: { signup_notified_at: new Date().toISOString() } })
  if (error) throw error
  cleanup.users.push(created.user.id)
  await service.from('profiles').update({ role: 'admin', full_name: 'Promote Verify Admin' }).eq('id', created.user.id)
  const session = (await createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password })).data.session
  const api = (path, body) => fetch(`${serverBase}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body || {}) }).then((response) => response.json())

  const { chromium } = await import(process.env.PLAYWRIGHT_CORE)
  const root = `${process.env.HOME}/.cache/ms-playwright`
  const dir = fs.readdirSync(root).find((name) => /^chromium-\d+$/.test(name))
  const browser = await chromium.launch({ executablePath: `${root}/${dir}/${fs.readdirSync(`${root}/${dir}`).find((name) => name.startsWith('chrome-linux'))}/chrome` })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
    await context.addInitScript(([name, value]) => window.localStorage.setItem(name, value), [`sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`, JSON.stringify(session)])
    const page = await context.newPage()
    page.on('dialog', (dialog) => dialog.accept())

    /* 1. Promote this event */
    await page.goto(`${serverBase}/#ops/events-published`)
    const row = page.locator('tr', { hasText: event.title })
    await row.waitFor({ timeout: 30000 })
    await row.getByRole('button', { name: /Promote this event/ }).click()
    await page.getByText(`Campaign started for "${event.title}"`).waitFor({ timeout: 20000 })
    check('Promote opens Campaigns (#ops/campaigns)', page.url().endsWith('#ops/campaigns'), page.url())
    const subject = page.locator('label', { hasText: 'Subject line' }).locator('input')
    check('Subject is the event title', await subject.inputValue() === event.title, await subject.inputValue())
    const block = page.locator('div', { hasText: /^Event/ }).filter({ has: page.locator('img') }).last()
    const blockHtml = await page.locator('#campaign-compose').innerHTML()
    check('Flyer image is the event flyer', blockHtml.includes(`/storage/v1/object/public/event-flyers/${event.flyer_path.split('/').map(encodeURIComponent).join('/')}`))
    check('Date and time shown', blockHtml.includes(`${longDate} · 6pm to 8:30pm`), longDate)
    check('Venue shown', blockHtml.includes(event.location))
    check('"Get tickets" button links to the real event page (/event/<id>, no #)', blockHtml.includes(`href="${EVENT_URL}" style="background:#c9a227`) && !blockHtml.includes('#event/'))
    await block.scrollIntoViewIfNeeded().catch(() => {})
    await shot(page, '1-prefilled')

    /* 2. Insert event below block 1 */
    const blocks = page.locator('#campaign-compose [style*="border-radius: 8px; padding: 12px"]')
    const before = await blocks.count()
    await blocks.nth(0).locator('input, textarea').first().click()
    await page.getByLabel('Event to insert').selectOption(EVENT_ID)
    await page.getByRole('button', { name: 'Insert below block 1' }).click()
    check('Insert event adds a block below block 1', await blocks.count() === before + 1 && (await blocks.nth(1).innerText()).startsWith('EVENT'), (await blocks.nth(1).innerText()).slice(0, 40))
    await shot(page, '2-inserted')
    await blocks.nth(1).getByTitle('Remove block').click()
    check('…and it can be removed again', await blocks.count() === before)

    /* 3. A real send to a one-off address */
    const name = page.locator('label', { hasText: 'Campaign name (internal)' }).locator('input')
    await name.fill(`Promote: ${event.title} (verify ${tag})`)
    await page.locator('label', { hasText: 'Audience' }).locator('select').selectOption('custom')
    await page.locator('textarea[placeholder*="oakridge"]').fill(inbox('ui'))
    await page.getByRole('button', { name: 'Send now' }).click()
    await page.getByText('Sending has started').waitFor({ timeout: 30000 })
    const { data: campaign } = await service.from('campaigns').select('*').ilike('name', `%(verify ${tag})%`).single()
    cleanup.campaigns.push(campaign.id)
    check('Campaign saved with the event block marker', campaign.body_html.includes(`<!--kada-event:${EVENT_ID}-->`))
    const [sent] = await waitFor(async () => { const rows = await sendsFor(campaign.id); return rows.length && rows.every((r) => r.status !== 'queued') ? rows : null }, 'the send')
    check('Resend accepted the email', sent.status === 'sent' && Boolean(sent.resend_id), sent.error || sent.status)
    const delivered = await resendEmail(sent.resend_id)
    const html = delivered.html || ''
    check('Sent email: subject is the event title', delivered.subject === event.title, delivered.subject)
    check('Sent email: flyer, date, venue', html.includes(`event-flyers/${event.flyer_path.split('/').map(encodeURIComponent).join('/')}`) && html.includes(longDate) && html.includes(event.location))
    const button = html.match(/<a href="([^"]+)" style="background:#c9a227[^"]*">Get tickets →<\/a>/)?.[1]?.replace(/&amp;/g, '&')
    check('Sent email: "Get tickets" button (click-tracked) points at the event page', Boolean(button) && decodeURIComponent(button.split('u=')[1] || '') === EVENT_URL, button)
    // An ordinary browser: the click tracker ignores HeadlessChrome as a link scanner.
    const reader = await browser.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' })
    await reader.goto(button, { waitUntil: 'domcontentloaded' })
    await reader.getByRole('heading', { name: event.title }).first().waitFor({ timeout: 30000 })
    check('Clicking the button lands on the real event page', reader.url().startsWith(EVENT_URL), reader.url())
    await shot(reader, '3-event-page')
    const clicked = await waitFor(async () => ((await sendsFor(campaign.id))[0]?.clicks > 0 ? true : null), 'the click to be counted', 10).catch(() => false)
    check('The click is counted in the campaign stats', clicked)

    /* 4. Stale copy in the saved HTML → current event data at send time */
    const staleBlock = `<!--kada-event:${EVENT_ID}--><div><h2>${event.title}</h2><p><strong>When:</strong> Wednesday, 1 January 2020 · 9am</p><p><strong>Where:</strong> Old Venue</p></div><!--/kada-event-->`
    const stale = await api('/api/admin/campaigns', { name: `Stale event block (verify ${tag})`, subject: `Stale block check ${tag}`, bodyHtml: `<div style="padding:28px 28px 8px"><p style="margin:0 0 14px;font-size:15px">Hi {{name}}</p>${staleBlock}</div>`, audience: 'custom', customEmails: [inbox('stale')], recurrence: 'none' })
    cleanup.campaigns.push(stale.campaign.id)
    await api(`/api/admin/campaigns/${stale.campaign.id}/send-now`)
    const [staleSend] = await waitFor(async () => { const rows = await sendsFor(stale.campaign.id); return rows.length && rows.every((r) => r.status !== 'queued') ? rows : null }, 'the stale-block send')
    const staleHtml = (await resendEmail(staleSend.resend_id)).html || ''
    check('Send time: the stale date/venue was replaced with the event\'s current ones', staleSend.status === 'sent' && staleHtml.includes(longDate) && staleHtml.includes(event.location) && !staleHtml.includes('1 January 2020') && !staleHtml.includes('Old Venue'))

    /* 5. An event that doesn't exist is never sent */
    const missingId = `verify-no-such-event-${tag}`
    const missing = await api('/api/admin/campaigns', { name: `Missing event (verify ${tag})`, subject: `Missing event check ${tag}`, bodyHtml: `<p>Hi</p><!--kada-event:${missingId}--><p>gone</p><!--/kada-event-->`, audience: 'custom', customEmails: [inbox('missing')], recurrence: 'none' })
    cleanup.campaigns.push(missing.campaign.id)
    await api(`/api/admin/campaigns/${missing.campaign.id}/send-now`)
    const [missingSend] = await waitFor(async () => { const rows = await sendsFor(missing.campaign.id); return rows.length && rows.every((r) => r.status !== 'queued') ? rows : null }, 'the missing-event send')
    check('Missing event: not sent, with the reason recorded', missingSend.status === 'failed' && !missingSend.resend_id && /deleted or no longer published/.test(missingSend.error || ''), missingSend.error)
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
    console.log(`\nKEEP=1: left campaigns ${cleanup.campaigns.join(', ')} and the admin login in place.`)
  } else {
    for (const id of cleanup.campaigns) await service.from('campaigns').delete().eq('id', id) // eslint-disable-line no-await-in-loop
    for (const id of cleanup.users) await service.auth.admin.deleteUser(id) // eslint-disable-line no-await-in-loop
    console.log('\nCleaned up the test campaigns and admin login. The event was not changed.')
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}
