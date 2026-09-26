import 'dotenv/config'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

// End-to-end verification for homework against the LIVE Supabase project,
// Supabase Storage and Resend. Creates two parent logins (real families via the
// signup trigger) with children in the real Saturday class, a teacher with the
// homework permission and a staff member without it, then checks:
//   1. Only homework staff can list children, set tasks and upload images
//   2. (UI) the teacher sets a task in the app with an uploaded reference image
//      and a YouTube link, for chosen children (never the whole live class)
//   3. The notification email: delivered, one per family, with the title,
//      instructions, image and YouTube link; rendered and screenshotted
//   4. Parents see only their own children's tasks (RLS) and can only mark
//      their own children done, as themselves
//   5. (UI) a parent sees the task with the image and embedded video on a
//      phone, marks it done (and undoes/redoes it); the teacher's completion
//      list updates
//   6. An individual-child task reaches only that child's family
// Everything created is deleted at the end (pass --keep to leave it).
// Requires: node server/index.js running on PORT (default 4242) serving dist/,
// and HOMEWORK_UI=<path to playwright-core> for the UI steps.

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const appBase = `http://localhost:${process.env.PORT || 4242}`
const CLASS = 'Saturday Gospel Afrobeats'
// Two distinct inboxes: emails are grouped per address, so a shared inbox would get one combined email.
const INBOX = { parentA: 'delivered+homework-a@resend.dev', parentB: 'delivered+homework-b@resend.dev' }
const YOUTUBE = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
const YOUTUBE_ID = 'jNQXAC9IVRw'
const stamp = Date.now()
const TITLE = `Practise the chorus formation ${String(stamp).slice(-5)}`
const INSTRUCTIONS = 'Run the chorus routine three times with the music.\n\nFocus on the diamond formation in the photo: stay on your spot and keep your arms sharp on the "hey!".'
const keep = process.argv.includes('--keep')
const shotDir = process.env.SCREENSHOT_DIR || '.'

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures += 1
}

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())
const users = {}
const families = {}
const kids = {}
const bookingIds = []
const taskIds = new Set()

