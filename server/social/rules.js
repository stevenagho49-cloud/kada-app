/* Social Studio content rules. Pure functions, shared by the draft         */
/* generator (to check Claude's output), every save, the approval click and */
/* the export, so a hand edit can't slip past what a generated draft can't. */

// Hard blocks: copy that breaks one of these can't be approved or exported.
// The weight/calorie/health rule was written for the Dance Fitness line but
// applies to every post: no KADA content should make those claims.
export const CLAIM_RULES = [
  {
    id: 'productivity',
    message: 'Never promise productivity gains (or better focus, output or ROI at work).',
    patterns: [
      /productiv/i,
      /\b(boost|increase|improve|raise|lift|maximi[sz]e)s?\b[^.!?\n]{0,40}\b(output|efficiency|work performance|performance at work|team performance|focus|concentration|ROI)\b/i,
      /\bROI\b/,
    ],
  },
  {
    id: 'attention_minutes',
    message: 'Never say attention drops (or focus fades) after a set number of minutes.',
    patterns: [
      /attention span/i,
      /\b(attention|focus|concentration)\b[^.!?\n]{0,60}\b\d+\s*(minutes?|mins?)\b/i,
      /\b\d+\s*(minutes?|mins?)\b[^.!?\n]{0,60}\b(attention|focus|concentration)\b/i,
    ],
  },
  {
    id: 'weight_health',
    message: 'No weight loss, calorie or health outcome claims.',
    patterns: [
      /calori/i,
      /weight[\s-]*loss|lose\s+(the\s+)?weight|losing\s+weight|\bslim(ming|mer)?\b|tone\s+up|get\s+toned|fat[\s-]*burn|burn(s|ing)?\s+(the\s+)?fat|inches\s+off|\b\d+\s*(kg|lbs?|pounds)\b|\bdetox/i,
      /\b(lower|reduce|improve|boost|strengthen|protect)s?\b[^.!?\n]{0,30}\b(blood pressure|cholesterol|heart health|immune|immunity|metabolism|mental health|anxiety|depression|bone density|blood sugar|diabetes)\b/i,
      /\b(cure|heal|treat|prevent)s?\b[^.!?\n]{0,30}\b(illness|disease|condition|anxiety|depression|pain|injur)/i,
      /\b(healthier|health benefits|clinically)\b/i,
    ],
  },
]

const RESEARCH_CUE = /\b(research(ers)?|stud(y|ies)|scientists?|scientific(ally)?|evidence|proven|according to|statistics|data shows|surveys?|experts? say)/i

const PLACEHOLDER = /\{\{|\}\}|\[(?:[A-Z][A-Z _-]{2,}|insert[^\]]*|name|date|time|link|url|price|venue)\]|lorem ipsum|placeholder|qr code here|\bTBC\b|\bTBA\b|xx:xx|£x+\b|\?\?\?/i

export const normaliseStatement = (value) => String(value || '').replace(/\s+/g, ' ').trim()

/* Every piece of text a post can show, labelled for error messages. */
export function postTextFields(post) {
  const fields = [
    ['Headline', post.headline], ['Sub-heading', post.subhead], ['Eyebrow', post.eyebrow],
    ['Caption', post.caption], ['Quote', post.quote], ['Attribution', post.attribution],
    ['Call to action', post.cta], ['Hashtags', (post.hashtags || []).join(' ')],
  ]
  ;(post.points || []).forEach((point, index) => fields.push([`Point ${index + 1}`, point]))
  ;(post.slides || []).forEach((slide, index) => {
    fields.push([`Slide ${index + 1} heading`, slide?.heading])
    fields.push([`Slide ${index + 1} text`, slide?.body])
  })
  return fields.filter(([, value]) => value && String(value).trim())
}

/* Returns { blocks: [{rule, field, message, excerpt}], nameMatches: [names] }. */
export function checkCopy(post, { researchStatements = [], childNames = [], allowNames = [] } = {}) {
  const blocks = []
  const approved = researchStatements.map(normaliseStatement).filter(Boolean)
  const allowed = new Set(allowNames.map((name) => name.toLowerCase()))
  const names = [...new Set(childNames.map((name) => String(name || '').trim()).filter((name) => name.length >= 2 && !allowed.has(name.toLowerCase())))]
  const nameMatches = new Set()

  for (const [field, raw] of postTextFields(post)) {
    const value = String(raw)
    for (const rule of CLAIM_RULES) {
      const hit = rule.patterns.map((pattern) => value.match(pattern)).find(Boolean)
      if (hit) blocks.push({ rule: rule.id, field, message: rule.message, excerpt: hit[0] })
    }
    // Research: only the approved statements, word for word. Strip them out
    // first; anything research-like left over is an unapproved claim.
    let remaining = normaliseStatement(value)
    for (const statement of approved) remaining = remaining.split(statement).join(' ')
    const cue = remaining.match(RESEARCH_CUE)
    if (cue) {
      blocks.push({
        rule: 'research',
        field,
        message: approved.length
          ? 'Research claims must use one of the approved research statements word for word.'
          : 'No research statements are approved yet, so this post cannot cite research. An admin can add the approved wording in Social Studio > Settings.',
        excerpt: cue[0],
      })
    }
    // Children's first names: case-sensitive whole words (names are capitalised;
    // this keeps "grace" in a sentence from matching while "Grace" still does).
    for (const name of names) {
      const pattern = new RegExp(`(^|[^\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}])`, 'u')
      if (pattern.test(value)) nameMatches.add(name)
    }
  }
  return { blocks, nameMatches: [...nameMatches] }
}

export function findPlaceholders(post) {
  return postTextFields(post).filter(([, value]) => PLACEHOLDER.test(String(value))).map(([field, value]) => ({ field, excerpt: String(value).match(PLACEHOLDER)[0] }))
}

/* Media consent. "cleared" = cleared for website, Instagram and Facebook;  */
/* "adults_only" = only adults in the frame, cleared; "not_cleared" = never. */
export const CONSENT = {
  cleared: 'Cleared for website, Instagram and Facebook',
  adults_only: 'Adults only',
  not_cleared: 'Not cleared',
}

export const isCorporatePost = (post) => post.content_type === 'corporate_team' || post.template === 'linkedin_card' || (post.platforms || []).includes('linkedin')

// Media ids a post uses: the main photo plus any slide photos.
export function postMediaIds(post) {
  return [...new Set([post.media_id, ...(post.slides || []).map((slide) => slide?.mediaId)].filter(Boolean))]
}

/* Returns a list of problems; empty means every item may be used. */
export function checkMedia(post, mediaById) {
  const problems = []
  const corporate = isCorporatePost(post)
  for (const id of postMediaIds(post)) {
    const item = mediaById.get(id)
    if (!item) { problems.push({ rule: 'missing', mediaId: id, message: 'A photo on this post is no longer in the media library.' }); continue }
    const label = item.title || 'This photo'
    if (item.consent !== 'cleared' && item.consent !== 'adults_only') problems.push({ rule: 'uncleared', mediaId: id, message: `${label} is not cleared for use. Only cleared photos and clips can be used in a post.` })
    if (corporate && item.shows_children) problems.push({ rule: 'children_corporate', mediaId: id, message: `${label} shows children, so it can't be used in a LinkedIn or corporate post.` })
    if (item.kind !== 'image') problems.push({ rule: 'not_image', mediaId: id, message: `${label} is a video clip; templates need a photo.` })
  }
  return problems
}
