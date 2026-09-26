import 'dotenv/config'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

// End-to-end verification for the Formation Planner against the LIVE Supabase
// project. Creates a parent login whose children are in the real Saturday
// class, a staff member with the 'formations' permission, and one with every
// other area but not formations, then checks:
//   1. PHOTO PRIVACY: the bucket is private; a real uploaded photo can't be
//      reached by public URL, anonymously, by the child's own parent, or by
//      staff without the permission; signed URLs expire; no other code path
//      references the bucket; the parent dashboard never requests it
//   2. Data RLS: formations, positions and photo records are invisible and
//      unwritable to everyone but formations staff
//   3. (UI) upload a photo, create a formation, drag children onto the stage,
//      swap two, bench one, reload and confirm every position; rename,
//      duplicate, delete; delete the photo
//   4. (UI) staff without the permission never see Formations
// Everything created is deleted at the end (pass --keep to leave it).
// Requires: node server/index.js on PORT (default 4242) serving dist/, and
// FORMATIONS_UI=<path to playwright-core>.

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const appBase = `http://localhost:${process.env.PORT || 4242}`
const CLASS = 'Saturday Gospel Afrobeats'
const BUCKET = 'formation-photos'
const stamp = Date.now()
const keep = process.argv.includes('--keep')
const shotDir = process.env.SCREENSHOT_DIR || '.'
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures += 1
}

const users = {}
const kids = {}
const bookingIds = []
let familyId = ''