async function makeUser(key, role, permissions = []) {
  const email = `homework-verify-${key}-${stamp}@example.com`
  const password = `Verify-${stamp}-${Math.random().toString(36).slice(2)}`
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Verify ${key}`, role: role === 'parent' ? 'parent' : 'staff' } })
  if (error) throw new Error(`login ${key}: ${error.message}`)
  if (role !== 'parent') await service.from('profiles').update({ role, permissions, full_name: `Verify ${key}` }).eq('id', data.user.id)
  const client = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw new Error(`sign in ${key}: ${signInError.message}`)
  users[key] = { id: data.user.id, email, client, session: signIn.session }
}

async function addChild(key, familyKey, name) {
  const bookingId = `homework-verify-booking-${key}-${stamp}`
  bookingIds.push(bookingId)
  const family = families[familyKey]
  await service.from('bookings').insert({ id: bookingId, family_id: family.id, contact_name: family.guardian_name, contact_email: INBOX[familyKey], date: today, session_type: `${CLASS} (monthly_membership)`, price: 25, student_count: 1, status: 'Confirmed', invoice_status: 'Paid', payment_status: 'paid' })
  const kid = { id: `homework-verify-${key}-${stamp}`, name: `${name} Verify${String(stamp).slice(-4)}` }
  const { error } = await service.from('students').insert({ id: kid.id, booking_id: bookingId, family_id: family.id, parent_name: family.guardian_name, parent_email: INBOX[familyKey], name: kid.name, date_of_birth: '2016-09-01', class_name: CLASS, term: today, membership_status: 'active' })
  if (error) throw new Error(`child ${key}: ${error.message}`)
  kids[key] = kid
}

async function setup() {
  await makeUser('parentA', 'parent')
  await makeUser('parentB', 'parent')
  await makeUser('teacher', 'staff', ['homework'])
  await makeUser('outsider', 'staff', ['attendance', 'students'])
  for (const [key, name] of [['parentA', 'Grace Verify'], ['parentB', 'Kemi Verify']]) {
    const { data: family } = await service.from('parent_families').select('*').eq('owner_user_id', users[key].id).maybeSingle()
    if (!family) throw new Error(`signup trigger did not create a family for ${key}`)
    await service.from('parent_families').update({ guardian_name: name, guardian_email: INBOX[key], plan_type: 'monthly_membership', membership_status: 'active' }).eq('id', family.id)
    families[key] = { ...family, guardian_name: name }
  }
  await addChild('amara', 'parentA', 'Amara')
  await addChild('tobi', 'parentA', 'Tobi')
  await addChild('zara', 'parentB', 'Zara')
}

const api = (userKey, route, options = {}) => fetch(`${appBase}${route}`, { ...options, headers: { 'Content-Type': 'application/json', ...(userKey ? { Authorization: `Bearer ${users[userKey].session.access_token}` } : {}), ...(options.headers || {}) } })
const resendGet = (route) => fetch(`https://api.resend.com${route}`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } }).then((response) => response.json())
async function findEmail(subject) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const list = await resendGet('/emails?limit=20')
    const hits = (list.data || []).filter((email) => email.subject === subject)
    if (hits.length) {
      const email = await resendGet(`/emails/${hits[0].id}`)
      if (email.last_event && email.last_event !== 'queued') return { email, count: hits.length }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  return { email: null, count: 0 }
}

async function run() {
  // 1. Access.
  let response = await api('teacher', '/api/homework/children')
  const listing = await response.json()
  const classChildren = listing.classes?.find((item) => item.name === CLASS)?.children || []
  check('teacher lists the class with the test children as current', ['amara', 'tobi', 'zara'].every((key) => classChildren.some((child) => child.id === kids[key].id && child.current)))
  check('staff without the homework permission cannot list children', (await api('outsider', '/api/homework/children')).status === 403)
  check('anonymous requests are refused', (await api(null, '/api/homework/children')).status === 401)
  response = await api('outsider', '/api/homework', { method: 'POST', body: JSON.stringify({ title: 'Nope', studentIds: [kids.amara.id] }) })
  check('staff without the homework permission cannot set homework', response.status === 403)
  response = await api('teacher', '/api/homework', { method: 'POST', body: JSON.stringify({ title: 'Bad link', youtubeUrl: 'https://vimeo.com/123', studentIds: [kids.amara.id] }) })
  check('a non-YouTube link is rejected', response.status === 400)
  response = await api('teacher', '/api/homework', { method: 'POST', body: JSON.stringify({ title: 'Nobody', studentIds: [] }) })
  check('a task for nobody is rejected', response.status === 400)
  const outsiderUpload = await users.outsider.client.storage.from('homework-images').upload(`verify-${stamp}/x.png`, fs.readFileSync('public/badges/star.png'), { contentType: 'image/png' })
  check('staff without the permission cannot upload homework images', Boolean(outsiderUpload.error), outsiderUpload.error?.message)

  // 2. The teacher sets the task in the app.
  if (!process.env.HOMEWORK_UI) throw new Error('set HOMEWORK_UI to a playwright-core path for the UI steps')
  await teacherCreates()
  const { data: task } = await service.from('homework_tasks').select('*').eq('title', TITLE).maybeSingle()
  if (!task) throw new Error('the task was not saved')
  taskIds.add(task.id)
  check('task saved with instructions, image, YouTube id and class', task.description === INSTRUCTIONS && /^[\w-]+\/reference\.jpg$/.test(task.image_path || '') && task.youtube_id === YOUTUBE_ID && task.youtube_url === YOUTUBE && task.class_name === CLASS && task.created_by === users.teacher.id)
  const { data: assignments } = await service.from('homework_assignments').select('*').eq('task_id', task.id)
  check('assigned to exactly the three chosen children', (assignments || []).length === 3 && ['amara', 'tobi', 'zara'].every((key) => assignments.some((row) => row.student_id === kids[key].id)))
  check('every assignment records the family and that it was emailed', assignments.every((row) => row.guardian_name && row.emailed_at && !row.email_error))
  const imageUrl = `${supabaseUrl}/storage/v1/object/public/homework-images/${task.image_path}`
  const image = await fetch(imageUrl)
  check('the uploaded image is publicly served as a JPEG', image.status === 200 && /image\/jpeg/.test(image.headers.get('content-type') || ''), `HTTP ${image.status}`)

  // 3. The notification email.
  const { email, count } = await findEmail(`New practice for Amara and Tobi: ${TITLE}`)
  check('family A got one email naming both children', count === 1 && ['delivered', 'sent'].includes(email?.last_event), `${count} · ${email?.last_event}`)
  check('family B got its own email for Zara', (await findEmail(`New practice for Zara: ${TITLE}`)).count === 1)
  const html = email?.html || ''
  check('email has the title and instructions', html.includes(TITLE) && html.includes('Run the chorus routine three times') && html.includes('keep your arms sharp on the &quot;hey!&quot;'))
  check('email shows the reference image', html.includes(imageUrl))
  check('email has the YouTube thumbnail and Watch link', html.includes(`img.youtube.com/vi/${YOUTUBE_ID}/`) && html.includes(`youtube.com/watch?v=${YOUTUBE_ID}`) && html.includes('Watch on YouTube'))
  check('email links to the dashboard to mark it done', html.includes('#ops/homework') && html.includes('Hi Grace'))

  // 4. RLS.
  const aAssignments = (await users.parentA.client.from('homework_assignments').select('student_id').eq('task_id', task.id)).data || []
  check('parent A sees the task for their two children only', aAssignments.length === 2 && !aAssignments.some((row) => row.student_id === kids.zara.id))
  check('parent A can read the task itself', ((await users.parentA.client.from('homework_tasks').select('id').eq('id', task.id)).data || []).length === 1)
  const zaraMark = await users.parentA.client.from('homework_completions').insert({ task_id: task.id, student_id: kids.zara.id, marked_by: users.parentA.id })
  check('parent A cannot mark another family\'s child done', Boolean(zaraMark.error))
  const impersonate = await users.parentA.client.from('homework_completions').insert({ task_id: task.id, student_id: kids.amara.id, marked_by: users.parentB.id })
  check('a parent cannot record the mark as someone else', Boolean(impersonate.error))
  const parentTask = await users.parentA.client.from('homework_tasks').insert({ title: 'Parent task' })
  check('parents cannot create tasks', Boolean(parentTask.error))
  check('staff without the permission read no tasks', ((await users.outsider.client.from('homework_tasks').select('id')).data || []).length === 0)
  check('anonymous visitors read no tasks', ((await anon.from('homework_tasks').select('id')).data || []).length === 0)

  // 5. Parent marks it done in the app; the teacher sees it.
  await parentMarksDone(task)
  const { data: marks } = await service.from('homework_completions').select('*').eq('task_id', task.id)
  check('Amara marked done by parent A; Tobi and Zara not', marks?.length === 1 && marks[0].student_id === kids.amara.id && marks[0].marked_by === users.parentA.id)
  await teacherSeesCompletion()

  // 6. A task for one child only.
  response = await api('teacher', '/api/homework', { method: 'POST', body: JSON.stringify({ title: `Stretch routine ${stamp}`, description: 'Ten minutes of stretches.', studentIds: [kids.zara.id] }) })
  const single = await response.json()
  if (single.task?.id) taskIds.add(single.task.id)
  check('an individual task goes to one child and one family', response.status === 200 && single.assigned === 1 && single.familiesEmailed === 1)
  check('only that child\'s parent can see it', ((await users.parentB.client.from('homework_tasks').select('id').eq('id', single.task?.id)).data || []).length === 1 && ((await users.parentA.client.from('homework_tasks').select('id').eq('id', single.task?.id)).data || []).length === 0)
}

/* ----------------------------- browser ----------------------------- */

let browser
async function openAs(key, viewport) {
  const { chromium } = await import(process.env.HOMEWORK_UI)
  if (!browser) {
    const root = `${os.homedir()}/.cache/ms-playwright`
    const dir = fs.readdirSync(root).find((name) => /^chromium-\d+$/.test(name))
    const sub = fs.readdirSync(`${root}/${dir}`).find((name) => name.startsWith('chrome-linux'))
    browser = await chromium.launch({ executablePath: `${root}/${dir}/${sub}/chrome` })
  }
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 })
  if (key) {
    const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
    await context.addInitScript(([name, value]) => window.localStorage.setItem(name, value), [storageKey, JSON.stringify(users[key].session)])
  }
  const page = await context.newPage()
  page.on('dialog', (dialog) => dialog.accept())
  return page
}

