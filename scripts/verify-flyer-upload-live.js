import 'dotenv/config'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

// Uploads real image files through the "+ Add event" form and checks what storage
// actually holds. FLYER_TEST_ROLE=staff signs in as a staff member holding only the
// 'events' permission (default: admin) and also checks that staff without it are
// refused. The event is never saved; the temporary users and every uploaded
// object are removed afterwards. Usage:
//   PLAYWRIGHT_MODULE=/abs/playwright-core/index.mjs FLYER_TEST_DIR=/abs/dir \
//   FLYER_TEST_SERVER_URL=https://kingsarkdance.com node scripts/verify-flyer-upload-live.js
// FLYER_TEST_DIR must hold huge-transparent.png (6000x3000, transparent top-left
// corner), phone-rotated.jpg (4000x3000 stored, EXIF orientation 6) and
// not-an-image.png (text). CHROMIUM_PATH optionally selects the browser binary.
assert.ok(process.env.PLAYWRIGHT_MODULE, 'Set PLAYWRIGHT_MODULE to Playwright index.mjs')
assert.ok(process.env.FLYER_TEST_DIR, 'Set FLYER_TEST_DIR to the folder of test images')
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const base = process.env.FLYER_TEST_SERVER_URL || 'http://localhost:4173'
const dir = process.env.FLYER_TEST_DIR
const checked = (result) => { if (result.error) throw new Error(result.error.message); return result.data }
const role = process.env.FLYER_TEST_ROLE || 'admin'
assert.ok(['admin', 'staff'].includes(role), 'FLYER_TEST_ROLE must be admin or staff')
const uploaded = []
const userIds = []
let browser
const signIn = async (label, profile) => {
  const email = `verify-flyer-${Date.now()}-${label}@example.com`
  const password = `${randomUUID()}Aa1!`
  const id = checked(await service.auth.admin.createUser({ email, password, email_confirm: true })).user.id
  userIds.push(id)
  checked(await service.from('profiles').upsert({ id, full_name: 'Flyer Upload Test', ...profile }))
  const client = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const session = checked(await client.auth.signInWithPassword({ email, password })).session
  return { client, session }
}
try {
  const { client: user, session } = await signIn(role, role === 'staff' ? { role: 'staff', permissions: ['events'] } : { role: 'admin' })
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--disable-dev-shm-usage'] })
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
  const authKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)), { key: authKey, value: session })
  await page.goto(`${base}/#ops/events-published`)
  await page.getByRole('button', { name: '+ Add event' }).first().click({ timeout: 30000 })
  const dialog = page.getByRole('dialog', { name: 'New event' })
  await dialog.waitFor()
  const fileInput = dialog.locator('input[type=file]')

  const upload = async (name) => {
    const before = await dialog.locator('img[alt="Event flyer preview"]').getAttribute('src').catch(() => null)
    await fileInput.setInputFiles(`${dir}/${name}`)
    const toast = page.getByText(/^(Flyer uploaded:|That image could not be read|Flyer could not be uploaded|new row violates)/).last()
    await toast.waitFor({ timeout: 60000 })
    const message = await toast.innerText()
    await page.waitForTimeout(500)
    const src = await dialog.locator('img[alt="Event flyer preview"]').getAttribute('src').catch(() => null)
    if (!src || src === before) return { message }
    const path = decodeURIComponent(src.split('/event-flyers/')[1])
    uploaded.push(path)
    const folder = path.split('/')[0]
    const object = checked(await service.storage.from('event-flyers').list(folder)).find((item) => `${folder}/${item.name}` === path)
    const image = await page.evaluate(async (url) => {
      const bitmap = await createImageBitmap(await (await fetch(url, { cache: 'no-store' })).blob())
      const canvas = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height })
      const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0)
      const pixel = (x, y) => [...context.getImageData(x, y, 1, 1).data.slice(0, 3)]
      return { width: bitmap.width, height: bitmap.height, topLeft: pixel(10, 10), rightMiddle: pixel(bitmap.width - 10, Math.round(bitmap.height / 2)), leftMiddle: pixel(10, Math.round(bitmap.height / 2)) }
    }, src)
    await toast.waitFor({ state: 'detached', timeout: 10000 }) // toasts clear after 2s
    return { message, path, mimetype: object?.metadata?.mimetype, size: object?.metadata?.size, cacheControl: object?.metadata?.cacheControl, ...image }
  }

  const big = await upload('huge-transparent.png')
  console.log('huge-transparent.png (6000x3000) ->', JSON.stringify(big))
  assert.ok(big.path, `upload refused: ${big.message}`)
  assert.equal(big.mimetype, 'image/jpeg')
  assert.match(big.path, /\.jpg$/)
  assert.deepEqual([big.width, big.height], [1600, 800])
  assert.ok(big.size < 1024 * 1024, 'stored flyer should be under 1 MB')
  assert.equal(big.cacheControl, 'max-age=31536000')
  assert.ok(big.topLeft.every((value) => value > 245), `transparent area should be white, got ${big.topLeft}`)
  console.log('PASS: huge transparent PNG stored as a 1600x800 JPEG with a white background')

  const phone = await upload('phone-rotated.jpg')
  console.log('phone-rotated.jpg (EXIF rotate 90) ->', JSON.stringify(phone))
  assert.equal(phone.mimetype, 'image/jpeg')
  assert.deepEqual([phone.width, phone.height], [1600, 2133])
  assert.ok(phone.rightMiddle[2] > 150 && phone.rightMiddle[0] < 80, `rotated blue band should be on the right, got ${phone.rightMiddle}`)
  console.log('PASS: phone photo stored upright (portrait) at 1600x2133')

  const bad = await upload('not-an-image.png')
  console.log('not-an-image.png ->', JSON.stringify(bad))
  assert.equal(bad.path, undefined)
  assert.match(bad.message, /could not be read/)
  console.log('PASS: non-image rejected with a clear message and nothing stored')

  // Direct API uploads: the bucket only takes JPEGs, and only from admins or
  // staff holding 'events'. Uses a placeholder event id so nothing is linked.
  const probeFolder = randomUUID()
  const jpeg = new Blob([await (await fetch(`${supabaseUrl}/storage/v1/object/public/event-flyers/${big.path}`)).arrayBuffer()], { type: 'image/jpeg' })
  const ownPath = `${probeFolder}/probe.jpg`
  checked(await user.storage.from('event-flyers').upload(ownPath, jpeg, { contentType: 'image/jpeg' }))
  uploaded.push(ownPath)
  checked(await user.storage.from('event-flyers').upload(ownPath, jpeg, { contentType: 'image/jpeg', upsert: true }))
  const pngAttempt = await user.storage.from('event-flyers').upload(`${probeFolder}/probe.png`, new Blob(['x'], { type: 'image/png' }), { contentType: 'image/png' })
  if (!pngAttempt.error) uploaded.push(`${probeFolder}/probe.png`)
  assert.ok(pngAttempt.error, 'the bucket must reject a PNG')
  console.log(`PASS: ${role} can upload and replace a JPEG directly; PNG rejected (${pngAttempt.error.message})`)
  const { client: outsider } = await signIn('no-events', { role: 'staff', permissions: ['bookings'] })
  const outsiderAttempt = await outsider.storage.from('event-flyers').upload(`${probeFolder}/outsider.jpg`, jpeg, { contentType: 'image/jpeg' })
  if (!outsiderAttempt.error) uploaded.push(`${probeFolder}/outsider.jpg`)
  assert.ok(outsiderAttempt.error, 'staff without the events permission must not upload flyers')
  const outsiderDelete = checked(await outsider.storage.from('event-flyers').remove([ownPath]))
  assert.equal(outsiderDelete.length, 0, 'staff without the events permission must not delete flyers')
  console.log(`PASS: staff without 'events' cannot upload (${outsiderAttempt.error.message}) or delete flyers`)
  const removed = checked(await user.storage.from('event-flyers').remove([ownPath]))
  assert.equal(removed.length, 1, `${role} should be able to delete a flyer`)
  uploaded.splice(uploaded.indexOf(ownPath), 1)
  console.log(`PASS: ${role} can delete a flyer`)

  const draftId = await dialog.locator('img[alt="Event flyer preview"]').getAttribute('src').then((src) => decodeURIComponent(src.split('/event-flyers/')[1]).split('/')[0])
  assert.equal(checked(await service.from('events').select('id').eq('id', draftId)).length, 0, 'the test event must not have been saved')
} finally {
  if (uploaded.length) checked(await service.storage.from('event-flyers').remove(uploaded))
  if (browser) await browser.close()
  for (const id of userIds) checked(await service.auth.admin.deleteUser(id))
}
