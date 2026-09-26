import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

// End-to-end verification for awards against the LIVE Supabase project and
// Resend. Creates two parent logins (each gets a real family through the signup
// trigger), a child in each family plus a sibling, and staff logins, then checks:
//   1. Award types: seeded, readable when signed in, admin-only to change
//   2. Giving an award (API): snapshot of the award, only the attendance
//      permission may give one, archived types can't be given
//   3. Celebration email: Resend delivered it to the family's email with the
//      badge image, award name, note and child's name
//   4. Parents only ever see their own children's awards (RLS)
//   5. (With AWARDS_UI=<path to playwright-core>) a session leader gives an
//      award from the phone register; the parent's gallery shows it; the
//      email is rendered and screenshotted
// Everything created is deleted at the end (pass --keep to leave it).
//
// Requires: node server/index.js running on PORT (default 4242) serving dist/.

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const appBase = `http://localhost:${process.env.PORT || 4242}`
const CLASS = 'Saturday Gospel Afrobeats'
const RECIPIENT = 'delivered@resend.dev'
const stamp = Date.now()
const keep = process.argv.includes('--keep')
const shotDir = process.env.SCREENSHOT_DIR || '.'

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures += 1
}

const londonToday = () => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = (type) => parts.find((part) => part.type === type).value
  return `${get('year')}-${get('month')}-${get('day')}`
}
const today = londonToday()
const session = new Date(Date.parse(`${today}T00:00:00Z`) - ((new Date(`${today}T00:00:00Z`).getUTCDay() + 1) % 7) * 86400000).toISOString().slice(0, 10) // latest Saturday

const users = {}
const families = {}
const kids = {}
const bookingIds = []
const extraTypeIds = []

async function makeUser(key, role, permissions = []) {
  const email = `awards-verify-${key}-${stamp}@example.com`
  const password = `Verify-${stamp}-${Math.random().toString(36).slice(2)}`
  // Parents sign up as parents so the real trigger creates their family.
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Verify ${key}`, role: role === 'parent' ? 'parent' : 'staff' } })
  if (error) throw new Error(`login ${key}: ${error.message}`)
  if (role !== 'parent') await service.from('profiles').update({ role, permissions, full_name: `Verify ${key}` }).eq('id', data.user.id)
  const client = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw new Error(`sign in ${key}: ${signInError.message}`)
  users[key] = { id: data.user.id, email, client, session: signIn.session }
}

async function addChild(key, familyKey, name) {
  const bookingId = `awards-verify-booking-${key}-${stamp}`
  bookingIds.push(bookingId)
  const family = families[familyKey]
  await service.from('bookings').insert({ id: bookingId, family_id: family.id, contact_name: family.guardian_name, contact_email: family.guardian_email, date: session, session_type: `${CLASS} (monthly_membership)`, price: 25, student_count: 1, status: 'Confirmed', invoice_status: 'Paid', payment_status: 'paid' })
  const kid = { id: `awards-verify-${key}-${stamp}`, name: `${name} Verify${String(stamp).slice(-4)}` }
  const { error } = await service.from('students').insert({ id: kid.id, booking_id: bookingId, family_id: family.id, parent_name: family.guardian_name, parent_email: family.guardian_email, name: kid.name, date_of_birth: '2017-03-14', class_name: CLASS, term: session, membership_status: 'active' })
  if (error) throw new Error(`child ${key}: ${error.message}`)
  kids[key] = kid
}

async function setup() {
  await makeUser('parentA', 'parent')
  await makeUser('parentB', 'parent')
  await makeUser('leader', 'staff', ['attendance'])
  await makeUser('nopermission', 'staff', ['students', 'bookings'])
  for (const key of ['parentA', 'parentB']) {
    const { data: family } = await service.from('parent_families').select('*').eq('owner_user_id', users[key].id).maybeSingle()
    if (!family) throw new Error(`signup trigger did not create a family for ${key}`)
    // Resend's test inbox, so celebration emails really send (never to a made-up address).
    // Parent logins use other addresses, so family access here is by ownership alone.
    const guardianEmail = RECIPIENT
    await service.from('parent_families').update({ guardian_name: key === 'parentA' ? 'Grace Verify' : 'Other Parent', guardian_email: guardianEmail, plan_type: 'monthly_membership', membership_status: 'active' }).eq('id', family.id)
    families[key] = { ...family, guardian_name: key === 'parentA' ? 'Grace Verify' : 'Other Parent', guardian_email: guardianEmail }
  }
  await addChild('amara', 'parentA', 'Amara')
  await addChild('tobi', 'parentA', 'Tobi')
  await addChild('zara', 'parentB', 'Zara')
}

const giveAward = (userKey, body) => fetch(`${appBase}/api/awards`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(userKey ? { Authorization: `Bearer ${users[userKey].session.access_token}` } : {}) }, body: JSON.stringify(body) })
const resendEmail = async (id) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const email = await fetch(`https://api.resend.com/emails/${id}`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } }).then((response) => response.json())
    if (email.last_event && email.last_event !== 'queued') return email
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  return fetch(`https://api.resend.com/emails/${id}`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } }).then((response) => response.json())
}
// The most recent email to the test inbox with this subject whose body contains `bodyPart`.
const findEmail = async (subjectPart, bodyPart) => {
  const list = await fetch('https://api.resend.com/emails?limit=20', { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } }).then((response) => response.json())
  for (const hit of (list.data || []).filter((email) => email.to?.includes(RECIPIENT) && email.subject?.includes(subjectPart))) {
    const email = await resendEmail(hit.id)
    if (email.html?.includes(bodyPart)) return email
  }
  return null
}

