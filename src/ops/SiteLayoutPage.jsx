import { useState } from 'react'
import { Toggle, OpsButton, ImageField, Pill, OPS_COLORS, OPS_SERIF, opsInputStyle } from './ui'
import { TemplatePicker, TemplateBlock, TEMPLATES } from '../site/BlockTemplates'

// Admin homepage layout control: show/hide homepage sections and reorder them,
// give a section a template style, and add custom content blocks (a class, an
// event, a service or anything else) drawn by the same reusable templates.
// Rows are persisted to public.site_sections / public.site_blocks by the parent.

// Built-in sections whose content fits the templates. The rest (hero, stats,
// team, videos, sponsors, contact) keep their own design.
const TEMPLATABLE = ['about', 'workshops', 'classes', 'events']
const KINDS = [
  { key: 'class', label: 'Class', cta: 'book_class' },
  { key: 'event', label: 'Event', cta: 'event' },
  { key: 'service', label: 'Service', cta: 'school_quote' },
  { key: 'other', label: 'Other', cta: 'none' },
]
const CTA_ACTIONS = [
  { key: 'book_class', label: 'Open the class booking form' },
  { key: 'school_quote', label: 'Open the school quote form' },
  { key: 'event', label: "Go to the linked event's page" },
  { key: 'link', label: 'Go to a link' },
  { key: 'none', label: 'No button' },
]
const templateLabel = (key) => TEMPLATES.find((template) => template.key === key)?.label || 'Original design'
const emptyBlock = (kind = 'class') => ({ kind, template: 'split', mirror: false, eyebrow: '', title: '', body: '', image_url: '', cta_label: '', cta_action: KINDS.find((item) => item.key === kind).cta, cta_url: '', event_id: '', items: [], published: true })

