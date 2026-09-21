import { useEffect, useRef, useState } from 'react'
import { OpsButton, OPS_COLORS, opsInputStyle } from './ui'

/* ------------------------------------------------------------------ */
/* Visual email composer ,  edit the email like a document, not code.   */
/*                                                                     */
/* Templates store plain sections (eyebrow / heading / paragraphs /    */
/* quotes / CTA). Editing is done in simple text fields; the brand     */
/* shell (emerald/gold/cream, header bar, footer) is added around the  */
/* sections on every keystroke, so what you type is what sends.        */
/* ------------------------------------------------------------------ */

const E = '#0b3d2e'
const G = '#c9a227'
const C = '#f6f3ea'
const IVORY = '#fffdf8'
const INK = '#232323'
const MUTED = '#767066'
const SERIF = "Georgia,'Times New Roman',serif"
const SANS = 'Arial,Helvetica,sans-serif'
const SITE = 'https://kingsarkdance.com'

export const emailShell = (inner) => `<div style="background:${C};padding:32px 16px;font-family:${SANS};color:${INK};line-height:1.6"><div style="max-width:560px;margin:0 auto;background:${IVORY};border:1px solid #e4ddc9;border-radius:14px;overflow:hidden"><div style="height:6px;background:linear-gradient(90deg,${E},${G})"></div><div style="padding:28px 28px 8px">${inner}</div><div style="padding:18px 28px 26px;font-size:12px;color:${MUTED};border-top:1px solid #eee7d2;margin-top:20px">King's Ark Dance Academy · Birmingham · <a href="${SITE}" style="color:${E}">kingsarkdance.com</a><br>You're receiving this because you're part of the KADA community.</div></div></div>`

const S = {
  eyebrow: (t) => `<p style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${G};font-weight:700;margin:0 0 8px">${t}</p>`,
  heading: (t) => `<h1 style="font-family:${SERIF};font-size:26px;font-weight:500;color:${E};margin:0 0 14px;line-height:1.25">${t}</h1>`,
  paragraph: (t) => `<p style="margin:0 0 14px;font-size:15px">${t}</p>`,
  quote: (t, by) => `<div style="border-left:3px solid ${G};padding:4px 0 4px 16px;margin:16px 0;font-style:italic;font-size:15px">"${t}"<div style="font-style:normal;font-size:12px;color:${MUTED};margin-top:6px">. ${by}</div></div>`,
  chips: (list) => `<p style="margin:0 0 14px">${list.filter(Boolean).map((t) => `<span style="background:${C};border:1px solid #e4ddc9;border-radius:20px;padding:4px 12px;font-size:12px;display:inline-block;margin:0 6px 6px 0">${t}</span>`).join('')}</p>`,
  divider: () => `<hr style="border:0;border-top:1px solid #eee7d2;margin:18px 0">`,
  cta: (label, url) => `<p style="margin:20px 0 6px"><a href="${url || SITE}" style="background:${E};color:${IVORY};padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;font-size:14px">${label || 'Find out more'} →</a></p>`,
  ctaGold: (label, url) => `<p style="margin:20px 0 6px"><a href="${url || SITE}" style="background:${G};color:${E};padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;font-size:14px">${label || 'Find out more'} →</a></p>`,
}

/* Sections → complete email HTML. */
export function sectionsToHtml(sections) {
  const inner = sections.map((section) => {
    if (section.type === 'eyebrow') return S.eyebrow(section.text)
    if (section.type === 'heading') return S.heading(section.text)
    if (section.type === 'paragraph') return S.paragraph(section.text)
    if (section.type === 'quote') return S.quote(section.text, section.by)
    if (section.type === 'chips') return S.chips(section.items || [])
    if (section.type === 'divider') return S.divider()
    if (section.type === 'cta') return S.cta(section.text, section.url)
    if (section.type === 'ctaGold') return S.ctaGold(section.text, section.url)
    return ''
  }).join('')
  return emailShell(inner)
}