async function run() {
  // 1. Award types.
  const { data: types } = await users.leader.client.from('award_types').select('*').eq('active', true).order('sort_order')
  const byName = Object.fromEntries((types || []).map((type) => [type.name, type]))
  check('four seeded award types, each with a badge', ['Star Mover', 'Great Teamwork', 'Most Improved', 'Perfect Attitude'].every((name) => byName[name]?.badge), (types || []).map((type) => `${type.name}:${type.badge}`).join(', '))
  check('parents can read award types', ((await users.parentA.client.from('award_types').select('id')).data || []).length >= 4)
  check('anonymous visitors cannot read award types', ((await anon.from('award_types').select('id')).data || []).length === 0)
  const leaderTypeInsert = await users.leader.client.from('award_types').insert({ name: 'Sneaky', badge: 'star' })
  check('non-admin staff cannot add award types', Boolean(leaderTypeInsert.error), leaderTypeInsert.error?.message)
  const leaderTypeUpdate = await users.leader.client.from('award_types').update({ name: 'Renamed' }).eq('id', byName['Star Mover'].id).select('id')
  check('non-admin staff cannot rename award types', (leaderTypeUpdate.data || []).length === 0)
  for (const badge of ['star', 'team', 'growth', 'sun', 'heart', 'music', 'crown', 'bolt']) {
    const png = await fetch(`${appBase}/badges/${badge}.png`)
    if (png.status !== 200 || !/image\/png/.test(png.headers.get('content-type') || '')) check(`badge ${badge}.png is served`, false, `HTTP ${png.status}`)
  }
  check('all 8 badge PNGs are served', true)

  // 2. Giving an award through the API.
  const note = 'Amazing energy today — you led the whole group through the new routine!'
  let response = await giveAward('leader', { studentId: kids.amara.id, awardTypeId: byName['Star Mover'].id, note, className: CLASS, sessionDate: session })
  let result = await response.json()
  check('session leader gives Amara "Star Mover"', response.status === 200 && result.award?.id, `HTTP ${response.status} ${result.error || ''}`)
  check('celebration email sent to the family', result.emailSent === true && result.emailTo === RECIPIENT, `${result.emailTo || ''} ${result.emailError || ''}`)
  const { data: stored } = await service.from('student_awards').select('*').eq('id', result.award?.id).maybeSingle()
  check('award stored with snapshot, note, session and giver', stored?.award_name === 'Star Mover' && stored?.badge === 'star' && stored?.student_name === kids.amara.name && stored?.note === note && stored?.session_date === session && stored?.class_name === CLASS && stored?.given_by === users.leader.id && Boolean(stored?.email_sent_at))

  response = await giveAward('nopermission', { studentId: kids.amara.id, awardTypeId: byName['Star Mover'].id })
  check('staff without the attendance permission cannot give awards', response.status === 403)
  response = await giveAward(null, { studentId: kids.amara.id, awardTypeId: byName['Star Mover'].id })
  check('anonymous requests cannot give awards', response.status === 401)
  const directInsert = await users.nopermission.client.from('student_awards').insert({ student_id: kids.amara.id, award_name: 'Fake', badge: 'star' })
  check('staff without the permission cannot write awards directly', Boolean(directInsert.error))
  const { data: archived } = await service.from('award_types').insert({ name: `Archived ${stamp}`, badge: 'bolt', active: false }).select('id').single()
  extraTypeIds.push(archived.id)
  response = await giveAward('leader', { studentId: kids.amara.id, awardTypeId: archived.id })
  check('an archived award type cannot be given', response.status === 400)
  response = await giveAward('leader', { studentId: kids.amara.id, awardTypeId: byName['Star Mover'].id, note: 'x'.repeat(400) })
  result = await response.json()
  check('notes are capped at 280 characters', result.award?.note?.length === 280)
  if (result.award?.id) await service.from('student_awards').delete().eq('id', result.award.id)

  // A different family's child gets an award too, for the privacy checks.
  response = await giveAward('leader', { studentId: kids.zara.id, awardTypeId: byName['Most Improved'].id, note: 'For Zara only', className: CLASS, sessionDate: session })
  check('award given to a child in another family', response.status === 200)

  // 3. The celebration email as Resend delivered it.
  const email = await findEmail(`${kids.amara.name.split(' ')[0]} earned Star Mover`, 'you led the whole group')
  check('Resend delivered the celebration email', ['delivered', 'sent'].includes(email?.last_event), email?.last_event || 'not found')
  check('subject names the child and award', email?.subject === `🏅 ${kids.amara.name.split(' ')[0]} earned Star Mover at KADA!`, email?.subject)
  const html = email?.html || ''
  check('email shows the Star Mover badge image', html.includes('/badges/star.png') && html.includes('alt="Star Mover badge"'))
  check('email carries the award name, description and note', html.includes('Star Mover') && html.includes('Brought energy, rhythm and joy') && html.includes('you led the whole group'))
  check('email greets the parent and names the child', html.includes('Hi Grace') && html.includes(`this one's for ${kids.amara.name.split(' ')[0]}`))
  check('email is signed by the staff member and links to the gallery', html.includes('Verify, KADA') && html.includes('#ops/awards'))

  // 4. Parents only see their own children's awards.
  const aAwards = (await users.parentA.client.from('student_awards').select('student_id,award_name')).data || []
  check('parent A sees their child\'s award', aAwards.some((award) => award.student_id === kids.amara.id && award.award_name === 'Star Mover'))
  check('parent A never sees another family\'s award', !aAwards.some((award) => award.student_id === kids.zara.id))
  const aPeek = (await users.parentA.client.from('student_awards').select('id').eq('student_id', kids.zara.id)).data || []
  check('parent A asking for the other child by id still gets nothing', aPeek.length === 0)
  const bAwards = (await users.parentB.client.from('student_awards').select('student_id')).data || []
  check('parent B sees only their own child\'s award', bAwards.length === 1 && bAwards[0].student_id === kids.zara.id, String(bAwards.length))
  const parentWrite = await users.parentA.client.from('student_awards').insert({ student_id: kids.amara.id, award_name: 'Self-awarded', badge: 'crown' })
  check('parents cannot give awards', Boolean(parentWrite.error))
  const parentDelete = await users.parentA.client.from('student_awards').delete().eq('student_id', kids.amara.id).select('id')
  check('parents cannot delete awards', (parentDelete.data || []).length === 0)
  check('anonymous visitors see no awards', ((await anon.from('student_awards').select('id').limit(5)).data || []).length === 0)

  if (process.env.AWARDS_UI) await ui(html)
  else console.log('SKIP  UI checks (set AWARDS_UI to a playwright-core path)')
}

