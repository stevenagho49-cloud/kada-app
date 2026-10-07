/* Social Studio renderer: brand templates drawn with Satori (layout -> SVG)  */
/* and rasterised with resvg (SVG -> PNG). No headless browser, so it fits   */
/* the Render Starter instance. Both libraries load on first use, so the     */
/* server pays nothing at start-up when no one renders.                      */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export const FORMATS = {
  portrait: { width: 1080, height: 1350, label: 'Instagram / Facebook portrait (1080x1350)' },
  square: { width: 1080, height: 1080, label: 'Instagram / Facebook square (1080x1080)' },
  landscape: { width: 1200, height: 627, label: 'LinkedIn (1200x627)' },
  a5: { width: 1240, height: 1748, label: 'A5 print poster (1240x1748)' },
}

export const TEMPLATES = {
  poster: { label: 'Poster', formats: ['portrait', 'square', 'landscape'] },
  quote: { label: 'Quote card', formats: ['portrait', 'square', 'landscape'] },
  carousel: { label: 'Carousel (up to 10 slides)', formats: ['portrait', 'square'] },
  event_promo: { label: 'Event promo', formats: ['portrait', 'square', 'landscape'] },
  linkedin_card: { label: 'Corporate LinkedIn card', formats: ['landscape', 'square'] },
  class_poster: { label: 'Weekly class poster', formats: ['a5', 'portrait'] },
}

export const BRAND = {
  emerald: '#0b3d2e',
  emeraldDeep: '#072a20',
  emeraldLight: '#145c40',
  gold: '#c9a227',
  cream: '#f6f3ea',
  ivory: '#fffdf8',
  ink: '#232323',
  muted: '#767066',
  night: '#0d0d0d',
}

/* ---------------------------------------------------------------- */
/* Fonts: static .woff instances from @fontsource (Satori reads     */
/* ttf/otf/woff, not woff2 or variable fonts).                       */
/* ---------------------------------------------------------------- */
const FONT_FILES = [
  ['Fraunces', 'fraunces', [500, 600]],
  ['Inter', 'inter', [400, 600, 700]],
  ['Unbounded', 'unbounded', [500, 900]],
  ['Bebas Neue', 'bebas-neue', [400]],
  ['Barlow Condensed', 'barlow-condensed', [500, 600]],
  ['IBM Plex Mono', 'ibm-plex-mono', [400, 500]],
]
let fontCache = null
function loadFonts() {
  if (fontCache) return fontCache
  fontCache = FONT_FILES.flatMap(([name, pkg, weights]) => {
    const dir = path.join(path.dirname(require.resolve(`@fontsource/${pkg}/package.json`)), 'files')
    return weights.map((weight) => ({ name, weight, style: 'normal', data: fs.readFileSync(path.join(dir, `${pkg}-latin-${weight}-normal.woff`)) }))
  })
  return fontCache
}

let logoCache = null
export function logoDataUri() {
  if (!logoCache) logoCache = `data:image/png;base64,${fs.readFileSync(path.resolve(process.cwd(), 'public/images/logo-mark.png')).toString('base64')}`
  return logoCache
}

/* ---------------------------------------------------------------- */
/* Tiny element helpers. Satori takes React-shaped objects; every   */
/* div with more than one child must be display:flex.               */
/* ---------------------------------------------------------------- */
function h(type, props, ...children) {
  const kids = children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false && child !== '')
  return { type, props: { ...props, children: kids.length === 0 ? undefined : kids.length === 1 ? kids[0] : kids } }
}
const box = (style, ...children) => h('div', { style: { display: 'flex', ...style } }, ...children)
const text = (style, value) => h('div', { style: { display: 'flex', ...style } }, String(value ?? ''))
const img = (src, style) => h('img', { src, style: { objectFit: 'cover', ...style } })

// Shrink type for longer copy: full size up to `fits` characters, then scale
// by the square root of the overflow (text area grows with size squared).
function fit(value, base, fits, min = base * 0.45) {
  const length = String(value || '').length
  if (length <= fits) return base
  return Math.max(min, Math.round(base * Math.sqrt(fits / length)))
}

const isLandscape = (format) => format === 'landscape'
const isSquare = (format) => format === 'square'