/* Best-effort reverse: template/AI/sent HTML → editable sections. Anything  */
/* unrecognised becomes a "custom block" kept as raw HTML so nothing is lost. */
export function htmlToSections(html) {
  const sections = []
  const source = String(html || '')
  const innerMatch = source.match(/padding:28px 28px 8px">([\s\S]*?)<\/div><div style="padding:18px 28px 26px/)
  const body = innerMatch ? innerMatch[1] : source
  const pattern = /<p style="font-size:11px[^"]*">([\s\S]*?)<\/p>|<h1 [^>]*>([\s\S]*?)<\/h1>|<p style="margin:0 0 14px;font-size:15px">([\s\S]*?)<\/p>|<div style="border-left:3px[^>]*>"([\s\S]*?)"<div[^>]*>\. ([\s\S]*?)<\/div><\/div>|<hr[^>]*>|<p style="margin:20px 0 6px"><a href="([^"]*)" style="background:#0b3d2e[^"]*">([\s\S]*?) →<\/a><\/p>|<p style="margin:20px 0 6px"><a href="([^"]*)" style="background:#c9a227[^"]*">([\s\S]*?) →<\/a><\/p>|<p style="margin:0 0 14px">((?:(?!<\/p>)[\s\S])*?)<\/p>/g
  let lastIndex = 0
  let match
  while ((match = pattern.exec(body)) !== null) {
    const gap = body.slice(lastIndex, match.index).replace(/<[^>]*>/g, '').trim()
    if (gap) sections.push({ type: 'custom', html: body.slice(lastIndex, match.index) })
    lastIndex = pattern.lastIndex
    if (match[1] !== undefined) sections.push({ type: 'eyebrow', text: match[1] })
    else if (match[2] !== undefined) sections.push({ type: 'heading', text: match[2] })
    else if (match[3] !== undefined) sections.push({ type: 'paragraph', text: match[3] })
    else if (match[4] !== undefined) sections.push({ type: 'quote', text: match[4], by: match[5] || '' })
    else if (match[0].startsWith('<hr')) sections.push({ type: 'divider' })
    else if (match[6] !== undefined) sections.push({ type: 'cta', url: match[6], text: match[7] })
    else if (match[8] !== undefined) sections.push({ type: 'ctaGold', url: match[8], text: match[9] })
    else if (match[10] !== undefined) {
      const chips = [...match[10].matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map((chip) => chip[1])
      if (chips.length) sections.push({ type: 'chips', items: chips })
      else sections.push({ type: 'paragraph', text: match[10] })
    }
  }
  const tail = body.slice(lastIndex).replace(/<[^>]*>/g, '').trim()
  if (tail) sections.push({ type: 'custom', html: body.slice(lastIndex) })
  return sections.length ? sections : [{ type: 'paragraph', text: '' }]
}

const BLOCK_CHOICES = [
  { type: 'heading', label: 'Heading' },
  { type: 'paragraph', label: 'Text' },
  { type: 'quote', label: 'Quote' },
  { type: 'cta', label: 'Button (green)' },
  { type: 'ctaGold', label: 'Button (gold)' },
  { type: 'chips', label: 'Tag chips' },
  { type: 'divider', label: 'Divider line' },
]

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, marginBottom: 4 }

function blankSection(type) {
  if (type === 'heading') return { type, text: 'Your heading here' }
  if (type === 'paragraph') return { type, text: 'Write your message here. Use {{name}} to insert the recipient\'s first name.' }
  if (type === 'quote') return { type, text: 'A short testimonial or highlight', by: 'A KADA parent' }
  if (type === 'cta' || type === 'ctaGold') return { type, text: 'Find out more', url: SITE }
  if (type === 'chips') return { type, items: ['All ages', 'No experience needed'] }
  return { type }
}