// A formation diagram, rendered to a PNG file to upload like a real photo.
async function referenceImage() {
  const page = await openAs(null, { width: 800, height: 500 })
  const dots = [[400, 110], [290, 250], [510, 250], [400, 390]].map(([x, y], index) => `<circle cx="${x}" cy="${y}" r="34" fill="#c9a227"/><text x="${x}" y="${y + 8}" font-size="26" text-anchor="middle" fill="#0b3d2e" font-family="Arial" font-weight="700">${index + 1}</text>`).join('')
  await page.setContent(`<body style="margin:0"><svg width="800" height="500" style="background:#0b3d2e"><text x="30" y="52" font-size="30" fill="#fff6dc" font-family="Georgia">Chorus: diamond formation</text><path d="M400 110 L290 250 L400 390 L510 250 Z" fill="none" stroke="#fff6dc" stroke-width="3" stroke-dasharray="10 8"/>${dots}</svg></body>`)
  const file = path.join(os.tmpdir(), `homework-reference-${stamp}.png`)
  await page.locator('svg').screenshot({ path: file })
  await page.context().close()
  return file
}

async function teacherCreates() {
  const imageFile = await referenceImage()
  const page = await openAs('teacher', { width: 1280, height: 900 })
  await page.goto(`${appBase}/#ops/homework`)
  await page.getByRole('button', { name: 'Set homework' }).first().click()
  await page.getByLabel('Title').fill(TITLE)
  await page.getByLabel('Instructions').fill(INSTRUCTIONS)
  await page.getByLabel('Reference image').setInputFiles(imageFile)
  await page.getByAltText('Reference preview').waitFor()
  await page.getByLabel('YouTube link (optional)').fill(YOUTUBE)
  await page.getByAltText('Video preview').waitFor()
  await page.getByLabel('Class').selectOption(CLASS)
  // Never the whole live class: clear it and tick only the test children.
  await page.getByRole('button', { name: 'Clear' }).click()
  for (const key of ['amara', 'tobi', 'zara']) await page.getByLabel(kids[key].name).check()
  await page.screenshot({ path: `${shotDir}/homework-create.png`, fullPage: true })
  await page.getByRole('button', { name: /Set homework & email/ }).click()
  const notice = page.getByText(/Homework set for/)
  await notice.waitFor({ timeout: 30000 })
  check('teacher sees "set for 3 children; 2 families emailed"', (await notice.textContent()).includes('Homework set for 3 children; 2 families emailed.'), await notice.textContent())
  await page.getByText('0 of 3 done').waitFor()
  check('the new task opens with its completion list: 0 of 3 done', true)
  await page.context().close()
  fs.unlinkSync(imageFile)
}