function draftBand(width) {
  return box({ position: 'absolute', top: 74, right: -132, width: 560, height: 60, background: '#a3401f', alignItems: 'center', justifyContent: 'center', transform: 'rotate(35deg)', opacity: 0.95 },
    text({ color: '#fff', fontFamily: 'Inter', fontWeight: 700, fontSize: Math.round(width / 54), letterSpacing: 3 }, 'DRAFT · NOT APPROVED'))
}

function brandFooter({ dark = true, url, handle, size = 22 }) {
  const color = dark ? BRAND.cream : BRAND.emerald
  return box({ alignItems: 'center', justifyContent: 'space-between', width: '100%' },
    box({ alignItems: 'center', gap: 14 },
      img(logoDataUri(), { width: size * 2.6, height: size * 2.6, borderRadius: 999 }),
      box({ flexDirection: 'column' },
        text({ fontFamily: 'Fraunces', fontWeight: 600, fontSize: size * 1.05, color }, "King's Ark Dance Academy"),
        url ? text({ fontFamily: 'Inter', fontSize: size * 0.8, color: BRAND.gold }, url) : null)),
    handle ? text({ fontFamily: 'Inter', fontWeight: 600, fontSize: size * 0.85, color }, handle) : null)
}

function photoOrPattern(photo, style) {
  if (photo) return img(photo, style)
  // No photo: a quiet brand panel instead of an empty frame.
  return box({ ...style, backgroundImage: `linear-gradient(135deg, ${BRAND.emeraldLight}, ${BRAND.emeraldDeep})`, alignItems: 'center', justifyContent: 'center' },
    img(logoDataUri(), { width: Math.min(260, (style.height || 400) * 0.5), height: Math.min(260, (style.height || 400) * 0.5), opacity: 0.35, borderRadius: 999 }))
}

/* ---------------------------------------------------------------- */
/* Templates. Each returns an element tree for (content, W, H).      */
/* ---------------------------------------------------------------- */
function posterTemplate(c, W, H, format) {
  const footer = brandFooter({ url: c.url, handle: c.handle, size: isLandscape(format) ? 18 : 22 })
  if (isLandscape(format)) {
    return box({ width: W, height: H, background: BRAND.emerald },
      photoOrPattern(c.photo, { width: Math.round(W * 0.45), height: H }),
      box({ flexDirection: 'column', justifyContent: 'space-between', padding: '48px 52px', width: Math.round(W * 0.55) },
        box({ flexDirection: 'column', gap: 16 },
          c.eyebrow ? text({ fontFamily: 'Inter', fontWeight: 700, fontSize: 18, letterSpacing: 4, color: BRAND.gold }, c.eyebrow.toUpperCase()) : null,
          text({ fontFamily: 'Fraunces', fontWeight: 600, fontSize: fit(c.headline, 54, 40), lineHeight: 1.1, color: BRAND.ivory }, c.headline),
          box({ width: 90, height: 5, background: BRAND.gold }),
          c.subhead ? text({ fontFamily: 'Inter', fontSize: fit(c.subhead, 24, 110), lineHeight: 1.4, color: BRAND.cream }, c.subhead) : null),
        footer))
  }
  const photoHeight = Math.round(H * (isSquare(format) ? 0.48 : 0.55))
  return box({ width: W, height: H, flexDirection: 'column', background: BRAND.emerald },
    box({ position: 'relative', width: W, height: photoHeight },
      photoOrPattern(c.photo, { width: W, height: photoHeight }),
      box({ position: 'absolute', left: 0, bottom: 0, width: W, height: 160, backgroundImage: `linear-gradient(to bottom, rgba(11,61,46,0), ${BRAND.emerald})` })),
    box({ flexDirection: 'column', justifyContent: 'space-between', flexGrow: 1, padding: '28px 64px 52px' },
      box({ flexDirection: 'column', gap: 18 },
        c.eyebrow ? text({ fontFamily: 'Inter', fontWeight: 700, fontSize: 22, letterSpacing: 5, color: BRAND.gold }, c.eyebrow.toUpperCase()) : null,
        text({ fontFamily: 'Fraunces', fontWeight: 600, fontSize: fit(c.headline, isSquare(format) ? 68 : 78, 34), lineHeight: 1.08, color: BRAND.ivory }, c.headline),
        box({ width: 110, height: 6, background: BRAND.gold }),
        c.subhead ? text({ fontFamily: 'Inter', fontSize: fit(c.subhead, 30, 120), lineHeight: 1.4, color: BRAND.cream }, c.subhead) : null),
      footer))
}