export function VisualEmailEditor({ value, onChange }) {
  const [sections, setSections] = useState(() => htmlToSections(value))
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => { onChangeRef.current(sectionsToHtml(sections)) }, [sections])

  const update = (index, changes) => setSections((current) => current.map((section, i) => (i === index ? { ...section, ...changes } : section)))
  const move = (index, direction) => setSections((current) => {
    const next = [...current]
    const target = index + direction
    if (target < 0 || target >= next.length) return current
    ;[next[index], next[target]] = [next[target], next[index]]
    return next
  })
  const remove = (index) => setSections((current) => current.filter((_, i) => i !== index))
  const add = (type) => setSections((current) => [...current, blankSection(type)])

  const kindLabel = { eyebrow: 'Small intro line', heading: 'Heading', paragraph: 'Text', quote: 'Quote', chips: 'Tag chips', divider: 'Divider', cta: 'Button (green)', ctaGold: 'Button (gold)', custom: 'Custom block (from template)' }

  return (
    <div>
      <div style={{ display: 'grid', gap: 10 }}>
        {sections.map((section, index) => (
          <div key={index} style={{ border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 8, padding: 12, background: OPS_COLORS.ivory }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: OPS_COLORS.muted }}>{kindLabel[section.type] || section.type}</span>
              <span style={{ display: 'flex', gap: 4 }}>
                <button type="button" onClick={() => move(index, -1)} title="Move up" style={toolBtn}>↑</button>
                <button type="button" onClick={() => move(index, 1)} title="Move down" style={toolBtn}>↓</button>
                <button type="button" onClick={() => remove(index)} title="Remove block" style={{ ...toolBtn, color: OPS_COLORS.warn }}>✕</button>
              </span>
            </div>
            {section.type === 'custom' && <textarea style={{ ...opsInputStyle, minHeight: 70, fontFamily: 'monospace', fontSize: 12 }} value={section.html} onChange={(event) => update(index, { html: event.target.value })} />}
            {section.type === 'paragraph' && <textarea style={{ ...opsInputStyle, minHeight: 70 }} value={section.text} onChange={(event) => update(index, { text: event.target.value })} />}
            {(section.type === 'eyebrow' || section.type === 'heading') && <input style={opsInputStyle} value={section.text} onChange={(event) => update(index, { text: event.target.value })} />}
            {section.type === 'quote' && (
              <div style={{ display: 'grid', gap: 8 }}>
                <textarea style={{ ...opsInputStyle, minHeight: 56 }} value={section.text} onChange={(event) => update(index, { text: event.target.value })} />
                <input style={opsInputStyle} placeholder="Who said it" value={section.by || ''} onChange={(event) => update(index, { by: event.target.value })} />
              </div>
            )}
            {(section.type === 'cta' || section.type === 'ctaGold') && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label style={{ display: 'block' }}><span style={labelStyle}>Button label</span><input style={opsInputStyle} value={section.text} onChange={(event) => update(index, { text: event.target.value })} /></label>
                <label style={{ display: 'block' }}><span style={labelStyle}>Button link</span><input style={opsInputStyle} value={section.url || ''} onChange={(event) => update(index, { url: event.target.value })} /></label>
              </div>
            )}
            {section.type === 'chips' && <input style={opsInputStyle} placeholder="Comma separated, e.g. All ages, Saturdays" value={(section.items || []).join(', ')} onChange={(event) => update(index, { items: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} />}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
        <span style={{ ...labelStyle, alignSelf: 'center', margin: 0 }}>Add block:</span>
        {BLOCK_CHOICES.map((choice) => (
          <OpsButton key={choice.type} small variant="ghost" onClick={() => add(choice.type)}>+ {choice.label}</OpsButton>
        ))}
      </div>
    </div>
  )
}

const toolBtn = { border: `1px solid ${OPS_COLORS.rule}`, background: 'transparent', borderRadius: 6, width: 26, height: 24, cursor: 'pointer', fontSize: 12, color: OPS_COLORS.ink, fontFamily: 'inherit' }