async function makeUser(key, role, permissions = []) {
  const email = `formations-verify-${key}-${stamp}@example.com`
  const password = `Verify-${stamp}-${Math.random().toString(36).slice(2)}`
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Verify ${key}`, role: role === 'parent' ? 'parent' : 'staff' } })
  if (error) throw new Error(`login ${key}: ${error.message}`)
  if (role !== 'parent') await service.from('profiles').update({ role, permissions, full_name: `Verify ${key}` }).eq('id', data.user.id)
  const client = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw new Error(`sign in ${key}: ${signInError.message}`)
  users[key] = { id: data.user.id, client, session: signIn.session }
}

async function setup() {
  await makeUser('parent', 'parent')
  await makeUser('planner', 'staff', ['formations'])
  // Every other area, so the only thing missing is formations.
  await makeUser('otherStaff', 'staff', ['bookings', 'contacts', 'schools', 'students', 'attendance', 'homework', 'events', 'messages', 'site', 'sales'])
  const { data: family } = await service.from('parent_families').select('id').eq('owner_user_id', users.parent.id).maybeSingle()
  if (!family) throw new Error('signup trigger did not create a family')
  familyId = family.id
  await service.from('parent_families').update({ guardian_name: 'Grace Verify', guardian_email: 'delivered@resend.dev', plan_type: 'monthly_membership', membership_status: 'active' }).eq('id', familyId)
  for (const [key, name] of [['amara', 'Amara'], ['tobi', 'Tobi'], ['zara', 'Zara']]) {
    const bookingId = `formations-verify-booking-${key}-${stamp}`
    bookingIds.push(bookingId)
    await service.from('bookings').insert({ id: bookingId, family_id: familyId, contact_name: 'Grace Verify', contact_email: 'delivered@resend.dev', date: today, session_type: `${CLASS} (monthly_membership)`, price: 25, student_count: 1, status: 'Confirmed', invoice_status: 'Paid', payment_status: 'paid' })
    kids[key] = { id: `formations-verify-${key}-${stamp}`, name: `${name} Verify${String(stamp).slice(-4)}` }
    // photo_consent deliberately false: the planner must not depend on it.
    const { error } = await service.from('students').insert({ id: kids[key].id, booking_id: bookingId, family_id: familyId, parent_name: 'Grace Verify', parent_email: 'delivered@resend.dev', name: kids[key].name, date_of_birth: '2016-02-02', class_name: CLASS, term: today, membership_status: 'active', photo_consent: false })
    if (error) throw new Error(`child ${key}: ${error.message}`)
  }
}

/* ----------------------------- browser ----------------------------- */

let browser
async function openAs(key, viewport = { width: 1280, height: 900 }) {
  const { chromium } = await import(process.env.FORMATIONS_UI)
  if (!browser) {
    const root = `${os.homedir()}/.cache/ms-playwright`
    const dir = fs.readdirSync(root).find((name) => /^chromium-\d+$/.test(name))
    const sub = fs.readdirSync(`${root}/${dir}`).find((name) => name.startsWith('chrome-linux'))
    browser = await chromium.launch({ executablePath: `${root}/${dir}/${sub}/chrome` })
  }
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 })
  if (key) {
    const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
    await context.addInitScript(([name, value]) => window.localStorage.setItem(name, value), [storageKey, JSON.stringify(users[key].session)])
  }
  const page = await context.newPage()
  page.on('dialog', (dialog) => dialog.accept())
  return page
}

// A stand-in portrait (not a real child) rendered to a JPEG file to upload.
async function portraitFile() {
  const page = await openAs(null, { width: 300, height: 300 })
  await page.setContent('<body style="margin:0"><svg width="300" height="300"><rect width="300" height="300" fill="#c9a227"/><circle cx="150" cy="118" r="62" fill="#6b3e26"/><rect x="70" y="190" width="160" height="110" rx="70" fill="#0b3d2e"/><text x="150" y="290" font-size="22" text-anchor="middle" fill="#fff6dc" font-family="Arial">TEST</text></svg></body>')
  const file = path.join(os.tmpdir(), `formation-portrait-${stamp}.jpg`)
  await page.locator('svg').screenshot({ path: file, type: 'jpeg' })
  await page.context().close()
  return file
}

const GRID_COLUMNS = 12
const GRID_ROWS = 8
const snap = (value, steps) => Math.round(value * steps - 0.5) / steps + 0.5 / steps
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.002

async function positionsInDb(formationId) {
  const { data } = await service.from('formation_positions').select('student_id,x,y').eq('formation_id', formationId)
  return Object.fromEntries((data || []).map((row) => [row.student_id, { x: Number(row.x), y: Number(row.y) }]))
}

async function dragTo(page, kid, fx, fy) {
  const token = page.locator(`[data-student="${kid.id}"]`)
  await token.scrollIntoViewIfNeeded()
  const from = await token.boundingBox()
  const stage = await page.getByTestId('stage').boundingBox()
  await page.mouse.move(from.x + from.width / 2, from.y + 20)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 15, from.y + 30, { steps: 3 })
  await page.mouse.move(stage.x + stage.width * fx, stage.y + stage.height * fy, { steps: 8 })
  await page.mouse.up()
}

// Where the token's photo circle is centred, as fractions of the stage.
async function tokenOnStage(page, kid) {
  const stage = await page.getByTestId('stage').boundingBox()
  const box = await page.getByTestId('stage').locator(`[data-student="${kid.id}"]`).boundingBox()
  if (!box) return null
  return { x: (box.x + box.width / 2 - stage.x) / stage.width, y: (box.y + box.height / 2 - stage.y) / stage.height }
}

async function waitForDb(formationId, predicate) {
  for (let i = 0; i < 25; i += 1) {
    const positions = await positionsInDb(formationId)
    if (predicate(positions)) return positions
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return positionsInDb(formationId)
}

async function run() {
  if (!process.env.FORMATIONS_UI) throw new Error('set FORMATIONS_UI to a playwright-core path')
  const { data: bucket } = await service.storage.getBucket(BUCKET)
  check('formation-photos bucket exists and is PRIVATE (public = false)', bucket?.public === false, JSON.stringify({ public: bucket?.public }))
  const { data: buckets } = await service.storage.listBuckets()
  check('its bucket is separate from the public ones', !['event-flyers', 'homework-images'].includes(BUCKET) && (buckets || []).filter((item) => item.public).every((item) => item.id !== BUCKET))

  // 3. The planner, in the app.
  let page = await openAs('planner')
  await page.goto(`${appBase}/#ops/formations`)
  await page.getByLabel('Class').waitFor({ timeout: 20000 })
  await page.getByLabel('Class').selectOption(CLASS)
  await page.getByRole('button', { name: /Children's photos/ }).click()
  const portrait = await portraitFile()
  await page.getByLabel(`Photo for ${kids.amara.name}`).setInputFiles(portrait)
  await page.getByAltText(`${kids.amara.name} planning photo`).waitFor({ timeout: 20000 })
  fs.unlinkSync(portrait)
  const { data: photoRow } = await service.from('formation_student_photos').select('*').eq('student_id', kids.amara.id).maybeSingle()
  check('photo uploaded to the private bucket under the child\'s folder', new RegExp(`^${kids.amara.id}/[\\w-]+\\.jpg$`).test(photoRow?.storage_path || '') && photoRow?.uploaded_by === users.planner.id, photoRow?.storage_path)
  const shownSrc = await page.getByAltText(`${kids.amara.name} planning photo`).getAttribute('src')
  check('the app shows it through a signed URL, not a public one', shownSrc.includes(`/storage/v1/object/sign/${BUCKET}/`) && !shownSrc.includes('/object/public/'))
  await photoPrivacyChecks(photoRow.storage_path)
  await page.getByRole('button', { name: 'Hide photos' }).click()

  await page.getByRole('button', { name: '+ New formation' }).first().click()
  await page.getByLabel('Formation name').fill('Chorus')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByRole('tab', { name: 'Chorus' }).waitFor()
  const { data: chorus } = await service.from('formations').select('*').eq('class_name', CLASS).eq('name', 'Chorus').eq('created_by', users.planner.id).maybeSingle()
  check('formation "Chorus" created for the class', Boolean(chorus))
  check('everyone starts off stage', (await page.getByTestId('bench').locator('[data-student]').count()) >= 3 && (await page.getByTestId('stage').locator('[data-student]').count()) === 0)
  check('Amara\'s token on the bench shows her photo', ((await page.getByTestId('bench').locator(`[data-student="${kids.amara.id}"] img`).getAttribute('src')) || '').includes(`/object/sign/${BUCKET}/`))

  const target = { amara: [0.25, 0.3], tobi: [0.75, 0.3], zara: [0.5, 0.7] }
  for (const [key, [fx, fy]] of Object.entries(target)) await dragTo(page, kids[key], fx, fy)
  const expected = Object.fromEntries(Object.entries(target).map(([key, [fx, fy]]) => [kids[key].id, { x: snap(fx, GRID_COLUMNS), y: snap(fy, GRID_ROWS) }]))
  let saved = await waitForDb(chorus.id, (positions) => Object.keys(positions).length === 3)
  check('drag-and-drop saves all three positions (snapped to the grid)', Object.entries(expected).every(([id, pos]) => saved[id] && near(saved[id].x, pos.x) && near(saved[id].y, pos.y)), JSON.stringify(saved))
  await page.screenshot({ path: `${shotDir}/formations-placed.png`, fullPage: true })

  // Swap Amara and Zara with two taps.
  await page.getByRole('button', { name: /⇄ Swap/ }).click()
  await page.locator(`[data-student="${kids.amara.id}"]`).click()
  await page.locator(`[data-student="${kids.zara.id}"]`).click()
  saved = await waitForDb(chorus.id, (positions) => positions[kids.amara.id] && near(positions[kids.amara.id].y, expected[kids.zara.id].y))
  check('two taps swap Amara and Zara', near(saved[kids.amara.id].x, expected[kids.zara.id].x) && near(saved[kids.amara.id].y, expected[kids.zara.id].y) && near(saved[kids.zara.id].x, expected[kids.amara.id].x) && near(saved[kids.zara.id].y, expected[kids.amara.id].y) && near(saved[kids.tobi.id].x, expected[kids.tobi.id].x))
  await page.getByRole('button', { name: /⇄ Swap/ }).click()

  // Free drag of one already on stage, then bench another.
  await dragTo(page, kids.tobi, 0.6, 0.55)
  await page.locator(`[data-student="${kids.zara.id}"]`).scrollIntoViewIfNeeded()
  const bench = await page.getByTestId('bench').boundingBox()
  const zaraBox = await page.locator(`[data-student="${kids.zara.id}"]`).boundingBox()
  await page.mouse.move(zaraBox.x + 32, zaraBox.y + 20)
  await page.mouse.down()
  await page.mouse.move(zaraBox.x + 50, zaraBox.y + 40, { steps: 3 })
  await page.mouse.move(bench.x + bench.width - 40, bench.y + bench.height / 2, { steps: 8 })
  await page.mouse.up()
  saved = await waitForDb(chorus.id, (positions) => !positions[kids.zara.id] && positions[kids.tobi.id] && near(positions[kids.tobi.id].x, snap(0.6, GRID_COLUMNS)))
  check('dragging an on-stage child moves them', near(saved[kids.tobi.id]?.x, snap(0.6, GRID_COLUMNS)) && near(saved[kids.tobi.id]?.y, snap(0.55, GRID_ROWS)))
  check('dragging to the bench takes a child off stage', !saved[kids.zara.id])

  // Reload: the layout comes back exactly as saved.
  await page.reload()
  await page.getByLabel('Class').waitFor()
  await page.getByLabel('Class').selectOption(CLASS)
  await page.getByRole('tab', { name: 'Chorus' }).click()
  await page.getByTestId('stage').locator(`[data-student="${kids.amara.id}"]`).waitFor()
  const amaraBack = await tokenOnStage(page, kids.amara)
  const tobiBack = await tokenOnStage(page, kids.tobi)
  // Token = 46px circle + name, centred on the point, so compare x exactly and y loosely.
  check('after reload Amara is where the swap put her', Math.abs(amaraBack.x - expected[kids.zara.id].x) < 0.01 && Math.abs(amaraBack.y - expected[kids.zara.id].y) < 0.06, JSON.stringify(amaraBack))
  check('after reload Tobi is where he was dragged', Math.abs(tobiBack.x - snap(0.6, GRID_COLUMNS)) < 0.01 && Math.abs(tobiBack.y - snap(0.55, GRID_ROWS)) < 0.06, JSON.stringify(tobiBack))
  check('after reload Zara is on the bench', await page.getByTestId('bench').locator(`[data-student="${kids.zara.id}"]`).count() === 1)
  await page.screenshot({ path: `${shotDir}/formations-reloaded.png`, fullPage: true })

  // Rename, duplicate, a second independent formation, delete.
  await page.getByRole('button', { name: 'Rename' }).click()
  await page.getByLabel('Formation name').fill('Chorus 1')
  await page.getByRole('button', { name: 'Rename', exact: true }).click()
  await page.getByRole('tab', { name: 'Chorus 1', exact: true }).waitFor()
  check('formation renamed', (await service.from('formations').select('name').eq('id', chorus.id).single()).data.name === 'Chorus 1')
  await page.getByRole('button', { name: 'Duplicate' }).click()
  await page.getByRole('button', { name: 'Create copy' }).click()
  await page.getByRole('tab', { name: 'Chorus 1 (copy)' }).waitFor()
  const { data: copy } = await service.from('formations').select('id').eq('class_name', CLASS).eq('name', 'Chorus 1 (copy)').maybeSingle()
  const copied = await positionsInDb(copy.id)
  const original = await positionsInDb(chorus.id)
  check('duplicate copies the layout', Object.keys(copied).length === 2 && Object.entries(original).every(([id, pos]) => near(copied[id]?.x, pos.x) && near(copied[id]?.y, pos.y)))
  await dragTo(page, kids.amara, 0.1, 0.1)
  await waitForDb(copy.id, (positions) => near(positions[kids.amara.id]?.x, snap(0.1, GRID_COLUMNS)))
  check('editing the copy leaves the original alone', near((await positionsInDb(chorus.id))[kids.amara.id].x, expected[kids.zara.id].x))
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('tab', { name: 'Chorus 1 (copy)' }).waitFor({ state: 'detached' })
  check('formation deleted with its positions', !(await service.from('formations').select('id').eq('id', copy.id).maybeSingle()).data && Object.keys(await positionsInDb(copy.id)).length === 0)

  await dataPrivacyChecks(chorus.id)

  // Delete the photo.
  await page.getByRole('button', { name: /Children's photos/ }).click()
  await page.getByRole('listitem').filter({ hasText: kids.amara.name }).getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('listitem').filter({ hasText: kids.amara.name }).getByText('Upload').waitFor()
  const { data: gone } = await service.storage.from(BUCKET).list(kids.amara.id)
  check('deleting the photo removes the file and its record', (gone || []).length === 0 && !(await service.from('formation_student_photos').select('student_id').eq('student_id', kids.amara.id).maybeSingle()).data)
  await page.context().close()

  // 4. Staff without the permission, in the app.
  page = await openAs('otherStaff')
  await page.goto(`${appBase}/#ops/formations`)
  await page.getByText('Team dashboard').waitFor({ timeout: 20000 })
  await page.waitForTimeout(1500)
  const html = await page.content()
  check('staff without the permission: no Formations in the menu', !/>Formations</.test(html))
  check('staff without the permission: #ops/formations shows nothing', await page.getByTestId('stage').count() === 0 && !html.includes('New formation'))
  await page.context().close()
  await browser.close()
}

async function photoPrivacyChecks(photoPath) {
  const publicUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${photoPath}`
  const publicFetch = await fetch(publicUrl)
  check('public URL for the photo does not serve it', publicFetch.status !== 200 && !/image\//.test(publicFetch.headers.get('content-type') || ''), `HTTP ${publicFetch.status}`)
  const plainFetch = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${photoPath}`)
  check('unauthenticated object URL does not serve it', plainFetch.status !== 200, `HTTP ${plainFetch.status}`)

  const staffSigned = await users.planner.client.storage.from(BUCKET).createSignedUrl(photoPath, 60)
  const staffFetch = staffSigned.data ? await fetch(staffSigned.data.signedUrl) : null
  check('formations staff can open it via a signed URL', staffFetch?.status === 200 && /image\/jpeg/.test(staffFetch.headers.get('content-type') || ''))

  for (const [label, client] of [['anonymous visitor', anon], ['the child\'s own parent', users.parent.client], ['staff with every other permission', users.otherStaff.client]]) {
    const download = await client.storage.from(BUCKET).download(photoPath)
    const signed = await client.storage.from(BUCKET).createSignedUrl(photoPath, 60)
    const listing = await client.storage.from(BUCKET).list(photoPath.split('/')[0])
    const record = await client.from('formation_student_photos').select('storage_path')
    check(`${label}: cannot download, sign, list or look up the photo`, Boolean(download.error) && Boolean(signed.error) && (listing.data || []).length === 0 && (record.data || []).length === 0, [download.error?.message, signed.error?.message].filter(Boolean).join(' / '))
    const upload = await client.storage.from(BUCKET).upload(`${photoPath.split('/')[0]}/intruder-${stamp}.jpg`, fs.readFileSync('public/badges/star.png'), { contentType: 'image/png' })
    check(`${label}: cannot upload into the bucket`, Boolean(upload.error))
    const remove = await client.storage.from(BUCKET).remove([photoPath])
    const stillThere = (await service.storage.from(BUCKET).list(photoPath.split('/')[0])).data || []
    check(`${label}: cannot delete the photo`, (remove.data || []).length === 0 && stillThere.length === 1)
  }

  const shortLived = await users.planner.client.storage.from(BUCKET).createSignedUrl(photoPath, 1)
  await new Promise((resolve) => setTimeout(resolve, 2500))
  const expired = await fetch(shortLived.data.signedUrl)
  check('signed URLs stop working once they expire', expired.status !== 200, `HTTP ${expired.status}`)

  // Nothing but the planner page references the bucket or the photo table.
  const offenders = []
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.(jsx?|html)$/.test(entry.name) && /formation-photos|formation_student_photos/.test(fs.readFileSync(full, 'utf8'))) offenders.push(full)
  })
  walk('src')
  walk('server')
  check('only the Formations page references the photo bucket (no parent, public or email path)', offenders.length === 1 && offenders[0] === path.join('src', 'ops', 'FormationsPage.jsx'), offenders.join(', '))

  // The child's parent, in the real parent dashboard: never requests the bucket.
  const page = await openAs('parent', { width: 1280, height: 900 })
  const requests = []
  page.on('request', (request) => requests.push(request.url()))
  for (const tab of ['dashboard', 'children', 'awards', 'homework']) {
    await page.goto(`${appBase}/#ops/${tab}`)
    await page.getByText('Parent dashboard').first().waitFor({ timeout: 20000 })
    await page.waitForTimeout(800)
  }
  check('parent dashboard makes no request to the photo bucket or formation tables', !requests.some((url) => /formation/.test(url)), requests.filter((url) => /formation/.test(url)).join(' '))
  check('parent dashboard HTML never contains the photo path', !(await page.content()).includes(photoPath.split('/')[1]))
  await page.context().close()
}