function quoteTemplate(c, W, H, format) {
  const land = isLandscape(format)
  return box({ width: W, height: H, background: BRAND.cream, padding: land ? 28 : 40 },
    box({ flexDirection: 'column', justifyContent: 'space-between', width: '100%', height: '100%', border: `4px solid ${BRAND.emerald}`, padding: land ? '36px 56px' : '64px 72px', background: BRAND.ivory },
      box({ flexDirection: 'column', gap: land ? 8 : 20, flexGrow: 1, justifyContent: 'center' },
        text({ fontFamily: 'Fraunces', fontWeight: 600, fontSize: land ? 120 : 220, lineHeight: 0.8, color: BRAND.gold, height: land ? 80 : 150 }, '“'),
        text({ fontFamily: 'Fraunces', fontWeight: 500, fontSize: fit(c.quote || c.headline, land ? 40 : 60, land ? 90 : 120, 26), lineHeight: 1.3, color: BRAND.emerald }, c.quote || c.headline),
        box({ width: 80, height: 5, background: BRAND.gold, marginTop: 10 }),
        c.attribution ? text({ fontFamily: 'Inter', fontWeight: 600, fontSize: land ? 20 : 26, letterSpacing: 3, color: BRAND.muted }, c.attribution.toUpperCase()) : null),
      brandFooter({ dark: false, url: c.url, handle: c.handle, size: land ? 16 : 22 })))
}

function carouselSlide(c, W, H, format, index) {
  const slides = c.slides || []
  const slide = slides[index] || {}
  const total = slides.length
  const dots = box({ gap: 10, alignItems: 'center' }, slides.map((_, i) => box({ width: i === index ? 34 : 12, height: 12, borderRadius: 6, background: i === index ? BRAND.gold : 'rgba(201,162,39,0.35)' })))
  const square = isSquare(format)
  if (index === 0) {
    const photoHeight = slide.photo ? Math.round(H * (square ? 0.42 : 0.48)) : 0
    return box({ width: W, height: H, flexDirection: 'column', background: BRAND.emerald },
      slide.photo ? img(slide.photo, { width: W, height: photoHeight }) : null,
      box({ flexDirection: 'column', justifyContent: 'space-between', flexGrow: 1, padding: '56px 72px' },
        box({ flexDirection: 'column', gap: 22 },
          c.eyebrow ? text({ fontFamily: 'Inter', fontWeight: 700, fontSize: 22, letterSpacing: 5, color: BRAND.gold }, c.eyebrow.toUpperCase()) : null,
          text({ fontFamily: 'Fraunces', fontWeight: 600, fontSize: fit(slide.heading || c.headline, slide.photo ? 72 : 96, 30), lineHeight: 1.06, color: BRAND.ivory }, slide.heading || c.headline),
          slide.body ? text({ fontFamily: 'Inter', fontSize: fit(slide.body, 30, 120), lineHeight: 1.4, color: BRAND.cream }, slide.body) : null),
        box({ justifyContent: 'space-between', alignItems: 'center' }, dots, total > 1 ? text({ fontFamily: 'Inter', fontWeight: 700, fontSize: 24, color: BRAND.gold }, 'Swipe →') : null)))
  }
  const photoHeight = slide.photo ? Math.round(H * (square ? 0.38 : 0.42)) : 0
  return box({ width: W, height: H, flexDirection: 'column', background: BRAND.cream },
    slide.photo ? img(slide.photo, { width: W, height: photoHeight }) : null,
    box({ flexDirection: 'column', justifyContent: 'space-between', flexGrow: 1, padding: '56px 72px' },
      box({ flexDirection: 'column', gap: 28, flexGrow: 1, justifyContent: slide.photo ? 'flex-start' : 'center' },
        box({ width: 76, height: 76, borderRadius: 38, background: BRAND.gold, alignItems: 'center', justifyContent: 'center' },
          text({ fontFamily: 'Fraunces', fontWeight: 600, fontSize: 38, color: BRAND.emerald }, String(index))),
        text({ fontFamily: 'Fraunces', fontWeight: 600, fontSize: fit(slide.heading, slide.photo ? 62 : 78, 30), lineHeight: 1.1, color: BRAND.emerald }, slide.heading),
        slide.body ? text({ fontFamily: 'Inter', fontSize: fit(slide.body, slide.photo ? 30 : 42, slide.photo ? 140 : 160, 22), lineHeight: 1.45, color: BRAND.ink }, slide.body) : null),
      box({ justifyContent: 'space-between', alignItems: 'center' }, dots,
        text({ fontFamily: 'Inter', fontWeight: 600, fontSize: 20, color: BRAND.muted }, index === total - 1 ? (c.url || '') : `${index + 1} / ${total}`))))
}