export function SiteLayoutPage({ sections, onSave, blocks = [], events = [], onSaveBlock, onDeleteBlock }) {
  const [saving, setSaving] = useState(false)
  const [styling, setStyling] = useState('')
  const [editing, setEditing] = useState(null)
  const ordered = [...sections].sort((a, b) => a.sortOrder - b.sortOrder)
  const blockFor = (sectionKey) => blocks.find((block) => `block:${block.id}` === sectionKey)

  const persist = async (next) => {
    setSaving(true)
    try {
      await onSave(next)
    } finally {
      setSaving(false)
    }
  }

  const toggleVisible = (sectionKey, visible) => {
    persist(ordered.map((section) => section.sectionKey === sectionKey ? { ...section, visible } : section))
  }
  const setStyle = (sectionKey, changes) => {
    persist(ordered.map((section) => section.sectionKey === sectionKey ? { ...section, ...changes } : section))
  }

  const move = (index, direction) => {
    const target = index + direction
    if (target < 0 || target >= ordered.length) return
    const next = [...ordered]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    persist(next.map((section, position) => ({ ...section, sortOrder: (position + 1) * 10 })))
  }

  return (
    <div className="panel">
      <div className="panel-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3>Homepage layout</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: OPS_COLORS.muted }}>{saving ? 'Saving…' : 'Saved to Supabase'}</span>
          {onSaveBlock && <OpsButton small onClick={() => setEditing(emptyBlock())}>+ Add content block</OpsButton>}
        </div>
      </div>
      <p style={{ color: OPS_COLORS.muted, fontSize: 13, margin: '0 0 14px' }}>
        Toggle sections on or off and reorder them. Content blocks (a class, an event, a service, anything else) and the About, Workshops, Classes and Events sections can use one of four template styles.
        Changes apply immediately to the public site. The page footer is always shown.
      </p>
      <div style={{ display: 'grid', gap: 8 }}>
        {ordered.map((section, index) => {
          const block = blockFor(section.sectionKey)
          const isBlock = section.sectionKey.startsWith('block:')
          const canStyle = TEMPLATABLE.includes(section.sectionKey)
          return (
            <div key={section.sectionKey} style={{ border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 8, background: section.visible ? OPS_COLORS.ivory : OPS_COLORS.cream }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button type="button" aria-label={`Move ${section.label} up`} disabled={index === 0 || saving} onClick={() => move(index, -1)} style={arrowStyle(index === 0 || saving)}>▲</button>
                  <button type="button" aria-label={`Move ${section.label} down`} disabled={index === ordered.length - 1 || saving} onClick={() => move(index, 1)} style={arrowStyle(index === ordered.length - 1 || saving)}>▼</button>
                </div>
                <span style={{ width: 26, textAlign: 'center', fontSize: 12, fontWeight: 700, color: OPS_COLORS.muted }}>{index + 1}</span>
                <span style={{ flex: 1, minWidth: 160, fontWeight: section.visible ? 600 : 500, fontSize: 14, color: section.visible ? OPS_COLORS.ink : OPS_COLORS.muted }}>
                  {block ? block.title : section.label}
                  {isBlock && <span style={{ marginLeft: 8 }}><Pill text={block ? (KINDS.find((kind) => kind.key === block.kind)?.label || 'Block') : 'Missing'} tone={block ? 'gold' : 'red'} /></span>}
                  {(isBlock || canStyle) && <span style={{ display: 'block', fontSize: 11.5, color: OPS_COLORS.muted, fontWeight: 400 }}>Style: {templateLabel(block ? block.template : section.template)}{(block ? block.mirror : section.mirror) && (block ? block.template : section.template) === 'split' ? ' (mirrored)' : ''}{block && !block.published ? ' · draft, not shown' : ''}</span>}
                </span>
                {section.sectionKey === 'events' && <span style={{ fontSize: 11, color: OPS_COLORS.muted }}>also auto-hides when no upcoming events</span>}
                {canStyle && <OpsButton small variant="ghost" onClick={() => setStyling(styling === section.sectionKey ? '' : section.sectionKey)}>{styling === section.sectionKey ? 'Done' : 'Style…'}</OpsButton>}
                {block && <OpsButton small variant="ghost" onClick={() => setEditing({ ...block, event_id: block.event_id || '' })}>Edit</OpsButton>}
                {isBlock && onDeleteBlock && <OpsButton small variant="ghost" onClick={() => { if (window.confirm(`Remove "${block?.title || section.label}" from the homepage? This deletes the block.`)) onDeleteBlock(section.sectionKey.slice(6)) }}>Delete</OpsButton>}
                <Toggle label={`Show ${section.label} on homepage`} checked={section.visible} onChange={(value) => toggleVisible(section.sectionKey, value)} disabled={saving} />
                <span style={{ fontSize: 11.5, color: OPS_COLORS.muted, width: 46, textAlign: 'right' }}>{section.visible ? 'Shown' : 'Hidden'}</span>
              </div>
              {styling === section.sectionKey && (
                <div style={{ padding: '0 12px 12px' }}>
                  <TemplatePicker allowOriginal name={`style-${section.sectionKey}`} value={section.template || ''} mirror={Boolean(section.mirror)} onChange={(template) => setStyle(section.sectionKey, { template })} onMirrorChange={(mirror) => setStyle(section.sectionKey, { mirror })} />
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
        <OpsButton small variant="ghost" disabled={saving} onClick={() => persist(ordered.map((section) => ({ ...section, visible: true })))}>Show all sections</OpsButton>
      </div>
      {editing && <BlockEditor initial={editing} events={events} onClose={() => setEditing(null)} onSave={async (block) => { const id = await onSaveBlock(block); if (id) setEditing(null) }} />}
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, marginBottom: 4 }}>{label}</span>
      {children}
      {hint && <span style={{ display: 'block', fontSize: 11.5, color: OPS_COLORS.muted, marginTop: 3 }}>{hint}</span>}
    </label>
  )
}

function BlockEditor({ initial, events, onClose, onSave }) {
  const [block, setBlock] = useState(initial)
  const [busy, setBusy] = useState(false)
  const set = (changes) => setBlock((current) => ({ ...current, ...changes }))
  const linkedEvent = events.find((event) => event.id === block.event_id)
  const publishedEvents = events.filter((event) => event.status === 'published')
  const maxItems = block.template === 'cards' ? 3 : 8
  const setItem = (index, changes) => set({ items: block.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...changes } : item)) })

  // The preview uses the same template components as the homepage.
  const preview = {
    eyebrow: block.eyebrow, title: block.title || 'Your title', body: block.body,
    meta: linkedEvent ? [linkedEvent.eventDate, linkedEvent.location].filter(Boolean).join(' · ') : '',
    imageUrl: block.image_url, cta: block.cta_action !== 'none' ? { label: block.cta_label || 'Find out more', href: '#', onClick: (event) => event.preventDefault() } : null,
    items: block.items.filter((item) => item.title),
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!block.title.trim()) return
    setBusy(true)
    await onSave({ ...block, title: block.title.trim(), items: block.items.filter((item) => item.title?.trim()).slice(0, maxItems) })
    setBusy(false)
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, padding: 16, overflowY: 'auto', background: 'rgba(20,18,10,.45)' }}>
      <div role="dialog" aria-label={initial.id ? 'Edit content block' : 'Add content block'} onClick={(event) => event.stopPropagation()} style={{ maxWidth: 880, margin: '24px auto', background: '#fffdf8', borderRadius: 10, border: `1px solid ${OPS_COLORS.rule}`, boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${OPS_COLORS.rule}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontFamily: OPS_SERIF, color: OPS_COLORS.emerald, fontWeight: 400 }}>{initial.id ? 'Edit content block' : 'Add content block'}</h3>
          <button type="button" aria-label="Close" onClick={onClose} style={{ border: 0, background: 'none', cursor: 'pointer', fontSize: 18, color: OPS_COLORS.muted }}>×</button>
        </div>
        <form onSubmit={submit} style={{ padding: 18 }}>
          <div style={{ marginBottom: 12 }}>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, marginBottom: 4 }}>What is it?</span>
            <div role="radiogroup" aria-label="Block type" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {KINDS.map((kind) => (
                <button key={kind.key} type="button" role="radio" aria-checked={block.kind === kind.key} onClick={() => set({ kind: kind.key, cta_action: block.kind === kind.key ? block.cta_action : kind.cta })}
                  style={{ border: `1px solid ${block.kind === kind.key ? OPS_COLORS.emerald : OPS_COLORS.rule}`, background: block.kind === kind.key ? OPS_COLORS.emerald : '#fff', color: block.kind === kind.key ? '#fffdf8' : OPS_COLORS.ink, borderRadius: 999, padding: '5px 14px', cursor: 'pointer', fontSize: 13 }}>{kind.label}</button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, marginBottom: 6 }}>Template style</span>
            <TemplatePicker value={block.template} mirror={block.mirror} onChange={(template) => set({ template })} onMirrorChange={(mirror) => set({ mirror })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', gap: 12 }}>
            <Field label="Small heading (optional)"><input style={opsInputStyle} value={block.eyebrow} onChange={(event) => set({ eyebrow: event.target.value })} placeholder="e.g. New this term" /></Field>
            <Field label="Title"><input style={opsInputStyle} value={block.title} onChange={(event) => set({ title: event.target.value })} required /></Field>
          </div>
          <Field label="Text" hint="Leave a blank line between paragraphs."><textarea style={{ ...opsInputStyle, minHeight: 80, resize: 'vertical' }} value={block.body} onChange={(event) => set({ body: event.target.value })} /></Field>
          <ImageField label="Image (optional)" value={block.image_url} onChange={(image_url) => set({ image_url })} hint={block.kind === 'event' ? "Leave empty to use the linked event's flyer." : ''} />
          {block.kind === 'event' && (
            <Field label="Linked event (optional)" hint="Shows its date, time and place, and can link to its page and tickets.">
              <select style={opsInputStyle} value={block.event_id || ''} onChange={(event) => set({ event_id: event.target.value })}>
                <option value="">No linked event</option>
                {publishedEvents.map((item) => <option key={item.id} value={item.id}>{item.title}{item.eventDate ? ` · ${item.eventDate}` : ''}</option>)}
              </select>
            </Field>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Button">
              <select style={opsInputStyle} value={block.cta_action} onChange={(event) => set({ cta_action: event.target.value })}>
                {CTA_ACTIONS.filter((action) => action.key !== 'event' || block.kind === 'event').map((action) => <option key={action.key} value={action.key}>{action.label}</option>)}
              </select>
            </Field>
            {block.cta_action !== 'none' && <Field label="Button text"><input style={opsInputStyle} value={block.cta_label} onChange={(event) => set({ cta_label: event.target.value })} placeholder="Find out more" /></Field>}
          </div>
          {block.cta_action === 'link' && <Field label="Link"><input style={opsInputStyle} type="url" value={block.cta_url} onChange={(event) => set({ cta_url: event.target.value })} placeholder="https://…" required /></Field>}
          {['cards', 'list', 'split', 'banner'].includes(block.template) && (
            <div style={{ marginBottom: 12 }}>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, marginBottom: 4 }}>{block.template === 'cards' ? 'Cards (2 to 3)' : 'Items (optional)'}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: OPS_COLORS.muted, marginBottom: 6 }}>{block.template === 'cards' ? 'Each card has a title, a short line of text and an optional picture. With no cards, the block itself is shown as one card.' : block.template === 'list' ? 'Each item is one line of the list. With no items, each paragraph of the text is a line.' : 'Shown as a short list beside the text.'}</span>
              {block.items.map((item, index) => (
                <div key={index} style={{ border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 8, padding: 10, marginBottom: 8, display: 'grid', gridTemplateColumns: block.template === 'cards' ? '1fr 1fr 110px auto' : '1fr 1fr auto', gap: 8, alignItems: 'start' }}>
                  <input style={opsInputStyle} aria-label={`Item ${index + 1} title`} placeholder="Title" value={item.title || ''} onChange={(event) => setItem(index, { title: event.target.value })} />
                  <input style={opsInputStyle} aria-label={`Item ${index + 1} text`} placeholder="Short text" value={item.body || ''} onChange={(event) => setItem(index, { body: event.target.value })} />
                  {block.template === 'cards' && <ImageField label="" value={item.imageUrl || ''} onChange={(imageUrl) => setItem(index, { imageUrl })} />}
                  <button type="button" aria-label={`Remove item ${index + 1}`} onClick={() => set({ items: block.items.filter((_, itemIndex) => itemIndex !== index) })} style={{ border: 0, background: 'none', color: OPS_COLORS.warn, cursor: 'pointer', fontSize: 18 }}>×</button>
                </div>
              ))}
              {block.items.length < maxItems && <OpsButton small variant="ghost" onClick={() => set({ items: [...block.items, { title: '', body: '', imageUrl: '' }] })}>+ Add {block.template === 'cards' ? 'card' : 'item'}</OpsButton>}
            </div>
          )}
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13, marginBottom: 14 }}>
            <input type="checkbox" checked={block.published !== false} onChange={(event) => set({ published: event.target.checked })} /> Published (shown to visitors)
          </label>
          <div style={{ border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: OPS_COLORS.muted, padding: '6px 10px', borderBottom: `1px solid ${OPS_COLORS.rule}` }}>Preview</div>
            <div className="site-public" aria-hidden="true" style={{ zoom: 0.5, pointerEvents: 'none' }}>
              <TemplateBlock template={block.template} mirror={block.mirror} block={preview} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <OpsButton variant="ghost" onClick={onClose}>Cancel</OpsButton>
            <OpsButton type="submit" disabled={busy || !block.title.trim()}>{busy ? 'Saving…' : initial.id ? 'Save block' : 'Add to homepage'}</OpsButton>
          </div>
        </form>
      </div>
    </div>
  )
}

function arrowStyle(disabled) {
  return {
    border: `1px solid ${OPS_COLORS.rule}`, background: 'transparent', borderRadius: 4, width: 22, height: 16,
    fontSize: 8, lineHeight: 1, cursor: disabled ? 'not-allowed' : 'pointer', color: disabled ? OPS_COLORS.rule : OPS_COLORS.emerald,
  }
}

export default SiteLayoutPage
