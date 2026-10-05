import 'dotenv/config'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

// Uploads real image files through the admin "+ Add event" form and checks what
// storage actually holds. The event is never saved; the temporary admin and every
// uploaded object are removed afterwards. Usage:
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
const uploaded = []
let browser
let adminUserId
try {
  const adminEmail = `verify-flyer-${Date.now()}-admin@example.com`
  const adminPassword = `${randomUUID()}Aa1!`
  adminUserId = checked(await service.auth.admin.createUser({ email: adminEmail, password: adminPassword, email_confirm: true })).user.id
  checked(await service.from('profiles').upsert({ id: adminUserId, role: 'admin', full_name: 'Flyer Upload Test' }))
  const session = checked(await createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY).auth.signInWithPassword({ email: adminEmail, password: adminPassword })).session
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
    const toast = page.getByText(/^(Flyer uploaded:|That image could not be read)/).last()
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
  console.log('huge-transparent.png (26 MB, 6000x3000) ->', JSON.stringify(big))
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

  const draftId = await dialog.locator('img[alt="Event flyer preview"]').getAttribute('src').then((src) => decodeURIComponent(src.split('/event-flyers/')[1]).split('/')[0])
  assert.equal(checked(await service.from('events').select('id').eq('id', draftId)).length, 0, 'the test event must not have been saved')
} finally {
  if (uploaded.length) checked(await service.storage.from('event-flyers').remove(uploaded))
  if (browser) await browser.close()
  if (adminUserId) checked(await service.auth.admin.deleteUser(adminUserId))
}