function eventPromoTemplate(c, W, H, format) {
  const e = c.event || {}
  const land = isLandscape(format)
  const dateBlock = box({ flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: BRAND.gold, padding: land ? '14px 20px' : '18px 28px', borderRadius: 10, minWidth: land ? 110 : 150 },
    text({ fontFamily: 'Inter', fontWeight: 700, fontSize: land ? 18 : 24, letterSpacing: 3, color: BRAND.emerald }, (e.weekdayShort || '').toUpperCase()),
    text({ fontFamily: 'Fraunces', fontWeight: 600, fontSize: land ? 58 : 84, lineHeight: 1, color: BRAND.emerald }, e.day || ''),
    text({ fontFamily: 'Inter', fontWeight: 700, fontSize: land ? 18 : 24, letterSpacing: 3, color: BRAND.emerald }, (e.monthShort || '').toUpperCase()))
  const details = box({ flexDirection: 'column', gap: land ? 6 : 10 },
    e.timeLabel ? text({ fontFamily: 'Inter', fontWeight: 600, fontSize: land ? 22 : 30, color: BRAND.ivory }, e.timeLabel) : null,
    e.venue ? text({ fontFamily: 'Inter', fontSize: land ? 20 : 28, color: BRAND.cream }, e.venue) : null,
    e.priceLine ? text({ fontFamily: 'Inter', fontWeight: 700, fontSize: land ? 20 : 28, color: BRAND.gold }, e.priceLine) : null,
    e.stockLine ? text({ fontFamily: 'Inter', fontWeight: 700, fontSize: land ? 18 : 24, color: '#ffd9a8' }, e.stockLine) : null)
  const title = text({ fontFamily: 'Fraunces', fontWeight: 600, fontSize: fit(c.headline, land ? 54 : 80, land ? 26 : 22), lineHeight: 1.05, color: BRAND.ivory }, c.headline)
  const cta = c.cta ? box({ background: BRAND.gold, borderRadius: 999, padding: land ? '10px 22px' : '14px 30px', alignSelf: 'flex-start' }, text({ fontFamily: 'Inter', fontWeight: 700, fontSize: land ? 18 : 26, color: BRAND.emerald }, c.cta)) : null
  if (land) {
    return box({ width: W, height: H, background: BRAND.emeraldDeep },
      photoOrPattern(c.photo, { width: Math.round(W * 0.42), height: H }),
      box({ flexDirection: 'column', justifyContent: 'space-between', padding: '36px 44px', width: Math.round(W * 0.58) },
        box({ gap: 24, alignItems: 'center' }, dateBlock, box({ flexDirection: 'column', gap: 8, flexShrink: 1 }, title, c.subhead ? text({ fontFamily: 'Inter', fontSize: 18, color: BRAND.cream, lineHeight: 1.35 }, c.subhead) : null)),
        box({ justifyContent: 'space-between', alignItems: 'flex-end' }, details, cta),
        text({ fontFamily: 'Inter', fontSize: 16, color: BRAND.gold }, c.url || '')))
  }
  const photoHeight = Math.round(H * (isSquare(format) ? 0.42 : 0.5))
  return box({ width: W, height: H, flexDirection: 'column', background: BRAND.emeraldDeep },
    box({ position: 'relative', width: W, height: photoHeight },
      photoOrPattern(c.photo, { width: W, height: photoHeight }),
      box({ position: 'absolute', left: 0, bottom: 0, width: W, height: 180, backgroundImage: `linear-gradient(to bottom, rgba(7,42,32,0), ${BRAND.emeraldDeep})` }),
      box({ position: 'absolute', left: 64, top: 48 }, dateBlock)),
    box({ flexDirection: 'column', justifyContent: 'space-between', flexGrow: 1, padding: '20px 64px 48px' },
      box({ flexDirection: 'column', gap: 16 },
        c.eyebrow ? text({ fontFamily: 'Inter', fontWeight: 700, fontSize: 22, letterSpacing: 5, color: BRAND.gold }, c.eyebrow.toUpperCase()) : null,
        title,
        c.subhead ? text({ fontFamily: 'Inter', fontSize: fit(c.subhead, 28, 110), lineHeight: 1.4, color: BRAND.cream }, c.subhead) : null),
      box({ justifyContent: 'space-between', alignItems: 'flex-end', gap: 20 }, details, cta),
      box({ justifyContent: 'space-between', alignItems: 'center' },
        box({ alignItems: 'center', gap: 12 }, img(logoDataUri(), { width: 52, height: 52, borderRadius: 999 }), text({ fontFamily: 'Fraunces', fontWeight: 600, fontSize: 22, color: BRAND.cream }, "King's Ark Dance Academy")),
        text({ fontFamily: 'Inter', fontWeight: 600, fontSize: 20, color: BRAND.gold }, c.url || ''))))
}

