import 'dotenv/config'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

// Live check of Social Studio phase 1 against the real Supabase project and
// the real "It's Time to Rise" event. Needs the local server running and
// supabase/migrations/20261007_social_studio.sql applied. Creates temporary
// staff users, library photos, a hidden adult class and posts, and removes
// them all at the end. Rendered PNGs are written to SOCIAL_VERIFY_OUT.
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY)
const base = process.env.SOCIAL_TEST_SERVER_URL || 'http://localhost:4242'
const outDir = process.env.SOCIAL_VERIFY_OUT || ''
const EVENT_ID = 'its-time-to-rise-2026'
const stamp = Date.now()
const results = []
const check = (label, ok, detail = '') => { results.push({ label, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`) }
const cleanup = { users: [], media: [], posts: [], paths: [], classId: null }

function pngSize(buffer) {
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG', 'not a PNG')
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

async function makeUser(label, permissions) {
  const email = `social-verify-${label}-${stamp}@example.com`
  const password = `Verify-${randomUUID()}`
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: 'staff', full_name: `Social Verify ${label}` }, app_metadata: { signup_notified_at: new Date().toISOString() } })
  if (error) throw error
  cleanup.users.push(data.user.id)
  const { error: profileError } = await service.from('profiles').update({ role: 'staff', full_name: `Social Verify ${label}`, permissions }).eq('id', data.user.id)
  if (profileError) throw profileError
  const client = createClient(url, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  return { id: data.user.id, client, token: signIn.session.access_token }
}

const api = (token) => async (route, { method = 'GET', body } = {}) => {
  const response = await fetch(`${base}${route}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const type = response.headers.get('content-type') || ''
  const payload = type.includes('image/png') ? Buffer.from(await response.arrayBuffer()) : await response.json().catch(() => ({}))
  return { status: response.status, body: payload, headers: response.headers }
}

async function latestAlertSubjects(since) {
  if (!process.env.RESEND_API_KEY) return []
  const response = await fetch('https://api.resend.com/emails?limit=20', { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } })
  const result = await response.json().catch(() => ({}))
  return (result.data || []).filter((email) => new Date(email.created_at).getTime() >= since).map((email) => email.subject)
}

try {
  const staff = await makeUser('social', ['social'])
  const outsider = await makeUser('nosocial', ['events'])
  const call = api(staff.token)

  // 1. Permission gate.
  check('Staff without the social permission are refused', (await api(outsider.token)('/api/social/bootstrap')).status === 403)
  const boot = await call('/api/social/bootstrap')
  check('Staff with the social permission can open Social Studio', boot.status === 200, boot.body.error)
  check('The real event is offered as a source', boot.body.events?.some((event) => event.id === EVENT_ID))

  // 2. Media library: uploads go straight to the private bucket under the
  // staff member's own session (RLS), then get recorded with consent.
  const upload = async (file, meta) => {
    const storagePath = `${randomUUID()}/${path.basename(file).replace(/[^\w.-]/g, '-')}`
    const { error } = await staff.client.storage.from('social-media').upload(storagePath, fs.readFileSync(file), { contentType: 'image/jpeg' })
    if (error) throw new Error(`Upload failed: ${error.message}`)
    cleanup.paths.push(storagePath)
    const result = await call('/api/social/media', { method: 'POST', body: { storagePath, kind: 'image', ...meta } })
    assert.equal(result.status, 200, result.body.error)
    cleanup.media.push(result.body.media.id)
    return result.body.media
  }
  const kids = await upload('public/images/class-session.jpeg', { title: 'VERIFY kids class', tags: ['class', 'event'], consent: 'cleared', showsChildren: true })
  const adult = await upload('public/images/team-steven.jpg', { title: 'VERIFY adult instructor', tags: ['class', 'corporate'], consent: 'adults_only', showsChildren: false })
  const uncleared = await upload('public/images/about-kada.jpeg', { title: 'VERIFY not cleared', tags: ['event'], consent: 'not_cleared', showsChildren: true })
  check('Photos upload to the private social-media bucket', Boolean(kids.url && adult.url && uncleared.url))
  const { data: bucket } = await service.storage.getBucket('social-media')
  check('The social-media bucket is private', bucket?.public === false)
  const publicUrl = service.storage.from('social-media').getPublicUrl(cleanup.paths[0]).data.publicUrl
  check('A library photo is not reachable without a signed link', (await fetch(publicUrl)).status >= 400)
  check('Staff without the permission cannot read the bucket', !(await outsider.client.storage.from('social-media').download(cleanup.paths[0])).data)

  // 3. A hidden adult class carrying the YESHUA poster record.
  const { data: adultClass, error: classError } = await service.from('class_sessions').insert({
    name: 'Afrobeats Cardio', day_of_week: 2, start_time: '18:00', end_time: '19:00', active: false, audience: 'adults',
    category_label: 'Dance Fitness', tagline: 'When praise meets fitness', instructor_first_name: 'Yeshua', city: 'Birmingham',
    venue_name: 'North Birmingham Academy', venue_postcode: 'B44 0HF', levels_note: 'All levels welcome, no dance experience needed',
    price_lines: ['£10 per class', '£30 a month'], booking_url: 'https://kingsarkdance.com/#classes', instagram_handle: '@kingsarkdance',
  }).select('id').single()
  if (classError) throw classError
  cleanup.classId = adultClass.id

  // 4. One post per template, from the real event (the class poster from the class record).
  const expected = { portrait: [1080, 1350], square: [1080, 1080], landscape: [1200, 627], a5: [1240, 1748] }
  const plans = [
    { contentType: 'event_promo', sourceKind: 'event', sourceId: EVENT_ID, platforms: ['instagram', 'facebook'], mediaId: kids.id, formats: ['portrait', 'square', 'landscape'] },
    // The plain poster: an event draft switched to the Poster template in the editor.
    { contentType: 'event_promo', sourceKind: 'event', sourceId: EVENT_ID, platforms: ['instagram', 'facebook'], mediaId: kids.id, formats: ['portrait', 'square', 'landscape'], template: 'poster' },
    { contentType: 'testimonial', sourceKind: 'event', sourceId: EVENT_ID, platforms: ['instagram'], quote: 'Last year was the best night of worship and dance our family has been to.', attribution: 'Parent, KADA family', formats: ['portrait', 'square', 'landscape'] },
    { contentType: 'benefits_carousel', sourceKind: 'event', sourceId: EVENT_ID, platforms: ['instagram'], formats: ['portrait', 'square'] },
    { contentType: 'corporate_team', sourceKind: 'event', sourceId: EVENT_ID, mediaId: adult.id, formats: ['landscape', 'square'] },
    { contentType: 'weekly_class_poster', sourceKind: 'class', sourceId: adultClass.id, platforms: ['instagram'], mediaId: adult.id, formats: ['a5', 'portrait'] },
  ]
  const posts = {}
  for (const plan of plans) {
    const created = await call('/api/social/drafts', { method: 'POST', body: plan })
    if (created.status !== 200) { check(`Draft created: ${plan.contentType}`, false, created.body.error); continue }
    let post = created.body.post
    cleanup.posts.push(post.id)
    const patch = { formats: plan.formats, ...(plan.template ? { template: plan.template } : {}) }
    if (post.template === 'carousel' && post.slides.length < 3) patch.slides = [...post.slides, { heading: 'Bring the whole family', body: 'Family tickets cover two adults and two children.', mediaId: kids.id }]
    const saved = await call(`/api/social/posts/${post.id}`, { method: 'PATCH', body: patch })
    assert.equal(saved.status, 200, saved.body.error)
    post = saved.body.post
    posts[post.template] = post
    check(`Draft created: ${post.template} (${post.drafted_by}), facts from ${post.source_kind}:${post.source_id}`, true)
  }
  const promo = posts.event_promo
  check('Event promo facts are real (date, venue, tiers)', promo.facts?.date === '2026-10-25' && promo.facts?.venue === 'North Birmingham Academy' && promo.facts?.tiers?.length === 4, `${promo.facts?.dateLabel}, ${promo.facts?.priceLine}`)
  check('Sold-out tier is marked sold out', promo.facts.tiers.find((tier) => tier.name === 'Early Bird 2-for-1')?.soldOut === true)

  // 5. Approval flow blocks publishing until approved.
  check('Draft: Download images is refused', (await call(`/api/social/posts/${promo.id}/export?format=portrait`)).status === 409)
  check('Draft: Copy caption is refused', (await call(`/api/social/posts/${promo.id}/caption`)).status === 409)
  check('Draft: Mark as published is refused', (await call(`/api/social/posts/${promo.id}/status`, { method: 'POST', body: { status: 'published' } })).status === 409)
  check('Draft: Schedule is refused', (await call(`/api/social/posts/${promo.id}/status`, { method: 'POST', body: { status: 'scheduled', scheduledFor: new Date(Date.now() + 86400000).toISOString() } })).status === 409)
  const direct = await service.from('social_posts').update({ status: 'published' }).eq('id', promo.id)
  check('Database refuses a direct publish without approval', Boolean(direct.error), direct.error?.message)
  const preview = await call(`/api/social/posts/${promo.id}/preview?format=portrait`)
  check('Draft preview renders (watermarked)', preview.status === 200 && pngSize(preview.body).width === 1080)
  if (outDir) fs.writeFileSync(path.join(outDir, 'draft-preview-event_promo-portrait.png'), preview.body)

  // 6. Approve and export every template in every chosen size.
  for (const post of Object.values(posts)) {
    const approved = await call(`/api/social/posts/${post.id}/approve`, { method: 'POST', body: {} })
    if (approved.status !== 200) { check(`Approve ${post.template}`, false, [approved.body.error, ...(approved.body.problems || []), ...(approved.body.findings?.blocks || []).map((item) => `${item.field}: ${item.excerpt}`)].join(' | ')); continue }
    check(`Approve ${post.template}`, approved.body.post.status === 'approved')
    for (const format of post.formats) {
      const first = await call(`/api/social/posts/${post.id}/export?format=${format}&slide=0`)
      const slides = Number(first.headers.get('x-slide-count')) || 1
      for (let slide = 0; slide < slides; slide += 1) {
        const image = slide === 0 ? first : await call(`/api/social/posts/${post.id}/export?format=${format}&slide=${slide}`)
        if (image.status !== 200) { check(`Export ${post.template} ${format} slide ${slide + 1}`, false, image.body.error); continue }
        const size = pngSize(image.body)
        const ok = size.width === expected[format][0] && size.height === expected[format][1]
        if (slide === 0 || !ok) check(`Export ${post.template} ${format}${slides > 1 ? ` (${slides} slides)` : ''} is ${expected[format].join('x')}`, ok, `${size.width}x${size.height}`)
        if (outDir) fs.writeFileSync(path.join(outDir, `${post.template}-${format}${slides > 1 ? `-${slide + 1}` : ''}.png`), image.body)
      }
    }
  }
  const caption = await call(`/api/social/posts/${promo.id}/caption`)
  check('Approved: Copy caption works', caption.status === 200 && caption.body.caption.length > 20)
  const scheduled = await call(`/api/social/posts/${promo.id}/status`, { method: 'POST', body: { status: 'scheduled', scheduledFor: '2026-10-18T17:00:00Z' } })
  check('Approved post can be scheduled', scheduled.body.post?.status === 'scheduled')

  // 7. Editing an approved post sends it back for approval.
  const edited = await call(`/api/social/posts/${promo.id}`, { method: 'PATCH', body: { headline: "It's Time to Rise!" } })
  check('Editing an approved post returns it to Draft', edited.body.post?.status === 'draft' && !edited.body.post?.approved_at)
  check('…and export is blocked again', (await call(`/api/social/posts/${promo.id}/export?format=portrait`)).status === 409)

  // 8. Uncleared photo: refused with a clear error and an admin alert.
  const alertsSince = Date.now() - 5000
  const unclearedTry = await call(`/api/social/posts/${promo.id}`, { method: 'PATCH', body: { mediaId: uncleared.id } })
  check('Uncleared photo is refused', unclearedTry.status === 422 && unclearedTry.body.rule === 'uncleared', unclearedTry.body.error)
  const draftTry = await call('/api/social/drafts', { method: 'POST', body: { contentType: 'event_promo', sourceKind: 'event', sourceId: EVENT_ID, mediaId: uncleared.id } })
  check('Uncleared photo is refused when generating a draft', draftTry.status === 422)
  const directMedia = await service.from('social_posts').update({ media_id: uncleared.id }).eq('id', promo.id)
  check('Database refuses an uncleared photo on a post', Boolean(directMedia.error), directMedia.error?.message)

  // 9. Corporate / LinkedIn: no photos of children.
  const corporate = posts.linkedin_card
  const kidsOnCorporate = await call(`/api/social/posts/${corporate.id}`, { method: 'PATCH', body: { mediaId: kids.id } })
  check('Corporate post refuses a photo of children', kidsOnCorporate.status === 422 && kidsOnCorporate.body.rule === 'children_corporate', kidsOnCorporate.body.error)
  const linkedinPoster = await call(`/api/social/posts/${posts.poster.id}`, { method: 'PATCH', body: { platforms: ['instagram', 'linkedin'] } })
  check('Adding LinkedIn to a post with a child photo is refused', linkedinPoster.status === 422 && linkedinPoster.body.rule === 'children_corporate')

  // 10. Class poster refuses export while a field is a placeholder.
  await service.from('class_sessions').update({ instructor_first_name: null }).eq('id', adultClass.id)
  const posterExport = await call(`/api/social/posts/${posts.class_poster.id}/export?format=a5`)
  check('Class poster with a missing field cannot be exported', posterExport.status === 422, posterExport.body.error)

  // 11. Withdrawing consent pulls approved posts back to draft and drops the photo.
  await call(`/api/social/media/${kids.id}`, { method: 'PATCH', body: { consent: 'not_cleared' } })
  const { data: afterWithdraw } = await service.from('social_posts').select('status,media_id').eq('id', posts.poster.id).single()
  check('Withdrawing consent returns posts to draft and removes the photo', afterWithdraw.status === 'draft' && afterWithdraw.media_id === null)

  await new Promise((resolve) => setTimeout(resolve, 4000))
  const subjects = await latestAlertSubjects(alertsSince)
  check('Admin alert emailed for the uncleared photo', subjects.some((subject) => /uncleared photo/i.test(subject)), subjects.join(' | '))
  check('Admin alert emailed for children on a corporate post', subjects.some((subject) => /children on a corporate post/i.test(subject)))
} catch (error) {
  check(`Unexpected error: ${error.message}`, false)
} finally {
  if (cleanup.posts.length) await service.from('social_posts').delete().in('id', cleanup.posts)
  await service.from('social_posts').delete().in('created_by', cleanup.users)
  if (cleanup.media.length) await service.from('social_media').delete().in('id', cleanup.media)
  if (cleanup.paths.length) await service.storage.from('social-media').remove(cleanup.paths)
  if (cleanup.classId) await service.from('class_sessions').delete().eq('id', cleanup.classId)
  for (const id of cleanup.users) await service.auth.admin.deleteUser(id)
  const failed = results.filter((item) => !item.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exitCode = failed.length ? 1 : 0
}