async function dataPrivacyChecks(formationId) {
  for (const [label, client] of [['anonymous visitor', anon], ['the child\'s own parent', users.parent.client], ['staff with every other permission', users.otherStaff.client]]) {
    const formations = await client.from('formations').select('id')
    const positions = await client.from('formation_positions').select('student_id')
    const roster = await client.rpc('formation_class_students', { p_class: CLASS })
    check(`${label}: reads no formations, positions or roster`, (formations.data || []).length === 0 && (positions.data || []).length === 0 && (roster.error || (roster.data || []).length === 0))
    const insert = await client.from('formations').insert({ class_name: CLASS, name: `Intruder ${stamp}` })
    const move = await client.from('formation_positions').update({ x: 0.5 }).eq('formation_id', formationId).select('student_id')
    check(`${label}: cannot create formations or move anyone`, Boolean(insert.error) && (move.data || []).length === 0)
  }
}

try {
  await setup()
  await run()
} catch (error) {
  console.error('Verification aborted:', error.message)
  failures += 1
} finally {
  if (keep) console.log('\n--keep: test data left in place.')
  else {
    const ids = Object.values(kids).map((kid) => kid.id)
    for (const id of ids) {
      const { data: files } = await service.storage.from(BUCKET).list(id)
      if (files?.length) await service.storage.from(BUCKET).remove(files.map((file) => `${id}/${file.name}`))
    }
    await service.from('formations').delete().eq('class_name', CLASS).eq('created_by', users.planner?.id || '00000000-0000-0000-0000-000000000000')
    await service.from('students').delete().in('id', ids)
    await service.from('bookings').delete().in('id', bookingIds)
    if (familyId) await service.from('parent_families').delete().eq('id', familyId)
    for (const user of Object.values(users)) await service.from('parent_families').delete().eq('owner_user_id', user.id)
  }
  for (const user of Object.values(users)) await service.auth.admin.deleteUser(user.id)
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