function linkedinTemplate(c, W, H, format) {
  const land = isLandscape(format)
  const points = (c.points || []).slice(0, 3)
  const panel = box({ flexDirection: 'column', justifyContent: 'space-between', background: BRAND.emerald, padding: land ? '40px 44px' : '64px 72px', width: land ? Math.round(W * 0.6) : W, height: land ? H : Math.round(H * 0.62) },
    box({ flexDirection: 'column', gap: land ? 14 : 22, flexGrow: 1, justifyContent: 'center', paddingBottom: land ? 20 : 0 },
      text({ fontFamily: 'Inter', fontWeight: 700, fontSize: land ? 16 : 22, letterSpacing: 4, color: BRAND.gold }, (c.eyebrow || 'Corporate team experiences').toUpperCase()),
      text({ fontFamily: 'Fraunces', fontWeight: 600, fontSize: fit(c.headline, land ? 52 : 64, 36), lineHeight: 1.12, color: BRAND.ivory }, c.headline),
      box({ width: 80, height: 4, background: BRAND.gold }),
      points.length
        ? box({ flexDirection: 'column', gap: land ? 8 : 12 }, points.map((point) => box({ gap: 12, alignItems: 'flex-start' },
          box({ width: 10, height: 10, borderRadius: 5, background: BRAND.gold, marginTop: land ? 9 : 12 }),
          text({ fontFamily: 'Inter', fontSize: land ? 21 : 26, lineHeight: 1.4, color: BRAND.cream, flexShrink: 1 }, point))))
        : c.subhead ? text({ fontFamily: 'Inter', fontSize: land ? 20 : 28, lineHeight: 1.4, color: BRAND.cream }, c.subhead) : null),
    box({ alignItems: 'center', gap: 14 },
      img(logoDataUri(), { width: land ? 46 : 60, height: land ? 46 : 60, borderRadius: 999 }),
      box({ flexDirection: 'column' },
        text({ fontFamily: 'Fraunces', fontWeight: 600, fontSize: land ? 18 : 24, color: BRAND.ivory }, "King's Ark Dance Academy"),
        c.url ? text({ fontFamily: 'Inter', fontSize: land ? 15 : 20, color: BRAND.gold }, c.url) : null)))
  if (land) return box({ width: W, height: H, background: BRAND.ivory }, panel, photoOrPattern(c.photo, { width: Math.round(W * 0.4), height: H }))
  return box({ width: W, height: H, flexDirection: 'column', background: BRAND.ivory }, photoOrPattern(c.photo, { width: W, height: Math.round(H * 0.38) }), panel)
}

