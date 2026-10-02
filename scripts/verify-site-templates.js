import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

// Homepage content-block templates, against the LIVE Supabase project, through
// the real admin UI and the homepage as a signed-out visitor:
//   1. Admin (temporary account) adds four blocks in Site > Homepage layout, one
//      per template, picking the style from the thumbnail picker:
//        a class  → Image + text (mirrored)    an event → Full-width banner (linked event)
//        a class  → Card grid (3 cards)        an event → Simple list (3 items)
//   2. The homepage renders each with its template, in a visibly different
//      layout (two columns / full width / cards in a row / numbered list), and
//      still fits a phone screen with no sideways scrolling
//   3. A block's "Book a class" button opens the booking form
//   4. A built-in section (Saturday Classes) can take a template and go back to
//      its original design
//   5. Deleting the blocks from Homepage layout removes them from the homepage
// Everything is removed at the end unless KEEP=1.
//
// Requires: node server/index.js on PORT (default 4242) serving a build of this
// code, PLAYWRIGHT_CORE + CHROMIUM_PATH. SCREENSHOT_DIR for screenshots.

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const serverBase = `http://localhost:${process.env.PORT || 4242}`
const stamp = Date.now()
const tag = String(stamp).slice(-5)
const shot = (target, name) => (process.env.SCREENSHOT_DIR ? target.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png` }) : null)

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures += 1
}

const BLOCKS = [
  { kind: 'Class', template: 'Image + text', key: 'split', mirror: true, title: `Junior Afrobeats ${tag}`, eyebrow: 'New class', body: 'A Saturday class for ages 5 to 8.\n\nFirst steps in Gospel Afrobeats, with games, rhythm and plenty of joy.', cta: 'book_class', ctaLabel: 'Book a class' },
  { kind: 'Event', template: 'Full-width banner', key: 'banner', title: `Showcase Night ${tag}`, eyebrow: 'Coming up', body: 'Our students take the stage for an evening of Gospel Afrobeats.', linkEvent: true },
  { kind: 'Class', template: 'Card grid', key: 'cards', title: `Classes by age ${tag}`, eyebrow: 'Saturday classes', body: 'Three groups, one family.', items: [['Minis', 'Ages 5 to 7'], ['Juniors', 'Ages 8 to 11'], ['Seniors', 'Ages 12 to 15']] },
  { kind: 'Event', template: 'Simple list', key: 'list', title: `Term dates ${tag}`, eyebrow: "What's on", body: 'Key dates for the autumn term.', items: [['Open day', 'Saturday 7 November'], ['Mid-term showcase', 'Saturday 28 November'], ['Christmas party', 'Saturday 19 December']] },
]

async function signIn(page, email, password) {
  await page.goto(`${serverBase}/`)
  await page.getByRole('button', { name: 'Sign in' }).first().click()
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.locator('form button[type=submit]').click()
  await page.getByRole('heading', { name: 'Operations dashboard' }).first().waitFor({ timeout: 30000 })
}

const created = []
let userId = ''

async function run() {
  const { chromium } = await import(process.env.PLAYWRIGHT_CORE)
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
  try {
    const email = `site-templates-${stamp}@example.com`
    const password = `Verify-${stamp}-site!`
    const { data: user, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: 'staff' }, app_metadata: { signup_notified_at: new Date().toISOString() } })
    if (error) throw error
    userId = user.user.id
    await service.from('profiles').update({ role: 'admin', full_name: 'Site Templates Verify' }).eq('id', userId)
    const { data: publishedEvent } = await service.from('events').select('id,title').eq('status', 'published').order('event_date').limit(1).maybeSingle()

    /* 1. Create one block per template through the admin UI. */
    const admin = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
    admin.on('dialog', (dialog) => dialog.accept())
    await signIn(admin, email, password)
    await admin.goto(`${serverBase}/?r=1#ops/site-layout`)
    await admin.getByRole('heading', { name: 'Homepage layout' }).waitFor({ timeout: 30000 })
    for (const spec of BLOCKS) {
      await admin.getByRole('button', { name: '+ Add content block' }).click()
      const editor = admin.getByRole('dialog', { name: 'Add content block' })
      await editor.getByRole('radio', { name: spec.kind, exact: true }).click()
      await editor.getByRole('radio', { name: spec.template, exact: true }).click()
      if (spec.mirror) await editor.getByLabel('Mirror (image on the right)').check()
      await editor.getByLabel('Small heading (optional)', { exact: true }).fill(spec.eyebrow)
      await editor.getByLabel('Title', { exact: true }).fill(spec.title)
      await editor.getByRole('textbox', { name: /^Text Leave/ }).fill(spec.body)
      if (spec.linkEvent && publishedEvent) await editor.getByRole('combobox', { name: /^Linked event/ }).selectOption(publishedEvent.id)
      if (spec.cta) { await editor.getByRole('combobox', { name: /^Button/ }).selectOption(spec.cta); await editor.getByLabel('Button text', { exact: true }).fill(spec.ctaLabel) }
      for (const [index, [title, body]] of (spec.items || []).entries()) {
        await editor.getByRole('button', { name: /^\+ Add (card|item)$/ }).click()
        await editor.getByLabel(`Item ${index + 1} title`, { exact: true }).fill(title)
        await editor.getByLabel(`Item ${index + 1} text`, { exact: true }).fill(body)
      }
      await editor.locator(`[data-template="${spec.key}"]`).waitFor()
      await shot(editor, `editor-${spec.key}`)
      await editor.getByRole('button', { name: 'Add to homepage' }).click()
      await editor.waitFor({ state: 'detached', timeout: 20000 })
      const { data: row } = await service.from('site_blocks').select('*').eq('title', spec.title).single()
      created.push(row.id)
      const { data: section } = await service.from('site_sections').select('visible').eq('section_key', `block:${row.id}`).single()
      check(`${spec.kind} block "${spec.title}" saved as ${spec.template}`, row.template === spec.key && row.kind === spec.kind.toLowerCase() && Boolean(row.mirror) === Boolean(spec.mirror) && (row.items || []).length === (spec.items || []).length && section?.visible === true && (!spec.linkEvent || !publishedEvent || row.event_id === publishedEvent.id), `${row.kind}/${row.template}${row.mirror ? ', mirrored' : ''}${row.event_id ? `, event ${publishedEvent?.title}` : ''}`)
    }
    await shot(admin, 'layout-with-blocks')

    /* 2. The homepage, as a visitor. */
    const visitor = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await visitor.goto(`${serverBase}/?v=${stamp}`)
    for (const [index, spec] of BLOCKS.entries()) {
      const section = visitor.locator(`#block-${created[index]}`)
      await section.waitFor({ timeout: 30000 })
      await section.scrollIntoViewIfNeeded()
      const info = await section.evaluate((element) => {
        const box = element.getBoundingClientRect()
        const grid = element.querySelector('.tpl-split-grid')
        const media = element.querySelector('.tpl-split-media')?.getBoundingClientRect()
        const copy = element.querySelector('.tpl-split-copy')?.getBoundingClientRect()
        const cards = [...element.querySelectorAll('.tpl-card')].map((card) => card.getBoundingClientRect())
        return {
          template: element.dataset.template, text: element.innerText, width: box.width, viewport: window.innerWidth,
          columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
          imageRight: media && copy ? media.left > copy.left : null,
          cardTops: cards.map((card) => Math.round(card.top)), cardLefts: cards.map((card) => Math.round(card.left)),
          listRows: element.querySelectorAll('.tpl-list-items li').length,
          bannerBackground: getComputedStyle(element).backgroundColor,
        }
      })
      await shot(section, `home-${spec.key}`)
      // Small headings are upper-cased by CSS, so compare without case.
      const hasText = info.text.toLowerCase().includes(spec.title.toLowerCase()) && info.text.toLowerCase().includes(spec.eyebrow.toLowerCase())
      if (spec.key === 'split') check('Class · Image + text: two columns, picture on the right (mirrored), Book a class button', info.template === 'split' && hasText && info.columns === 2 && info.imageRight === true && info.text.toLowerCase().includes('book a class'), `${info.columns} columns, image ${info.imageRight ? 'right' : 'left'}`)
      if (spec.key === 'banner') check(`Event · Full-width banner: spans the page${publishedEvent ? `, shows the linked event's date and place` : ''}`, info.template === 'banner' && hasText && info.width >= info.viewport - 20 && (!publishedEvent || /2026/.test(info.text)), `${Math.round(info.width)}px of ${info.viewport}px`)
      if (spec.key === 'cards') check('Class · Card grid: 3 cards side by side in one row', info.template === 'cards' && hasText && info.cardTops.length === 3 && new Set(info.cardTops).size === 1 && new Set(info.cardLefts).size === 3 && ['Minis', 'Juniors', 'Seniors'].every((name) => info.text.includes(name)), `tops ${info.cardTops.join('/')}`)
      if (spec.key === 'list') check('Event · Simple list: 3 numbered rows', info.template === 'list' && hasText && info.listRows === 3 && info.text.includes('01') && info.text.includes('Christmas party'), `${info.listRows} rows`)
    }
    const templatesOnPage = await visitor.evaluate((ids) => ids.map((id) => document.getElementById(`block-${id}`)?.dataset.template), created)
    check('All four look different: one of each template on the homepage', new Set(templatesOnPage).size === 4, templatesOnPage.join(', '))

    /* 3. The class block's button opens the booking form. */
    await visitor.locator(`#block-${created[0]}`).getByRole('link', { name: 'Book a class' }).click()
    await visitor.getByText('Reserve a place').first().waitFor({ timeout: 10000 })
    check('"Book a class" on the block opens the booking form', true)
    await visitor.keyboard.press('Escape')

    // Phone width: nothing spills sideways.
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await phone.goto(`${serverBase}/?p=${stamp}`)
    await phone.locator(`#block-${created[3]}`).waitFor({ timeout: 30000 })
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check('Phone width (390px): no sideways scrolling', overflow <= 0, `${overflow}px`)
    await phone.locator(`#block-${created[2]}`).scrollIntoViewIfNeeded()
    await shot(phone.locator(`#block-${created[2]}`), 'phone-cards')

    /* 4. A built-in section takes a template, then goes back. */
    await admin.goto(`${serverBase}/?r=2#ops/site-layout`)
    await admin.getByRole('heading', { name: 'Homepage layout' }).waitFor()
    const classesRow = admin.locator('div[style]').filter({ has: admin.getByRole('button', { name: 'Move Saturday Classes up' }) }).filter({ has: admin.getByRole('button', { name: 'Style…' }) }).last()
    await classesRow.getByRole('button', { name: 'Style…' }).click()
    await admin.getByRole('radiogroup', { name: 'Template style' }).getByRole('radio', { name: 'Full-width banner' }).click()
    await admin.waitForTimeout(1500)
    const { data: classesStyled } = await service.from('site_sections').select('template').eq('section_key', 'classes').single()
    await visitor.goto(`${serverBase}/?v2=${stamp}`)
    // The saved layout loads just after the first paint; wait for it.
    await visitor.locator('#classes[data-template]').waitFor({ timeout: 15000 }).catch(() => {})
    const builtIn = await visitor.locator('#classes').evaluate((element) => element.dataset.template || element.className)
    check('Built-in Saturday Classes section can use a template (banner)', classesStyled.template === 'banner' && builtIn === 'banner', `saved ${classesStyled.template}, shown ${builtIn}`)
    await admin.getByRole('radiogroup', { name: 'Template style' }).getByRole('radio', { name: 'Original design' }).click()
    await admin.waitForTimeout(1500)
    const { data: classesBack } = await service.from('site_sections').select('template').eq('section_key', 'classes').single()
    await visitor.goto(`${serverBase}/?v3=${stamp}`)
    await visitor.waitForTimeout(3000)
    const restored = await visitor.locator('#classes').evaluate((element) => element.dataset.template || element.className)
    check('…and back to its original design', classesBack.template === null && restored.includes('service'), restored)

    /* 5. Delete through Homepage layout. */
    if (process.env.KEEP !== '1') {
      for (const spec of BLOCKS) {
        const row = admin.locator('div[style]').filter({ hasText: spec.title }).filter({ has: admin.getByRole('button', { name: 'Delete' }) }).last()
        await row.getByRole('button', { name: 'Delete' }).click()
        await admin.waitForTimeout(800)
      }
      const { data: left } = await service.from('site_blocks').select('id').in('id', created)
      const { data: sectionsLeft } = await service.from('site_sections').select('section_key').in('section_key', created.map((id) => `block:${id}`))
      await visitor.goto(`${serverBase}/?v4=${stamp}`)
      await visitor.waitForTimeout(2500)
      const stillShown = await visitor.evaluate((ids) => ids.filter((id) => document.getElementById(`block-${id}`)).length, created)
      check('Deleted from Homepage layout: gone from the database and the homepage', left.length === 0 && sectionsLeft.length === 0 && stillShown === 0)
      if (left.length === 0) created.length = 0
    }
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
  if (process.env.KEEP !== '1' && created.length) {
    await service.from('site_sections').delete().in('section_key', created.map((id) => `block:${id}`))
    await service.from('site_blocks').delete().in('id', created)
  }
  await service.from('site_sections').update({ template: null, mirror: false }).eq('section_key', 'classes')
  if (userId) await service.auth.admin.deleteUser(userId)
  console.log(process.env.KEEP === '1' ? `\nKEEP=1: left blocks ${created.join(', ')}` : '\nCleaned up the test blocks and login.')
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed')
  process.exit(failures ? 1 : 0)
}