async function parentMarksDone(task) {
  const page = await openAs('parentA', { width: 390, height: 844 })
  await page.goto(`${appBase}/#ops/homework`)
  const card = page.locator('article').filter({ hasText: TITLE })
  await card.waitFor({ timeout: 20000 })
  check('phone: parent sees the title and instructions', (await card.textContent()).includes('Focus on the diamond formation'))
  const img = card.getByAltText(`Reference for ${TITLE}`)
  await img.scrollIntoViewIfNeeded()
  await page.waitForFunction((alt) => { const el = document.querySelector(`img[alt="${alt}"]`); return el && el.complete && el.naturalWidth > 0 }, `Reference for ${TITLE}`, { timeout: 15000 })
  check('phone: the reference image is shown inline', true)
  const iframe = card.locator('iframe')
  check('phone: the YouTube video is embedded', (await iframe.getAttribute('src')) === `https://www.youtube-nocookie.com/embed/${YOUTUBE_ID}`)
  check('phone: there is also a plain Watch on YouTube link', (await card.getByRole('link', { name: '▶ Watch on YouTube' }).getAttribute('href')) === `https://www.youtube.com/watch?v=${YOUTUBE_ID}`)
  check('phone: one "Mark as done" button per child, and none for Zara', await card.getByRole('button', { name: 'Mark as done for Amara' }).count() === 1 && await card.getByRole('button', { name: 'Mark as done for Tobi' }).count() === 1 && !(await card.textContent()).includes('Zara'))
  const box = await card.getByRole('button', { name: 'Mark as done for Amara' }).boundingBox()
  check('phone: the button is a big tap target', box.height >= 48, `${Math.round(box.width)}x${Math.round(box.height)}`)
  check('phone: nothing spills past the screen', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.screenshot({ path: `${shotDir}/homework-parent-before.png`, fullPage: true })
  await card.getByRole('button', { name: 'Mark as done for Amara' }).click()
  await card.getByText('✓ Done for Amara').waitFor()
  await card.getByRole('button', { name: 'Undo' }).click()
  await card.getByRole('button', { name: 'Mark as done for Amara' }).waitFor()
  const { data: afterUndo } = await service.from('homework_completions').select('student_id').eq('task_id', task.id)
  check('Undo removes the mark', (afterUndo || []).length === 0)
  await card.getByRole('button', { name: 'Mark as done for Amara' }).click()
  await card.getByText('✓ Done for Amara').waitFor()
  check('phone: marked done for Amara; Tobi still to do', await card.getByRole('button', { name: 'Mark as done for Tobi' }).count() === 1)
  await page.screenshot({ path: `${shotDir}/homework-parent-after.png`, fullPage: true })
  await page.context().close()
}

async function teacherSeesCompletion() {
  const page = await openAs('teacher', { width: 1280, height: 900 })
  await page.goto(`${appBase}/#ops/homework`)
  const item = page.getByRole('button', { name: new RegExp(TITLE) })
  await item.waitFor({ timeout: 20000 })
  check('task list shows 1 of 3 done', (await item.textContent()).includes('1 of 3 done'))
  await item.click()
  const row = (key) => page.getByRole('row').filter({ hasText: kids[key].name })
  await row('amara').waitFor()
  check('completion list: Amara done, with her family', (await row('amara').textContent()).includes('Done') && (await row('amara').textContent()).includes('Grace Verify'))
  check('completion list: Tobi and Zara not yet', (await row('tobi').textContent()).includes('Not yet') && (await row('zara').textContent()).includes('Not yet') && (await row('zara').textContent()).includes('Kemi Verify'))
  await page.getByRole('tab', { name: 'Not yet (2)' }).click()
  check('"Not yet" filter lists the two families still to do', await page.getByRole('row').count() === 3)
  await page.getByRole('tab', { name: 'Everyone' }).click()
  await page.screenshot({ path: `${shotDir}/homework-staff-completion.png`, fullPage: true })
  await page.context().close()

  // The email as a parent sees it, rendered.
  const { email } = await findEmail(`New practice for Amara and Tobi: ${TITLE}`)
  const mail = await openAs(null, { width: 640, height: 900 })
  await mail.setContent(email.html, { waitUntil: 'load' })
  check('email renders with its image and video thumbnail loaded', await mail.evaluate(() => [...document.images].length === 2 && [...document.images].every((img) => img.complete && img.naturalWidth > 0)))
  await mail.screenshot({ path: `${shotDir}/homework-email.png`, fullPage: true })
  await mail.context().close()
  await browser.close()
}

try {
  await setup()
  await run()
} catch (error) {
  console.error('Verification aborted:', error.message)
  failures += 1
} finally {
  if (keep) console.log('\n--keep: test families, children and homework were left in place.')
  else {
    // Also catch tasks created before a failure stopped us recording their ids.
    const { data: byTitle } = await service.from('homework_tasks').select('id').in('title', [TITLE, `Stretch routine ${stamp}`])
    for (const row of byTitle || []) taskIds.add(row.id)
    if (taskIds.size) {
      const { data: tasks } = await service.from('homework_tasks').select('image_path').in('id', [...taskIds])
      const images = (tasks || []).map((task) => task.image_path).filter(Boolean)
      if (images.length) await service.storage.from('homework-images').remove(images)
      await service.from('homework_tasks').delete().in('id', [...taskIds])
    }
    await service.from('students').delete().in('id', Object.values(kids).map((kid) => kid.id))
    await service.from('bookings').delete().in('id', bookingIds)
    for (const user of Object.values(users)) await service.from('parent_families').delete().eq('owner_user_id', user.id)
  }
  for (const user of Object.values(users)) await service.auth.admin.deleteUser(user.id)
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