/* Weekly class poster, modelled on the YESHUA Afrobeats Cardio A5 flyer:   */
/* photo top, the instructor's first name sliced gold-over-white across the */
/* bottom of the photo, class name, tagline, day/time band, venue, price,   */
/* booking link with QR, Instagram handle. Every string comes from the      */
/* class record (see classPosterContent in routes.js).                      */
function classPosterTemplate(c, W, H) {
  const p = c.classPoster || {}
  // Reference layout: the supplied 724x1024 A5 flyer. Type scales with the
  // tighter of width and height, so the shorter 4:5 version doesn't crowd.
  const sx = W / 724
  const s = Math.min(sx, H / 1024)
  const pad = Math.round(38 * sx)
  const inner = W - pad * 2
  const photoHeight = Math.round(H * 0.42)
  const name = String(p.instructorFirstName || '').toUpperCase()
  const nameSize = Math.min(Math.round(150 * s), Math.round(inner / Math.max(4, name.length * 0.98)))
  const sliceHeight = Math.round(nameSize * 0.78)
  const half = Math.round(sliceHeight / 2)
  const gap = Math.max(3, Math.round(4 * s))
  const nameLayer = (color, offset) => box({ position: 'absolute', left: 0, top: offset, width: inner, height: sliceHeight, justifyContent: 'center' },
    text({ fontFamily: 'Unbounded', fontWeight: 900, fontSize: nameSize, lineHeight: `${sliceHeight}px`, height: sliceHeight, color, letterSpacing: Math.round(-2 * s) }, name))
  const mono = (value, style = {}) => text({ fontFamily: 'IBM Plex Mono', fontWeight: 400, fontSize: Math.round(13 * s), letterSpacing: Math.round(3 * s), ...style }, value)
  const rule = box({ width: inner, height: 1, background: 'rgba(255,255,255,0.18)' })
  return box({ width: W, height: H, flexDirection: 'column', background: BRAND.night, position: 'relative' },
    box({ width: W, height: Math.round(30 * s), background: '#0b2a1f' }),
    box({ position: 'relative', width: W, height: photoHeight },
      p.photo ? img(p.photo, { width: W, height: photoHeight }) : box({ width: W, height: photoHeight, background: '#1d1d1d' }),
      box({ position: 'absolute', left: 0, bottom: 0, width: W, height: Math.round(photoHeight * 0.45), backgroundImage: `linear-gradient(to bottom, rgba(13,13,13,0), ${BRAND.night})` }),
      box({ position: 'absolute', left: 0, top: 0, width: W, height: Math.round(70 * s), backgroundImage: 'linear-gradient(to bottom, rgba(13,13,13,0.7), rgba(13,13,13,0))' }),
      box({ position: 'absolute', left: pad, top: Math.round(10 * s), width: inner, justifyContent: 'space-between' },
        mono((p.city || '').toUpperCase(), { color: '#ffffff', fontWeight: 500 }),
        mono((p.dayTimeShort || '').toUpperCase(), { color: BRAND.gold, fontWeight: 500 }))),
    // The sliced first name straddles the bottom edge of the photo.
    box({ position: 'relative', marginTop: -Math.round(sliceHeight * 0.62), marginLeft: pad, width: inner, height: sliceHeight },
      box({ position: 'absolute', left: 0, top: 0, width: inner, height: half - gap, overflow: 'hidden' }, nameLayer(BRAND.gold, 0)),
      box({ position: 'absolute', left: 0, top: half, width: inner, height: sliceHeight - half, overflow: 'hidden' }, nameLayer('#ffffff', -half))),
    box({ flexDirection: 'column', padding: `${Math.round(14 * s)}px ${pad}px 0`, flexGrow: 1, justifyContent: 'space-between' },
      box({ flexDirection: 'column' },
        text({ fontFamily: 'Unbounded', fontWeight: 500, fontSize: Math.round(19 * s), letterSpacing: Math.round(6 * s), color: '#ffffff' }, (p.category || '').toUpperCase()),
        text({ fontFamily: 'Bebas Neue', fontSize: fit(p.className, Math.round(58 * s), 18), lineHeight: 1, color: BRAND.gold, marginTop: Math.round(6 * s) }, (p.className || '').toUpperCase()),
        p.tagline ? text({ fontFamily: 'Barlow Condensed', fontWeight: 500, fontSize: Math.round(25 * s), color: '#ffffff', marginTop: Math.round(2 * s) }, p.tagline) : null),
      box({ flexDirection: 'column', gap: Math.round(8 * s) },
        box({ width: inner, background: BRAND.gold, justifyContent: 'space-between', alignItems: 'center', padding: `${Math.round(6 * s)}px ${Math.round(22 * s)}px` },
          text({ fontFamily: 'Bebas Neue', fontSize: Math.round(56 * s), lineHeight: 1.05, color: BRAND.night }, (p.dayBand || '').toUpperCase()),
          text({ fontFamily: 'Bebas Neue', fontSize: Math.round(56 * s), lineHeight: 1.05, color: BRAND.night }, (p.timeBand || '').toUpperCase())),
        p.levelsNote ? mono(p.levelsNote, { color: '#e8e8e8', letterSpacing: Math.round(1.5 * s) }) : null),
      box({ width: inner, gap: Math.round(30 * s) },
        box({ flexDirection: 'column', width: Math.round(inner * 0.5) },
          mono('WHERE', { color: BRAND.gold, fontSize: Math.round(11 * s) }),
          ...(p.venueLines || []).map((line) => text({ fontFamily: 'Barlow Condensed', fontWeight: 600, fontSize: Math.round(25 * s), lineHeight: 1.05, color: '#ffffff' }, line))),
        box({ flexDirection: 'column' },
          mono('PRICE', { color: BRAND.gold, fontSize: Math.round(11 * s) }),
          ...(p.priceLines || []).map((line) => text({ fontFamily: 'Barlow Condensed', fontWeight: 600, fontSize: Math.round(25 * s), lineHeight: 1.05, color: '#ffffff' }, line)))),
      rule,
      box({ width: inner, justifyContent: 'space-between', alignItems: 'center' },
        box({ flexDirection: 'column', gap: Math.round(4 * s) },
          text({ fontFamily: 'Bebas Neue', fontSize: Math.round(40 * s), color: '#ffffff' }, 'BOOK YOUR SPOT'),
          mono(p.bookingDisplay || '', { color: BRAND.gold, fontSize: Math.round(16 * s), letterSpacing: Math.round(1 * s) }),
          box({ width: Math.round(inner * 0.72), borderTop: '1px dashed rgba(255,255,255,0.35)', marginTop: Math.round(6 * s), paddingTop: Math.round(8 * s) },
            mono(p.handle || '', { color: '#ffffff', fontSize: Math.round(14 * s), letterSpacing: Math.round(1 * s) }))),
        box({ width: Math.round(100 * s), height: Math.round(100 * s), background: '#ffffff', alignItems: 'center', justifyContent: 'center', padding: Math.round(6 * s) },
          p.qr ? img(p.qr, { width: Math.round(88 * s), height: Math.round(88 * s), objectFit: 'contain' }) : null)),
      rule,
      box({ alignItems: 'center', gap: Math.round(14 * s), paddingBottom: Math.round(18 * s) },
        img(logoDataUri(), { width: Math.round(54 * s), height: Math.round(54 * s), borderRadius: 999 }),
        mono("A KING'S ARK DANCE ACADEMY CLASS", { color: '#9a9a9a', fontSize: Math.round(12 * s) }))))
}