/* ----------------------------- browser ----------------------------- */

let browser
async function openAs(key, viewport = { width: 390, height: 844 }) {
  const { chromium } = await import(process.env.AWARDS_UI)
  if (!browser) {
    const fs = await import('node:fs')
    const root = `${process.env.HOME}/.cache/ms-playwright`
    const dir = fs.readdirSync(root).find((name) => /^chromium-\d+$/.test(name))
    const sub = fs.readdirSync(`${root}/${dir}`).find((name) => name.startsWith('chrome-linux'))
    browser = await chromium.launch({ executablePath: `${root}/${dir}/${sub}/chrome` })
  }
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 })
  if (key) {
    const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
    await context.addInitScript(([name, value]) => window.localStorage.setItem(name, value), [storageKey, JSON.stringify(users[key].session)])
  }
  return context.newPage()
}

async function ui(emailHtml) {
  // Session leader, phone: give Tobi an award from the register.
  let page = await openAs('leader')
  await page.goto(`${appBase}/#ops/attendance`)
  await page.getByLabel('Session date').fill(session)
  const awardButton = page.getByRole('button', { name: `Give ${kids.tobi.name} an award` })
  await awardButton.waitFor({ timeout: 20000 })
  const box = await awardButton.boundingBox()
  check('phone: award button is a comfortable tap target', box.height >= 40, `${Math.round(box.width)}x${Math.round(box.height)}`)
  check('phone: the award Amara already got shows on her row', await page.getByRole('img', { name: 'Star Mover' }).count() >= 1)
  await awardButton.click()
  await page.getByRole('radio', { name: 'Great Teamwork' }).click()
  await page.getByLabel('Personal note (optional)').fill('Thank you for helping the younger dancers today!')
  await page.screenshot({ path: `${shotDir}/awards-sheet.png` })
  await page.getByRole('button', { name: /Give award & email/ }).click()
  await page.getByText(/Great Teamwork given to/).waitFor({ timeout: 20000 })
  const notice = await page.getByText(/Great Teamwork given to/).textContent()
  check('phone: giving the award confirms the parent was emailed', notice.includes(`Celebration email sent to ${RECIPIENT}`), notice)
  const { data: tobiAward } = await service.from('student_awards').select('*').eq('student_id', kids.tobi.id).maybeSingle()
  check('award from the phone saved for Tobi with the note', tobiAward?.award_name === 'Great Teamwork' && tobiAward?.note === 'Thank you for helping the younger dancers today!' && tobiAward?.session_date === session && Boolean(tobiAward?.email_sent_at))
  check('phone: no sideways scrolling on the register', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.context().close()

  // Parent A: the gallery, from the email's own link, on a phone and a laptop.
  for (const [label, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]]) {
    page = await openAs('parentA', viewport)
    await page.goto(`${appBase}/#ops/awards`)
    await page.getByText('Trophy shelf').waitFor({ timeout: 20000 })
    const cards = page.locator('ol > li')
    check(`${label}: gallery shows both of the family's awards`, await cards.count() === 2, String(await cards.count()))
    const text = (await page.locator('ol').textContent()).replace(/\s+/g, ' ')
    check(`${label}: cards show award, child, note and giver`, text.includes('Star Mover') && text.includes('Great Teamwork') && text.includes('you led the whole group') && text.includes('Verify, KADA') && text.includes('Amara') && text.includes('Tobi'))
    check(`${label}: the other family's award is not shown`, !(await page.content()).includes('For Zara only') && !text.includes('Most Improved'))
    check(`${label}: badge images load`, await page.evaluate(() => [...document.querySelectorAll('ol img')].every((img) => img.complete && img.naturalWidth > 0)))
    check(`${label}: nothing spills past the screen`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    await page.screenshot({ path: `${shotDir}/awards-gallery-${label}.png`, fullPage: true })
    await page.context().close()
  }
  page = await openAs('parentA', { width: 1280, height: 900 })
  await page.goto(`${appBase}/#ops/dashboard`)
  await page.getByText('Latest award').waitFor({ timeout: 20000 })
  check('dashboard home shows the latest award', (await page.getByText(/earned Great Teamwork/).count()) === 1)
  await page.context().close()

  // The celebration email, rendered (badge URL pointed at this server until deployed).
  page = await openAs(null, { width: 640, height: 900 })
  await page.setContent(emailHtml.replaceAll(/https?:\/\/[^"]*\/badges\//g, `${appBase}/badges/`), { waitUntil: 'load' })
  check('email renders with the badge image loaded', await page.evaluate(() => { const img = document.querySelector('img'); return Boolean(img && img.complete && img.naturalWidth > 0) }))
  await page.screenshot({ path: `${shotDir}/awards-email.png`, fullPage: true })
  await page.context().close()
  await browser.close()
}

try {
  await setup()
  await run()
} catch (error) {
  console.error('Verification aborted:', error.message)
  failures += 1
} finally {
  if (keep) console.log('\n--keep: test families, children and awards were left in place.')
  else {
    await service.from('students').delete().in('id', Object.values(kids).map((kid) => kid.id)) // cascades awards
    await service.from('bookings').delete().in('id', bookingIds)
    await service.from('parent_families').delete().in('id', Object.values(families).map((family) => family.id))
    if (extraTypeIds.length) await service.from('award_types').delete().in('id', extraTypeIds)
    // Families the signup trigger made that setup didn't reach.
    for (const user of Object.values(users)) await service.from('parent_families').delete().eq('owner_user_id', user.id)
  }
  for (const user of Object.values(users)) await service.auth.admin.deleteUser(user.id)
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
