/* Social Studio (Operations > Social Studio): media library, draft         */
/* generator, approval queue and image export. Phase 1 publishes nothing to */
/* social networks: approved posts are downloaded and posted by hand.       */
import { randomUUID } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { FORMATS, TEMPLATES, renderPng, slideCount } from './render.js'
import { checkCopy, checkMedia, findPlaceholders, normaliseStatement, postMediaIds } from './rules.js'

export const SOCIAL_BUCKET = 'social-media'
const MEDIA_TAGS = ['class', 'event', 'school', 'corporate']
const CONSENTS = ['cleared', 'adults_only', 'not_cleared']
const PLATFORMS = ['instagram', 'facebook', 'linkedin']
const DRAFT_MODEL = process.env.SOCIAL_DRAFT_MODEL || 'claude-sonnet-5-5'
// Cost guard: Claude drafts per day (UK time), across all staff. Counted when
// a draft is requested, so failed or rejected drafts count too.
const DAILY_DRAFT_LIMIT = Number(process.env.SOCIAL_DAILY_DRAFT_LIMIT || 50)
const londonDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())

export const CONTENT_TYPES = {
  event_promo: { label: 'Event promo', template: 'event_promo', source: 'event' },
  class_highlight: { label: 'Class highlight', template: 'poster', source: 'class' },
  weekly_class_poster: { label: 'Weekly class poster', template: 'class_poster', source: 'class' },
  school_workshop: { label: 'School workshop', template: 'poster', source: 'none' },
  corporate_team: { label: 'Corporate team experience', template: 'linkedin_card', source: 'none' },
  testimonial: { label: 'Testimonial', template: 'quote', source: 'none' },
  benefits_carousel: { label: 'Benefits carousel', template: 'carousel', source: 'none' },
  tips: { label: 'Tips', template: 'carousel', source: 'none' },
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const poundLabel = (pence) => `£${pence % 100 ? (pence / 100).toFixed(2) : pence / 100}`
function clockLabel(time) {
  if (!time) return ''
  const [h, m] = String(time).split(':').map(Number)
  const suffix = h >= 12 ? 'pm' : 'am'
  const hour = h % 12 || 12
  return m ? `${hour}:${String(m).padStart(2, '0')}${suffix}` : `${hour}${suffix}`
}
const displayUrl = (url) => String(url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/(#.*)?$/, '').replace(/\/$/, '')
const cleanText = (value, max = 2000) => String(value ?? '').replace(/\r/g, '').trim().slice(0, max)
const cleanList = (value, max, itemMax = 300) => (Array.isArray(value) ? value : []).map((item) => cleanText(item, itemMax)).filter(Boolean).slice(0, max)

export function registerSocialRoutes(app, { supabase, authenticatedUser, alertFailure, classPrices, appUrl }) {
  /* ---------------------------------------------------------------- */
  /* Access                                                           */
  /* ---------------------------------------------------------------- */
  async function requireSocialAccess(request, response) {
    const user = await authenticatedUser(request)
    if (!user || !supabase) { response.status(401).json({ error: 'Authentication is required.' }); return null }
    const { data: profile } = await supabase.from('profiles').select('role,permissions,full_name').eq('id', user.id).maybeSingle()
    const allowed = profile?.role === 'admin' || (profile?.role === 'staff' && (profile.permissions || []).includes('social'))
    if (!allowed) { response.status(403).json({ error: 'You need the Social Studio permission for this.' }); return null }
    return { user, profile, isAdmin: profile.role === 'admin' }
  }

  /* ---------------------------------------------------------------- */
  /* Shared data                                                      */
  /* ---------------------------------------------------------------- */
  async function draftUsage() {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'social_draft_usage').maybeSingle()
    if (error) throw error
    const day = londonDay()
    return { day, used: data?.value?.day === day ? Number(data.value.count) || 0 : 0, limit: DAILY_DRAFT_LIMIT }
  }

  // Takes one of today's Claude drafts, or returns null when the cap is reached.
  async function claimDraftSlot() {
    const usage = await draftUsage()
    if (usage.used >= usage.limit) return null
    const { error } = await supabase.from('app_settings').upsert({ key: 'social_draft_usage', value: { day: usage.day, count: usage.used + 1 }, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    if (error) throw error
    return { ...usage, used: usage.used + 1 }
  }

  async function loadSettings() {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'social_rules').maybeSingle()
    return { researchStatements: Array.isArray(data?.value?.researchStatements) ? data.value.researchStatements.map(normaliseStatement).filter(Boolean) : [] }
  }

  // First names of every child on the books (never to appear in a post), and
  // names that are allowed even if a child shares them (staff, instructors).
  async function loadNameLists() {
    const [students, instructors, staff, classes] = await Promise.all([
      supabase.from('students').select('name'),
      supabase.from('instructors').select('name'),
      supabase.from('profiles').select('full_name').in('role', ['admin', 'staff', 'instructor']),
      supabase.from('class_sessions').select('instructor_first_name'),
    ])
    if (students.error) throw new Error(`Student names could not be loaded for the name check: ${students.error.message}`)
    const first = (value) => String(value || '').trim().split(/\s+/)[0]
    return {
      childNames: [...new Set((students.data || []).map((row) => first(row.name)).filter(Boolean))],
      allowNames: [...(instructors.data || []).map((row) => first(row.name)), ...(staff.data || []).map((row) => first(row.full_name)), ...(classes.data || []).map((row) => first(row.instructor_first_name))].filter(Boolean),
    }
  }

  async function loadMediaMap(ids) {
    if (!ids.length) return new Map()
    const { data, error } = await supabase.from('social_media').select('*').in('id', ids)
    if (error) throw error
    return new Map((data || []).map((item) => [item.id, item]))
  }

  async function eventFacts(eventId) {
    const { data: event, error } = await supabase.from('events').select('*').eq('id', eventId).maybeSingle()
    if (error) throw error
    if (!event) return null
    const { data: stock } = await supabase.rpc('event_ticket_stock', { p_event_ids: [event.id] })
    const stockByTier = new Map((stock || []).map((row) => [row.tier_id, row]))
    const tiers = (event.ticket_tiers || []).map((tier) => {
      const row = stockByTier.get(tier.id)
      const soldOut = Boolean(row?.sold_out ?? tier.soldOut)
      const remaining = row?.remaining === null || row?.remaining === undefined ? null : Number(row.remaining)
      return { name: tier.name, price: poundLabel(Number(tier.pricePence || 0)), pricePence: Number(tier.pricePence || 0), ticketsPerPurchase: tier.bundleSize || 1, description: tier.description || '', soldOut, ticketsRemaining: remaining, lowStock: remaining !== null && remaining < Number(row?.low_stock_threshold ?? tier.lowStockThreshold ?? 10) }
    })
    const date = event.event_date ? new Date(`${event.event_date}T12:00:00Z`) : null
    const onSale = tiers.filter((tier) => !tier.soldOut)
    const singles = onSale.filter((tier) => tier.ticketsPerPurchase === 1)
    const cheapest = (singles.length ? singles : onSale).sort((a, b) => a.pricePence - b.pricePence)[0]
    const low = onSale.find((tier) => tier.lowStock)
    const url = `${appUrl}/event/${event.id}`
    return {
      kind: 'event',
      id: event.id,
      title: event.title,
      description: event.description || '',
      date: event.event_date,
      dateLabel: date ? date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '',
      weekdayShort: date ? date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }) : '',
      day: date ? String(date.getUTCDate()) : '',
      monthShort: date ? date.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) : '',
      timeLabel: [clockLabel(event.event_time), clockLabel(event.event_end_time)].filter(Boolean).join(' – '),
      venue: event.location || '',
      guestArtists: event.guest_artists || '',
      ticketingOpen: Boolean(event.ticketing_enabled) && event.status === 'published',
      tiers,
      priceLine: cheapest ? `Tickets from ${cheapest.price}${cheapest.ticketsPerPurchase > 1 ? ` for ${cheapest.ticketsPerPurchase}` : ''}` : '',
      stockLine: low ? `Only ${low.ticketsRemaining} ${low.name} tickets left` : '',
      url,
      urlDisplay: displayUrl(url),
    }
  }

  async function classFacts(classId) {
    const { data: row, error } = await supabase.from('class_sessions').select('*').eq('id', classId).maybeSingle()
    if (error) throw error
    if (!row) return null
    const prices = await classPrices()
    const priceLines = (row.price_lines || []).filter(Boolean).length
      ? row.price_lines.filter(Boolean)
      : [`${poundLabel(prices.day_pass)} per class`, `${poundLabel(prices.monthly_membership)} a month`]
    const day = DAY_NAMES[row.day_of_week] || ''
    const start = clockLabel(row.start_time)
    return {
      kind: 'class',
      id: row.id,
      name: row.name,
      description: row.description || '',
      audience: row.audience || 'kids',
      day,
      startTime: start,
      endTime: clockLabel(row.end_time),
      timeLabel: [start, clockLabel(row.end_time)].filter(Boolean).join(' – '),
      priceLines,
      pricesFromStripe: !(row.price_lines || []).filter(Boolean).length,
      category: row.category_label || '',
      tagline: row.tagline || '',
      instructorFirstName: row.instructor_first_name || '',
      city: row.city || '',
      venueName: row.venue_name || '',
      venuePostcode: row.venue_postcode || '',
      levelsNote: row.levels_note || '',
      bookingUrl: row.booking_url || '',
      bookingDisplay: displayUrl(row.booking_url),
      handle: row.instagram_handle || '',
      active: row.active,
    }
  }

  async function brandFacts() {
    const { data } = await supabase.from('site_content').select('key,value').in('key', ['hero', 'about', 'workshops', 'classes'])
    const byKey = Object.fromEntries((data || []).map((row) => [row.key, row.value || {}]))
    return {
      academy: "King's Ark Dance Academy (KADA), Birmingham. Faith inspired Gospel Afrobeats dance.",
      hero: byKey.hero?.lede || '',
      about: [byKey.about?.paragraph1, byKey.about?.paragraph2].filter(Boolean).join(' '),
      schoolWorkshops: [byKey.workshops?.title, byKey.workshops?.body].filter(Boolean).join(' '),
      saturdayClasses: [byKey.classes?.title, byKey.classes?.body].filter(Boolean).join(' '),
      website: displayUrl(appUrl),
      instagram: '@kingsarkdance',
    }
  }

  async function sourceFacts(sourceKind, sourceId) {
    if (sourceKind === 'event' && sourceId) return eventFacts(sourceId)
    if (sourceKind === 'class' && sourceId) return classFacts(sourceId)
    return null
  }

  /* ---------------------------------------------------------------- */
  /* Render content                                                   */
  /* ---------------------------------------------------------------- */
  const photoCache = new Map()
  async function mediaDataUri(item) {
    if (!item) return null
    const key = `${item.id}:${item.updated_at}`
    if (photoCache.has(key)) return photoCache.get(key)
    const { data, error } = await supabase.storage.from(SOCIAL_BUCKET).download(item.storage_path)
    if (error || !data) throw new Error(`Photo "${item.title || item.id}" could not be loaded from storage.`)
    const uri = `data:${item.mime_type};base64,${Buffer.from(await data.arrayBuffer()).toString('base64')}`
    photoCache.set(key, uri)
    if (photoCache.size > 12) photoCache.delete(photoCache.keys().next().value)
    return uri
  }

  // Missing class-record fields show as a visible [ADD …] marker on the poster,
  // which findPlaceholders then catches, so the export is refused.
  function classPosterFields(facts) {
    const need = (value, label) => (value ? value : `[ADD ${label}]`)
    return {
      city: need(facts.city, 'CITY'),
      dayTimeShort: `${facts.day}s ${facts.startTime}`,
      instructorFirstName: need(facts.instructorFirstName, 'INSTRUCTOR'),
      category: need(facts.category, 'CATEGORY'),
      className: facts.name,
      tagline: need(facts.tagline, 'TAGLINE'),
      dayBand: `Every ${facts.day}`,
      timeBand: facts.startTime,
      levelsNote: facts.levelsNote,
      venueLines: [need(facts.venueName, 'VENUE'), facts.venuePostcode].filter(Boolean),
      priceLines: facts.priceLines,
      bookingDisplay: need(facts.bookingDisplay, 'BOOKING LINK'),
      handle: need(facts.handle, 'INSTAGRAM HANDLE'),
    }
  }

  async function buildRenderContent(post, mediaById, { draft }) {
    const facts = await sourceFacts(post.source_kind, post.source_id)
    const main = post.media_id ? mediaById.get(post.media_id) : null
    const content = {
      draft,
      eyebrow: post.eyebrow || '',
      headline: post.headline || '',
      subhead: post.subhead || '',
      quote: post.quote || '',
      attribution: post.attribution || '',
      cta: post.cta || '',
      points: post.points || [],
      url: facts?.kind === 'event' ? facts.urlDisplay : facts?.kind === 'class' && facts.bookingDisplay ? facts.bookingDisplay : displayUrl(appUrl),
      handle: facts?.kind === 'class' && facts.handle ? facts.handle : '@kingsarkdance',
      photo: main?.kind === 'image' ? await mediaDataUri(main) : null,
    }
    if (post.template === 'carousel') {
      content.slides = await Promise.all((post.slides || []).slice(0, 10).map(async (slide) => ({ heading: slide.heading || '', body: slide.body || '', photo: slide.mediaId && mediaById.get(slide.mediaId)?.kind === 'image' ? await mediaDataUri(mediaById.get(slide.mediaId)) : null })))
      if (!content.slides.length) content.slides = [{ heading: post.headline, body: post.subhead || '', photo: content.photo }]
    }
    if (post.template === 'event_promo') {
      if (facts?.kind !== 'event') throw Object.assign(new Error('An event promo needs an event. Pick the event on this post.'), { status: 400 })
      // Date, time, venue, prices and stock are always live from the event.
      content.event = { weekdayShort: facts.weekdayShort, day: facts.day, monthShort: facts.monthShort, timeLabel: facts.timeLabel, venue: facts.venue, priceLine: facts.priceLine, stockLine: facts.stockLine }
    }
    if (post.template === 'class_poster') {
      if (facts?.kind !== 'class') throw Object.assign(new Error('A class poster needs a class. Pick the class on this post.'), { status: 400 })
      const QRCode = (await import('qrcode')).default
      content.classPoster = {
        ...classPosterFields(facts),
        photo: content.photo,
        qr: facts.bookingUrl ? await QRCode.toDataURL(facts.bookingUrl, { margin: 0, width: 480, errorCorrectionLevel: 'M' }) : null,
      }
    }
    return { content, facts }
  }

  // Placeholders anywhere a reader would see them: post text and, for class
  // posters, the class-record fields and the QR code.
  async function exportProblems(post, mediaById) {
    const problems = findPlaceholders(post).map((item) => `${item.field} still has a placeholder ("${item.excerpt}").`)
    if (post.template === 'class_poster') {
      const facts = await classFacts(post.source_id).catch(() => null)
      if (!facts) problems.push('The class on this poster no longer exists.')
      else {
        const fields = classPosterFields(facts)
        for (const [label, value] of Object.entries({ City: fields.city, 'Instructor first name': fields.instructorFirstName, Category: fields.category, Tagline: fields.tagline, Venue: fields.venueLines[0], 'Booking link': fields.bookingDisplay, 'Instagram handle': fields.handle })) {
          if (String(value).startsWith('[ADD')) problems.push(`${label} is missing from the class record (Operations > Class schedule > Poster details).`)
        }
        if (!facts.bookingUrl) problems.push('The QR code has no booking link to point to.')
      }
      if (!post.media_id) problems.push('The poster still needs a photo.')
    }
    if (post.template === 'quote' && !(post.quote || '').trim()) problems.push('The quote card has no quote.')
    if (!(post.headline || '').trim() && post.template !== 'quote' && post.template !== 'class_poster') problems.push('The headline is empty.')
    if (!post.media_id && ['event_promo', 'poster'].includes(post.template)) problems.push('This template still needs a photo.')
    for (const item of checkMedia(post, mediaById)) problems.push(item.message)
    return problems
  }

  // Refuses (and alerts the admin) when a post would use an uncleared photo,
  // or a photo of children on a LinkedIn / corporate post.
  async function refuseBadMedia(post, mediaById, who, action, response) {
    const problems = checkMedia(post, mediaById).filter((item) => ['uncleared', 'children_corporate'].includes(item.rule))
    if (!problems.length) return false
    const first = problems[0]
    await alertFailure(first.rule === 'uncleared' ? 'Social Studio refused an uncleared photo' : 'Social Studio refused a photo of children on a corporate post', new Error(first.message), {
      Action: action,
      Post: post.title || post.headline || post.id,
      'Post id': post.id,
      Photo: mediaById.get(first.mediaId)?.title || first.mediaId,
      'Photo consent': mediaById.get(first.mediaId)?.consent,
      'Staff member': who.profile?.full_name || who.user.email,
    })
    response.status(422).json({ error: first.message, rule: first.rule, mediaId: first.mediaId })
    return true
  }

  async function copyFindings(post) {
    const [settings, names] = await Promise.all([loadSettings(), loadNameLists()])
    return checkCopy(post, { researchStatements: settings.researchStatements, ...names })
  }

  /* ---------------------------------------------------------------- */
  /* Drafting                                                         */
  /* ---------------------------------------------------------------- */
  const DRAFT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'eyebrow', 'headline', 'subhead', 'cta', 'points', 'slides', 'caption', 'hashtags'],
    properties: {
      title: { type: 'string', description: 'Short internal name for the post (staff only).' },
      eyebrow: { type: 'string', description: 'Two to four word kicker above the headline.' },
      headline: { type: 'string', description: 'Headline on the image. At most 8 words.' },
      subhead: { type: 'string', description: 'One supporting sentence on the image. At most 22 words.' },
      cta: { type: 'string', description: 'Button text, two or three words.' },
      points: { type: 'array', items: { type: 'string' }, description: 'Up to three short bullet points (corporate LinkedIn card). Empty otherwise.' },
      slides: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['heading', 'body'], properties: { heading: { type: 'string' }, body: { type: 'string' } } }, description: 'Carousel slides (cover first), up to 10. Empty for single images.' },
      caption: { type: 'string', description: 'The post caption, ready to paste.' },
      hashtags: { type: 'array', items: { type: 'string' } },
    },
  }

  function draftSystemPrompt(researchStatements) {
    return `You write social media posts for King's Ark Dance Academy (KADA), a faith inspired Gospel Afrobeats dance academy in Birmingham, UK. Voice: warm, joyful, confident, British English, plain words, no hype. Use only the facts you are given: dates, times, prices, ticket tiers, ticket numbers, venues and links must match them exactly, and you must not invent any (no made-up quotes, numbers, testimonials, partners or awards). If a fact you would want is missing, leave it out.

Rules that every word must follow:
- Never promise productivity gains, better focus, output, performance at work or return on investment.
- Never say attention, focus or concentration drops (or anything happens) after a set number of minutes, and never mention attention spans.
- No weight loss, calorie, fat burning, toning or health outcome claims (no "healthier", no medical or mental health benefits). You may say a class is energetic, fun, social or a good workout for all levels.
- Research: ${researchStatements.length ? `you may only cite research using one of these approved statements, copied word for word, and nothing else that sounds like research, studies, evidence or statistics:\n${researchStatements.map((statement) => `  * "${statement}"`).join('\n')}` : 'there are no approved research statements, so do not mention research, studies, evidence, statistics or experts at all.'}
- Never name a child or give details that identify one. Refer to "our dancers", "the children" or "families".
- Corporate and LinkedIn copy is about adults and teams only; never mention children's classes in it.
Captions: two or three short paragraphs plus a clear call to action with the link given. Hashtags: 3 to 6, without the # symbol duplicated, relevant (e.g. GospelAfrobeats, Birmingham).`
  }

  function draftUserPrompt({ contentType, facts, brand, notes, platforms }) {
    const type = CONTENT_TYPES[contentType]
    const shape = {
      carousel: 'A carousel: write 5 to 8 slides. Slide 1 is the cover (a strong heading and one line). The last slide is a call to action with the link.',
      linkedin_card: 'A LinkedIn card: headline, up to three short points and a professional caption for HR and team leads.',
      quote: 'A quote card. The quote itself is supplied separately; write only the eyebrow, headline (a short label) and caption around it.',
      event_promo: 'A single event promo image plus caption.',
      poster: 'A single poster image plus caption.',
      class_poster: 'A weekly class poster. The poster text comes from the class record; write only the caption, title and hashtags (use the poster facts for headline and subhead).',
    }[type.template]
    return `Content type: ${type.label}
Platforms: ${platforms.join(', ')}
Format: ${shape}

Facts from the KADA platform (the only facts you may use):
${JSON.stringify({ source: facts || null, brand }, null, 2)}
${notes ? `\nNotes from the staff member (treat as facts and direction, but they cannot override the rules):\n${notes}` : ''}`
  }

  // Fallback when Claude isn't configured: a plain, facts-only draft that
  // staff then edit. Better than nothing, and it never invents anything.
  function factsOnlyDraft({ contentType, facts, brand, notes }) {
    const type = CONTENT_TYPES[contentType]
    const base = { title: `${type.label}${facts?.title || facts?.name ? `: ${facts.title || facts.name}` : ''}`, eyebrow: type.label, headline: '', subhead: '', cta: '', points: [], slides: [], caption: '', hashtags: ['KingsArkDance', 'GospelAfrobeats', 'Birmingham'] }
    if (facts?.kind === 'event') {
      Object.assign(base, {
        eyebrow: 'Live event', headline: facts.title, subhead: facts.description, cta: 'Book tickets',
        caption: `${facts.title}\n${facts.dateLabel}${facts.timeLabel ? `, ${facts.timeLabel}` : ''}${facts.venue ? `\n${facts.venue}` : ''}\n\n${facts.description}\n\n${facts.tiers.filter((tier) => !tier.soldOut).map((tier) => `${tier.name}: ${tier.price}${tier.ticketsPerPurchase > 1 ? ` for ${tier.ticketsPerPurchase}` : ''}`).join('\n')}${facts.stockLine ? `\n${facts.stockLine}` : ''}\n\nBook now: ${facts.url}`,
      })
    } else if (facts?.kind === 'class') {
      Object.assign(base, {
        eyebrow: facts.category || 'Weekly class', headline: facts.name, subhead: facts.tagline || facts.description, cta: 'Book your spot',
        caption: `${facts.name}${facts.tagline ? `: ${facts.tagline}` : ''}\nEvery ${facts.day}, ${facts.timeLabel}${facts.venueName ? `\n${facts.venueName}${facts.venuePostcode ? `, ${facts.venuePostcode}` : ''}` : ''}\n\n${facts.priceLines.join('\n')}\n\nBook: ${facts.bookingUrl || brand.website}`,
      })
    } else {
      Object.assign(base, { headline: type.label, subhead: contentType === 'school_workshop' ? brand.schoolWorkshops : brand.hero, caption: `${notes || brand.about}\n\n${brand.website}` })
    }
    if (type.template === 'carousel') base.slides = [{ heading: base.headline || type.label, body: base.subhead }, { heading: 'Find out more', body: brand.website }]
    return base
  }

  let anthropic = null
  async function claudeDraft(input, researchStatements, feedback = '') {
    anthropic ||= new Anthropic()
    const messages = [{ role: 'user', content: draftUserPrompt(input) }]
    if (feedback) messages.push({ role: 'assistant', content: feedback.previous }, { role: 'user', content: `That draft broke these rules, so rewrite it fixing every one:\n${feedback.text}` })
    const response = await anthropic.beta.messages.create({
      model: DRAFT_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: draftSystemPrompt(researchStatements),
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: DRAFT_SCHEMA } },
      messages,
    })
    if (response.stop_reason === 'refusal') throw new Error('Claude declined to draft this post. Try different notes, or write it by hand.')
    if (response.stop_reason === 'max_tokens') throw new Error('The draft was cut off. Please try again.')
    const raw = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('')
    return { draft: JSON.parse(raw), raw }
  }

  const draftToPost = (draft) => ({
    title: cleanText(draft.title, 140),
    eyebrow: cleanText(draft.eyebrow, 60),
    headline: cleanText(draft.headline, 140),
    subhead: cleanText(draft.subhead, 300),
    cta: cleanText(draft.cta, 40),
    points: cleanList(draft.points, 3, 160),
    slides: (Array.isArray(draft.slides) ? draft.slides : []).slice(0, 10).map((slide) => ({ heading: cleanText(slide?.heading, 120), body: cleanText(slide?.body, 400) })),
    caption: cleanText(draft.caption, 2200),
    hashtags: cleanList(draft.hashtags, 10, 40).map((tag) => tag.replace(/^#+/, '').replace(/\s+/g, '')),
  })

  /* ---------------------------------------------------------------- */
  /* Post input                                                       */
  /* ---------------------------------------------------------------- */
  function defaultFormats(template, platforms) {
    const allowed = TEMPLATES[template].formats
    const wanted = template === 'class_poster' ? ['a5', 'portrait']
      : [...(platforms.some((p) => p !== 'linkedin') ? ['portrait'] : []), ...(platforms.includes('linkedin') ? ['landscape'] : [])]
    const formats = wanted.filter((format) => allowed.includes(format))
    return formats.length ? formats : [allowed[0]]
  }

  // Whitelists the editable fields of a post from a request body.
  function cleanPostInput(body, existing = {}) {
    const out = {}
    const has = (key) => Object.prototype.hasOwnProperty.call(body, key)
    for (const [key, max] of [['title', 140], ['eyebrow', 60], ['headline', 140], ['subhead', 300], ['quote', 500], ['attribution', 80], ['cta', 40], ['caption', 2200]]) if (has(key)) out[key] = cleanText(body[key], max)
    if (has('points')) out.points = cleanList(body.points, 3, 160)
    if (has('hashtags')) out.hashtags = cleanList(body.hashtags, 10, 40).map((tag) => tag.replace(/^#+/, '').replace(/\s+/g, ''))
    if (has('slides')) out.slides = (Array.isArray(body.slides) ? body.slides : []).slice(0, 10).map((slide) => ({ heading: cleanText(slide?.heading, 120), body: cleanText(slide?.body, 400), ...(slide?.mediaId ? { mediaId: String(slide.mediaId) } : {}) }))
    if (has('mediaId')) out.media_id = body.mediaId || null
    if (has('platforms')) out.platforms = cleanList(body.platforms, 3).filter((item) => PLATFORMS.includes(item))
    if (has('template') && TEMPLATES[body.template]) out.template = body.template
    if (has('sourceKind') && ['event', 'class', 'none'].includes(body.sourceKind)) out.source_kind = body.sourceKind
    if (has('sourceId')) out.source_id = body.sourceId ? String(body.sourceId) : null
    const template = out.template || existing.template
    if (has('formats')) out.formats = cleanList(body.formats, 4).filter((format) => TEMPLATES[template]?.formats.includes(format))
    else if (out.template && existing.template && out.template !== existing.template) out.formats = defaultFormats(template, out.platforms || existing.platforms || ['instagram'])
    if (out.formats && !out.formats.length) out.formats = defaultFormats(template, out.platforms || existing.platforms || ['instagram'])
    return out
  }

  const publicPost = (post) => ({ ...post })

  async function fetchPost(id) {
    const { data, error } = await supabase.from('social_posts').select('*').eq('id', id).maybeSingle()
    if (error) throw error
    return data
  }

  // Signed links for library thumbnails (private bucket; 1 hour).
  async function withSignedUrls(items) {
    if (!items.length) return []
    const { data } = await supabase.storage.from(SOCIAL_BUCKET).createSignedUrls(items.map((item) => item.storage_path), 3600)
    const byPath = new Map((data || []).map((row) => [row.path, row.signedUrl]))
    return items.map((item) => ({ ...item, url: byPath.get(item.storage_path) || '' }))
  }

  /* ---------------------------------------------------------------- */
  /* Routes                                                           */
  /* ---------------------------------------------------------------- */
  app.get('/api/social/bootstrap', async (request, response) => {
    const who = await requireSocialAccess(request, response)
    if (!who) return
    try {
      const today = new Date().toISOString().slice(0, 10)
      const [media, posts, events, classes, settings] = await Promise.all([
        supabase.from('social_media').select('*').order('created_at', { ascending: false }),
        supabase.from('social_posts').select('*').order('updated_at', { ascending: false }),
        supabase.from('events').select('id,title,event_date,status').eq('status', 'published').gte('event_date', today).order('event_date'),
        supabase.from('class_sessions').select('id,name,day_of_week,start_time,audience,active').order('day_of_week'),
        loadSettings(),
      ])
      for (const result of [media, posts, events, classes]) if (result.error) throw result.error
      response.json({
        media: await withSignedUrls(media.data || []),
        posts: (posts.data || []).map(publicPost),
        events: events.data || [],
        classes: classes.data || [],
        settings,
        isAdmin: who.isAdmin,
        aiDrafting: Boolean(process.env.ANTHROPIC_API_KEY),
        draftUsage: process.env.ANTHROPIC_API_KEY ? await draftUsage() : null,
        contentTypes: CONTENT_TYPES,
        templates: TEMPLATES,
        formats: FORMATS,
      })
    } catch (error) {
      response.status(500).json({ error: `Social Studio could not load: ${error.message}` })
    }
  })

  /* Media library -------------------------------------------------- */
  // The browser uploads the file straight to the private bucket (RLS checks
  // the social permission); this records it in the library.
  app.post('/api/social/media', async (request, response) => {
    const who = await requireSocialAccess(request, response)
    if (!who) return
    const body = request.body || {}
    const storagePath = String(body.storagePath || '')
    if (!/^[\w-]+\/[\w.-]+$/.test(storagePath)) return response.status(400).json({ error: 'That upload path is not valid.' })
    const kind = body.kind === 'video' ? 'video' : 'image'
    const consent = CONSENTS.includes(body.consent) ? body.consent : 'not_cleared'
    const showsChildren = consent === 'adults_only' ? false : body.showsChildren !== false
    const folder = storagePath.split('/')[0]
    const { data: listed } = await supabase.storage.from(SOCIAL_BUCKET).list(folder)
    const object = (listed || []).find((item) => `${folder}/${item.name}` === storagePath)
    if (!object) return response.status(400).json({ error: 'The upload did not reach storage. Please try again.' })
    const row = {
      storage_path: storagePath, kind, mime_type: object.metadata?.mimetype || (kind === 'video' ? 'video/mp4' : 'image/jpeg'),
      width: Number(body.width) || null, height: Number(body.height) || null, size_bytes: object.metadata?.size || null,
      title: cleanText(body.title, 120), tags: cleanList(body.tags, 4).filter((tag) => MEDIA_TAGS.includes(tag)), consent, shows_children: showsChildren, uploaded_by: who.user.id,
    }
    const { data, error } = await supabase.from('social_media').insert(row).select('*').single()
    if (error) {
      await alertFailure('Social Studio media library entry', error, { Path: storagePath, 'Staff member': who.profile?.full_name || who.user.email })
      return response.status(500).json({ error: `The file uploaded but could not be added to the library: ${error.message}` })
    }
    response.json({ media: (await withSignedUrls([data]))[0] })
  })

  app.patch('/api/social/media/:id', async (request, response) => {
    const who = await requireSocialAccess(request, response)
    if (!who) return
    const body = request.body || {}
    const changes = {}
    if (body.title !== undefined) changes.title = cleanText(body.title, 120)
    if (body.tags !== undefined) changes.tags = cleanList(body.tags, 4).filter((tag) => MEDIA_TAGS.includes(tag))
    if (body.consent !== undefined) {
      if (!CONSENTS.includes(body.consent)) return response.status(400).json({ error: 'Unknown consent status.' })
      changes.consent = body.consent
    }
    if (body.showsChildren !== undefined) changes.shows_children = Boolean(body.showsChildren)
    if (changes.consent === 'adults_only') changes.shows_children = false
    if (changes.shows_children === true) {
      const { data: current } = await supabase.from('social_media').select('consent').eq('id', request.params.id).maybeSingle()
      if ((changes.consent || current?.consent) === 'adults_only') return response.status(400).json({ error: 'A photo marked "adults only" cannot show children. Change the consent first.' })
    }
    const { data, error } = await supabase.from('social_media').update(changes).eq('id', request.params.id).select('*').maybeSingle()
    if (error) {
      await alertFailure('Social Studio media update', error, { Media: request.params.id, 'Staff member': who.profile?.full_name || who.user.email })
      return response.status(500).json({ error: `The photo could not be updated: ${error.message}` })
    }
    if (!data) return response.status(404).json({ error: 'That photo is no longer in the library.' })
    response.json({ media: (await withSignedUrls([data]))[0] })
  })

  app.delete('/api/social/media/:id', async (request, response) => {
    const who = await requireSocialAccess(request, response)
    if (!who) return
    const { data: item } = await supabase.from('social_media').select('*').eq('id', request.params.id).maybeSingle()
    if (!item) return response.status(404).json({ error: 'That photo is no longer in the library.' })
    const { data: posts } = await supabase.from('social_posts').select('id,title,media_id,slides,status')
    const usedBy = (posts || []).filter((post) => postMediaIds(post).includes(item.id))
    if (usedBy.length) return response.status(409).json({ error: `This is used by ${usedBy.length} post${usedBy.length === 1 ? '' : 's'} (${usedBy.map((post) => post.title || 'untitled').slice(0, 3).join(', ')}). Swap it out of those posts first.` })
    const { error } = await supabase.from('social_media').delete().eq('id', item.id)
    if (error) return response.status(500).json({ error: `The photo could not be removed: ${error.message}` })
    const { error: storageError } = await supabase.storage.from(SOCIAL_BUCKET).remove([item.storage_path])
    if (storageError) await alertFailure('Social Studio file removal', storageError, { Path: item.storage_path })
    response.json({ deleted: true })
  })

  /* Drafts ---------------------------------------------------------- */
  app.post('/api/social/drafts', async (request, response) => {
    const who = await requireSocialAccess(request, response)
    if (!who) return
    const body = request.body || {}
    const contentType = body.contentType
    const type = CONTENT_TYPES[contentType]
    if (!type) return response.status(400).json({ error: 'Choose a content type.' })
    const sourceKind = ['event', 'class'].includes(body.sourceKind) ? body.sourceKind : 'none'
    if (type.source !== 'none' && sourceKind !== type.source) return response.status(400).json({ error: `A ${type.label.toLowerCase()} needs ${type.source === 'event' ? 'an event' : 'a class'}.` })
    const template = type.template
    let platforms = cleanList(body.platforms, 3).filter((item) => PLATFORMS.includes(item))
    if (contentType === 'corporate_team') platforms = ['linkedin']
    if (!platforms.length) platforms = ['instagram', 'facebook']
    const notes = cleanText(body.notes, 2000)
    const quote = cleanText(body.quote, 500)
    if (contentType === 'testimonial' && !quote) return response.status(400).json({ error: 'Paste the real testimonial. Testimonials are never written by the generator.' })
    try {
      const facts = sourceKind !== 'none' ? await sourceFacts(sourceKind, body.sourceId) : null
      if (sourceKind !== 'none' && !facts) return response.status(404).json({ error: 'That event or class no longer exists.' })
      const brand = await brandFacts()
      const settings = await loadSettings()
      const names = await loadNameLists()
      const input = { contentType, facts, brand, notes: [notes, quote ? `Testimonial (verbatim, do not change): "${quote}"` : ''].filter(Boolean).join('\n'), platforms }
      let draft
      let draftedBy = 'facts'
      let findings = { blocks: [], nameMatches: [] }
      if (process.env.ANTHROPIC_API_KEY) {
        if (!(await claimDraftSlot())) return response.status(429).json({ error: `Today's limit of ${DAILY_DRAFT_LIMIT} Claude drafts has been reached, so no more can be generated until midnight (UK time). Existing drafts can still be edited, approved and exported.`, limitReached: true })
        draftedBy = 'claude'
        let result = await claudeDraft(input, settings.researchStatements)
        draft = draftToPost(result.draft)
        findings = checkCopy({ ...draft, quote }, { researchStatements: settings.researchStatements, ...names })
        if (findings.blocks.length || findings.nameMatches.length) {
          const text = [...findings.blocks.map((item) => `- ${item.field}: "${item.excerpt}" (${item.message})`), ...findings.nameMatches.map((name) => `- Remove the name "${name}"; never name a child.`)].join('\n')
          result = await claudeDraft(input, settings.researchStatements, { previous: result.raw, text })
          draft = draftToPost(result.draft)
          findings = checkCopy({ ...draft, quote }, { researchStatements: settings.researchStatements, ...names })
        }
      } else {
        draft = draftToPost(factsOnlyDraft(input))
        findings = checkCopy({ ...draft, quote }, { researchStatements: settings.researchStatements, ...names })
      }
      const row = {
        ...draft,
        content_type: contentType,
        template,
        platforms,
        formats: defaultFormats(template, platforms),
        status: 'draft',
        source_kind: sourceKind,
        source_id: facts?.id || null,
        quote: quote || null,
        attribution: contentType === 'testimonial' ? cleanText(body.attribution, 80) || null : null,
        slides: template === 'carousel' ? draft.slides : [],
        points: template === 'linkedin_card' ? draft.points : [],
        facts: facts || {},
        drafted_by: draftedBy,
        created_by: who.user.id,
      }
      if (template === 'class_poster' && facts) { row.headline = facts.name; row.subhead = facts.tagline }
      // A chosen photo is only attached when it passes the consent rules.
      if (body.mediaId) {
        const mediaById = await loadMediaMap([body.mediaId])
        if (await refuseBadMedia({ ...row, id: 'new draft', media_id: body.mediaId }, mediaById, who, 'Generate draft', response)) return
        row.media_id = body.mediaId
      }
      const { data, error } = await supabase.from('social_posts').insert(row).select('*').single()
      if (error) {
        await alertFailure('Social Studio draft', error, { 'Content type': contentType, 'Staff member': who.profile?.full_name || who.user.email })
        return response.status(500).json({ error: `The draft could not be saved: ${error.message}` })
      }
      response.json({ post: publicPost(data), findings, draftedBy, draftUsage: process.env.ANTHROPIC_API_KEY ? await draftUsage() : null })
    } catch (error) {
      console.error('Social draft failed:', error)
      response.status(error.status || 502).json({ error: error.message || 'The draft could not be generated.' })
    }
  })

  /* Posts ----------------------------------------------------------- */
  app.post('/api/social/posts', async (request, response) => {
    const who = await requireSocialAccess(request, response)
    if (!who) return
    const body = request.body || {}
    const type = CONTENT_TYPES[body.contentType] || CONTENT_TYPES.class_highlight
    const input = cleanPostInput({ template: type.template, ...body })
    const row = { content_type: CONTENT_TYPES[body.contentType] ? body.contentType : 'class_highlight', template: type.template, platforms: ['instagram', 'facebook'], ...input, status: 'draft', drafted_by: 'manual', created_by: who.user.id }
    row.formats = row.formats?.length ? row.formats : defaultFormats(row.template, row.platforms)
    const mediaById = await loadMediaMap(postMediaIds(row))
    if (await refuseBadMedia({ ...row, id: 'new post' }, mediaById, who, 'Create post', response)) return
    const { data, error } = await supabase.from('social_posts').insert(row).select('*').single()
    if (error) return response.status(400).json({ error: error.message })
    response.json({ post: publicPost(data) })
  })

  app.patch('/api/social/posts/:id', async (request, response) => {
    const who = await requireSocialAccess(request, response)
    if (!who) return
    const existing = await fetchPost(request.params.id).catch(() => null)
    if (!existing) return response.status(404).json({ error: 'That post no longer exists.' })
    const changes = cleanPostInput(request.body || {}, existing)
    if (changes.template === 'carousel' && existing.template !== 'carousel' && !changes.slides) changes.slides = [{ heading: existing.headline, body: existing.subhead || '' }]
    const next = { ...existing, ...changes }
    const mediaById = await loadMediaMap(postMediaIds(next))
    if (await refuseBadMedia(next, mediaById, who, 'Save post', response)) return
    // Any content change to an approved post sends it back for approval (the
    // database trigger enforces the same thing).
    const { data, error } = await supabase.from('social_posts').update(changes).eq('id', existing.id).select('*').single()
    if (error) {
      if (error.code === '23514') return response.status(422).json({ error: error.message })
      await alertFailure('Social Studio post save', error, { Post: existing.id, 'Staff member': who.profile?.full_name || who.user.email })
      return response.status(500).json({ error: `The post could not be saved: ${error.message}` })
    }
    response.json({ post: publicPost(data), findings: await copyFindings(data).catch(() => null) })
  })

  app.get('/api/social/posts/:id/check', async (request, response) => {
    const who = await requireSocialAccess(request, response)
    if (!who) return
    const post = await fetchPost(request.params.id).catch(() => null)
    if (!post) return response.status(404).json({ error: 'That post no longer exists.' })
    const mediaById = await loadMediaMap(postMediaIds(post))
    response.json({ findings: await copyFindings(post), problems: await exportProblems(post, mediaById) })
  })

  app.post('/api/social/posts/:id/approve', async (request, response) => {
    const who = await requireSocialAccess(request, response)
    if (!who) return
    const post = await fetchPost(request.params.id).catch(() => null)
    if (!post) return response.status(404).json({ error: 'That post no longer exists.' })
    if (post.status !== 'draft') return response.status(409).json({ error: 'This post is already approved.' })
    const mediaById = await loadMediaMap(postMediaIds(post))
    if (await refuseBadMedia(post, mediaById, who, 'Approve post', response)) return
    try {
      const findings = await copyFindings(post)
      if (findings.blocks.length) return response.status(422).json({ error: 'This post breaks the content rules. Fix the highlighted text, then approve.', findings })
      if (findings.nameMatches.length && !request.body?.confirmNames) return response.status(422).json({ error: `This post contains ${findings.nameMatches.map((name) => `"${name}"`).join(', ')}, which matches a child's first name on the register. Remove it, or confirm it is not a child's name.`, findings, needsNameConfirmation: true })
      const problems = await exportProblems(post, mediaById)
      if (problems.length) return response.status(422).json({ error: 'This post is not finished yet.', problems })
    } catch (error) {
      return response.status(500).json({ error: `The approval checks could not run: ${error.message}` })
    }
    const { data, error } = await supabase.from('social_posts').update({ status: 'approved', approved_by: who.user.id, approved_at: new Date().toISOString(), names_confirmed: Boolean(request.body?.confirmNames) }).eq('id', post.id).eq('status', 'draft').select('*').maybeSingle()
    if (error) return response.status(422).json({ error: error.message })
    if (!data) return response.status(409).json({ error: 'This post changed while you were approving it. Reload and try again.' })
    response.json({ post: publicPost(data) })
  })

  app.post('/api/social/posts/:id/status', async (request, response) => {
    const who = await requireSocialAccess(request, response)
    if (!who) return
    const post = await fetchPost(request.params.id).catch(() => null)
    if (!post) return response.status(404).json({ error: 'That post no longer exists.' })
    const target = request.body?.status
    const changes = {}
    if (target === 'draft') Object.assign(changes, { status: 'draft', approved_at: null, approved_by: null, scheduled_for: null, published_at: null })
    else if (target === 'scheduled' || target === 'published') {
      // Never without an explicit approval click first.
      if (!post.approved_at || post.status === 'draft') return response.status(409).json({ error: `This post must be approved before it can be ${target}.` })
      if (target === 'scheduled') {
        const when = new Date(request.body?.scheduledFor || '')
        if (Number.isNaN(when.getTime())) return response.status(400).json({ error: 'Choose a date and time to schedule it for.' })
        Object.assign(changes, { status: 'scheduled', scheduled_for: when.toISOString() })
      } else {
        const mediaById = await loadMediaMap(postMediaIds(post))
        if (await refuseBadMedia(post, mediaById, who, 'Mark published', response)) return
        Object.assign(changes, { status: 'published', published_at: new Date().toISOString(), scheduled_for: post.scheduled_for || new Date().toISOString() })
      }
    } else return response.status(400).json({ error: 'Unknown status.' })
    const { data, error } = await supabase.from('social_posts').update(changes).eq('id', post.id).select('*').single()
    if (error) return response.status(422).json({ error: error.message })
    response.json({ post: publicPost(data) })
  })

  app.delete('/api/social/posts/:id', async (request, response) => {
    const who = await requireSocialAccess(request, response)
    if (!who) return
    const { error } = await supabase.from('social_posts').delete().eq('id', request.params.id)
    if (error) return response.status(500).json({ error: `The post could not be deleted: ${error.message}` })
    response.json({ deleted: true })
  })

  // A small queue keeps at most two renders running at once on the Starter box.
  let rendering = 0
  const waiting = []
  async function withRenderSlot(task) {
    if (rendering >= 2) await new Promise((resolve) => waiting.push(resolve))
    rendering += 1
    try { return await task() } finally { rendering -= 1; waiting.shift()?.() }
  }

  async function sendRender(request, response, { exporting }) {
    const who = await requireSocialAccess(request, response)
    if (!who) return
    const post = await fetchPost(request.params.id).catch(() => null)
    if (!post) return response.status(404).json({ error: 'That post no longer exists.' })
    const format = String(request.query.format || post.formats?.[0] || 'portrait')
    if (!FORMATS[format] || !TEMPLATES[post.template].formats.includes(format)) return response.status(400).json({ error: `The ${TEMPLATES[post.template].label} template does not come in that size.` })
    const mediaById = await loadMediaMap(postMediaIds(post))
    if (await refuseBadMedia(post, mediaById, who, exporting ? 'Download images' : 'Preview', response)) return
    if (exporting) {
      if (post.status === 'draft' || !post.approved_at) return response.status(409).json({ error: 'Approve this post before downloading its images.' })
      const problems = await exportProblems(post, mediaById)
      if (problems.length) return response.status(422).json({ error: `This post can't be exported yet: ${problems.join(' ')}`, problems })
    }
    try {
      const { content } = await buildRenderContent(post, mediaById, { draft: post.status === 'draft' })
      const count = slideCount(post.template, content)
      const slide = Math.max(0, Math.min(count - 1, Number(request.query.slide) || 0))
      const { png, width, height } = await withRenderSlot(() => renderPng(post.template, format, content, slide))
      const name = `${(post.title || post.headline || 'kada-post').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || 'kada-post'}-${format}-${width}x${height}${count > 1 ? `-slide-${slide + 1}` : ''}.png`
      response.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Image-Width': String(width), 'X-Image-Height': String(height), 'X-Slide-Count': String(count) })
      if (exporting) response.set('Content-Disposition', `attachment; filename="${name}"`)
      response.send(png)
    } catch (error) {
      console.error('Social render failed:', error)
      response.status(error.status || 500).json({ error: error.status ? error.message : `The image could not be drawn: ${error.message}` })
    }
  }

  app.get('/api/social/posts/:id/preview', (request, response) => sendRender(request, response, { exporting: false }))
  app.get('/api/social/posts/:id/export', (request, response) => sendRender(request, response, { exporting: true }))

  app.get('/api/social/posts/:id/caption', async (request, response) => {
    const who = await requireSocialAccess(request, response)
    if (!who) return
    const post = await fetchPost(request.params.id).catch(() => null)
    if (!post) return response.status(404).json({ error: 'That post no longer exists.' })
    if (post.status === 'draft' || !post.approved_at) return response.status(409).json({ error: 'Approve this post before copying its caption.' })
    const tags = (post.hashtags || []).map((tag) => `#${tag}`).join(' ')
    response.json({ caption: [post.caption, tags].filter(Boolean).join('\n\n') })
  })

  /* Settings (admin) ------------------------------------------------ */
  app.put('/api/social/settings', async (request, response) => {
    const who = await requireSocialAccess(request, response)
    if (!who) return
    if (!who.isAdmin) return response.status(403).json({ error: 'Only an admin can change the approved research statements.' })
    const statements = cleanList(request.body?.researchStatements, 2, 400).map(normaliseStatement)
    const { error } = await supabase.from('app_settings').upsert({ key: 'social_rules', value: { researchStatements: statements, updatedBy: who.user.id }, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    if (error) {
      await alertFailure('Social Studio settings', error)
      return response.status(500).json({ error: `Settings could not be saved: ${error.message}` })
    }
    response.json({ settings: { researchStatements: statements } })
  })

  return { requireSocialAccess, newUploadPath: (name) => `${randomUUID()}/${name}` }
}