/* ---------------------------------------------------------------- */
/* Public API                                                       */
/* ---------------------------------------------------------------- */
export function slideCount(template, content) {
  return template === 'carousel' ? Math.max(1, Math.min(10, (content.slides || []).length)) : 1
}

export function buildElement(template, format, content, slideIndex = 0) {
  const size = FORMATS[format]
  if (!size) throw new Error(`Unknown size "${format}".`)
  if (!TEMPLATES[template]) throw new Error(`Unknown template "${template}".`)
  if (!TEMPLATES[template].formats.includes(format)) throw new Error(`The ${TEMPLATES[template].label} template does not come in ${size.label}.`)
  const { width: W, height: H } = size
  const body = template === 'poster' ? posterTemplate(content, W, H, format)
    : template === 'quote' ? quoteTemplate(content, W, H, format)
      : template === 'carousel' ? carouselSlide(content, W, H, format, slideIndex)
        : template === 'event_promo' ? eventPromoTemplate(content, W, H, format)
          : template === 'linkedin_card' ? linkedinTemplate(content, W, H, format)
            : classPosterTemplate(content, W, H, format)
  return box({ position: 'relative', width: W, height: H, overflow: 'hidden' }, body, content.draft ? draftBand(W) : null)
}

let libs = null
async function renderLibs() {
  libs ||= Promise.all([import('satori'), import('@resvg/resvg-js')]).then(([satori, resvg]) => ({ satori: satori.default, Resvg: resvg.Resvg }))
  return libs
}

// Renders one image. Returns { png, width, height }.
export async function renderPng(template, format, content, slideIndex = 0) {
  const { satori, Resvg } = await renderLibs()
  const { width, height } = FORMATS[format] || {}
  const svg = await satori(buildElement(template, format, content, slideIndex), { width, height, fonts: loadFonts() })
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render()
  const png = rendered.asPng()
  return { png, width: rendered.width, height: rendered.height }
}
