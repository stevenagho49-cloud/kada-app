import React, { useEffect, useRef, useState } from 'react'

// Design tokens ,  mirrors the palette used across App.jsx.
export const OPS_COLORS = {
  emerald: '#0b3d2e',
  emeraldLight: '#145c40',
  gold: '#c9a227',
  cream: '#f6f3ea',
  ivory: '#fffdf8',
  ink: '#232323',
  muted: '#767066',
  rule: '#e4ddc9',
  warn: '#a3401f',
  okGreen: '#2e6b47',
}
export const OPS_SERIF = "'Iowan Old Style', 'Georgia', 'Times New Roman', serif"
export const OPS_SANS = "'Inter', -apple-system, 'Helvetica Neue', Arial, sans-serif"

export const opsInputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '9px 11px', fontFamily: 'inherit', fontSize: 14,
  color: OPS_COLORS.ink, border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 6, outline: 'none', background: OPS_COLORS.ivory,
}

const TONES = {
  default: ['#f1eee2', OPS_COLORS.muted],
  green: ['#e6f0e9', OPS_COLORS.okGreen],
  gold: ['#faf1d9', '#8a6d10'],
  red: ['#f7e9e4', OPS_COLORS.warn],
}

export function Pill({ text, tone = 'default' }) {
  const colors = TONES[tone] || TONES.default
  return <span style={{ background: colors[0], color: colors[1], borderRadius: 20, padding: '3px 9px', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{text}</span>
}

export function OpsButton({ children, onClick, type = 'button', disabled, variant = 'primary', small = false }) {
  const styles = {
    primary: { background: OPS_COLORS.emerald, color: OPS_COLORS.ivory },
    gold: { background: OPS_COLORS.gold, color: OPS_COLORS.emeraldLight },
    ghost: { background: 'transparent', color: OPS_COLORS.emerald, border: `1px solid ${OPS_COLORS.rule}` },
    danger: { background: 'transparent', color: OPS_COLORS.warn, border: `1px solid ${OPS_COLORS.rule}` },
  }
  return <button type={type} disabled={disabled} onClick={onClick} style={{ ...styles[variant], borderRadius: 6, padding: small ? '6px 11px' : '9px 18px', fontFamily: 'inherit', fontSize: small ? 12 : 13.5, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1 }}>{children}</button>
}

/* ------------------------------------------------------------------ */
/* Left sidebar ,  dark, collapsible nav groups; a tap-to-open drawer   */
/* on mobile (branding lives in the site header, not duplicated here). */
/* ------------------------------------------------------------------ */
export function OpsSidebar({ caption = 'Operations', items, active, onSelect, openGroups, onToggleGroup }) {
  // Mobile: the sidebar collapses into a tap-to-open drawer (no duplicated
  // branding ,  the site header already carries it). Selecting an item navigates
  // and closes the drawer in one action.
  const [mobileOpen, setMobileOpen] = useState(false)
  const handleSelect = (key) => { setMobileOpen(false); onSelect(key) }
  const activeLabel = items.flatMap((item) => item.children || [item]).find((item) => item.key === active)?.label || caption
  return (
    <aside className="ops-sidebar">
      <button type="button" className="ops-nav-toggle" aria-expanded={mobileOpen} onClick={() => setMobileOpen((current) => !current)}>
        <span>{activeLabel}</span>
        <span aria-hidden="true">{mobileOpen ? '▾' : '▸'}</span>
      </button>
      <div className={`ops-nav-body${mobileOpen ? ' open' : ''}`}>
      <div style={{ padding: '18px 10px 10px' }}>
        <div style={{ color: '#cbc2e2', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>{caption}</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {items.map((item) => (
            item.children ? (
              <div key={item.label}>
                <button type="button" onClick={() => onToggleGroup(item.label)} style={{ width: '100%', textAlign: 'left', borderRadius: 10, padding: '10px 12px', color: '#dfe3f7', background: 'transparent', border: '1px solid transparent', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{item.label}</span>
                  <span style={{ fontSize: 12 }}>{openGroups.has(item.label) ? '▾' : '▸'}</span>
                </button>
                {openGroups.has(item.label) && (
                  <div style={{ display: 'grid', gap: 4, paddingLeft: 12, marginTop: 6 }}>
                    {item.children.map((child) => (
                      <button key={child.key} type="button" onClick={() => handleSelect(child.key)} style={{ width: '100%', textAlign: 'left', borderRadius: 8, padding: '8px 10px', color: active === child.key || child.action ? (child.action && active !== child.key ? '#d5a443' : '#f7c76a') : '#dfe3f7', background: active === child.key ? 'rgba(255, 189, 75, 0.12)' : 'transparent', borderLeft: active === child.key ? '2px solid #f7c76a' : '2px solid transparent', fontWeight: active === child.key ? 700 : 500, cursor: 'pointer' }}>
                        {child.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <button key={item.key} type="button" onClick={() => handleSelect(item.key)} style={{ width: '100%', textAlign: 'left', borderRadius: 10, padding: '10px 12px', color: active === item.key ? '#f7c76a' : '#dfe3f7', background: active === item.key ? 'rgba(255, 189, 75, 0.12)' : 'transparent', borderLeft: active === item.key ? '2px solid #f7c76a' : '2px solid transparent', fontWeight: active === item.key ? 700 : 500, cursor: 'pointer' }}>
                {item.label}
              </button>
            )
          ))}
        </div>
      </div>
      </div>
    </aside>
  )
}

/* ------------------------------------------------------------------ */
/* Empty state ,  icon, headline, one-line explanation, CTA button.    */
/* ------------------------------------------------------------------ */
export function EmptyState({ icon = '📭', title, body, ctaLabel, onCta }) {
  return (
    <div style={{ textAlign: 'center', padding: '46px 20px' }}>
      <div aria-hidden="true" style={{ fontSize: 34, lineHeight: 1 }}>{icon}</div>
      <h3 style={{ fontFamily: OPS_SERIF, color: OPS_COLORS.emerald, fontWeight: 400, margin: '12px 0 6px', fontSize: 20 }}>{title}</h3>
      <p style={{ color: OPS_COLORS.muted, fontSize: 13.5, margin: '0 auto 18px', maxWidth: 400, lineHeight: 1.55 }}>{body}</p>
      {ctaLabel && <OpsButton small variant="gold" onClick={onCta}>{ctaLabel}</OpsButton>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* DataTable ,  real <table> with <thead>, show-N-then-expand, empty.  */
/* ------------------------------------------------------------------ */
export function DataTable({ columns, rows, rowKey = 'id', expanded, onToggleExpand, pageSize = 3, emptyState = null }) {
  if (!rows.length && emptyState) return emptyState
  const visible = expanded ? rows : rows.slice(0, pageSize)
  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table className="ops-table">
          <thead>
            <tr>{columns.map((column) => <th key={column.key} style={column.width ? { width: column.width } : undefined}>{column.label}</th>)}</tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row[rowKey]}>
                {columns.map((column) => <td key={column.key}>{column.render(row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > pageSize && (
        <button type="button" onClick={onToggleExpand} style={{ marginTop: 12, border: 0, background: 'none', color: OPS_COLORS.emerald, cursor: 'pointer', fontWeight: 700 }}>
          {expanded ? 'Show less' : `Show more (${rows.length - pageSize})`}
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Inline editing primitives.                                          */
/* ------------------------------------------------------------------ */
export function EditableText({ value, onSave, type = 'text', placeholder = 'Click to edit', disabled = false, small = false, align }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')

  if (disabled) {
    return <span style={{ fontSize: small ? 12 : 13.5, color: value ? OPS_COLORS.ink : OPS_COLORS.muted }}>{value || 'Not set'}</span>
  }
  if (!editing) {
    return (
      <button
        type="button"
        className="ops-editable"
        title="Click to edit"
        onClick={() => { setDraft(value ?? ''); setEditing(true) }}
        style={{ fontSize: small ? 12 : 13.5, color: value ? OPS_COLORS.ink : OPS_COLORS.muted, textAlign: align || 'left' }}
      >
        {type === 'number' && value !== '' && value !== null && value !== undefined ? String(value) : (value || placeholder)}
      </button>
    )
  }
  const commit = () => {
    setEditing(false)
    if (String(draft) !== String(value ?? '')) onSave(type === 'number' ? Number(draft) : draft)
  }
  return (
    <input
      autoFocus
      type={type}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') { setDraft(value ?? ''); setEditing(false) }
      }}
      style={{ ...opsInputStyle, padding: '5px 8px', fontSize: small ? 12 : 13.5, minWidth: 90 }}
    />
  )
}

export function EditableSelect({ value, onSave, options, disabled = false, placeholder = 'Not set' }) {
  const [editing, setEditing] = useState(false)
  const current = options.find((option) => option.value === (value ?? ''))
  if (disabled) return <span style={{ fontSize: 13.5, color: value ? OPS_COLORS.ink : OPS_COLORS.muted }}>{current?.label || placeholder}</span>
  if (!editing) {
    return (
      <button type="button" className="ops-editable" title="Click to edit" onClick={() => setEditing(true)} style={{ fontSize: 13.5, color: value ? OPS_COLORS.ink : OPS_COLORS.muted }}>
        {current?.label || placeholder}
      </button>
    )
  }
  return (
    <select
      autoFocus
      value={value ?? ''}
      onChange={(event) => { setEditing(false); if (event.target.value !== (value ?? '')) onSave(event.target.value) }}
      onBlur={() => setEditing(false)}
      onKeyDown={(event) => { if (event.key === 'Escape') setEditing(false) }}
      style={{ ...opsInputStyle, padding: '5px 8px', fontSize: 13.5, minWidth: 110 }}
    >
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  )
}

/* ------------------------------------------------------------------ */
/* Clickable status badge with a dropdown of options.                  */
/* ------------------------------------------------------------------ */
export function StatusMenu({ value, label, tone = 'default', options, onChange, disabled = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const close = (event) => { if (!ref.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  if (disabled) return <Pill text={label || value} tone={tone} />
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" className="ops-status-btn" title="Click to change" onClick={() => setOpen((current) => !current)}>
        <Pill text={label || value} tone={tone} />
        <span style={{ fontSize: 9, color: OPS_COLORS.muted, marginLeft: 4 }}>▾</span>
      </button>
      {open && (
        <div className="ops-menu">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => { setOpen(false); if (option.value !== value) onChange(option.value) }}
              style={{ fontWeight: option.value === value ? 700 : 400, color: option.danger ? OPS_COLORS.warn : OPS_COLORS.ink }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Toggle switch (e.g. "Show on homepage").                            */
/* ------------------------------------------------------------------ */
export function Toggle({ checked, onChange, disabled = false, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label || 'Toggle'}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`ops-toggle ${checked ? 'on' : ''}`}
    >
      <span className="ops-toggle-knob" />
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* ImageField ,  pick a photo/file, resize it in the browser, and hand  */
/* back a data URL (stored in site_content/app_settings jsonb ,  no     */
/* extra storage bucket needed). JPEG for photos, PNG for logos so     */
/* transparency survives.                                              */
/* ------------------------------------------------------------------ */
export function fileToDataUrl(file, { maxWidth = 1200, format = 'jpeg', quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('That file could not be read.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('That file is not an image.'))
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL(format === 'png' ? 'image/png' : 'image/jpeg', quality))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

export function ImageField({ label, value, onChange, defaultSrc = '', shape = 'rect', hint = '' }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const preview = value || defaultSrc
  const isLogo = shape === 'logo'
  const pick = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const dataUrl = await fileToDataUrl(file, { maxWidth: isLogo ? 640 : 1200, format: isLogo ? 'png' : 'jpeg' })
      onChange(dataUrl)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }
  const frame = shape === 'circle'
    ? { width: 84, height: 84, borderRadius: '50%' }
    : isLogo
      ? { width: 'auto', maxWidth: 200, height: 56, objectFit: 'contain' }
      : { width: 140, height: 84, objectFit: 'cover', borderRadius: 8 }
  return (
    <div style={{ marginBottom: 10 }}>
      {label && <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, marginBottom: 4 }}>{label}</span>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {preview
          ? <img src={preview} alt={label || 'image'} style={{ ...frame, border: `1px solid ${OPS_COLORS.rule}`, background: OPS_COLORS.ivory }} />
          : <div style={{ ...frame, border: `1px dashed ${OPS_COLORS.rule}`, display: 'grid', placeItems: 'center', fontSize: 11, color: OPS_COLORS.muted, background: OPS_COLORS.ivory }}>No image</div>}
        <label style={{ fontSize: 12.5, color: OPS_COLORS.emerald, fontWeight: 700, cursor: 'pointer' }}>
          {busy ? 'Processing…' : value ? 'Replace photo' : 'Upload photo'}
          <input type="file" accept="image/*" style={{ display: 'none' }} disabled={busy} onChange={pick} />
        </label>
        {value && defaultSrc && <button type="button" onClick={() => onChange('')} style={{ border: 0, background: 'none', color: OPS_COLORS.warn, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>Reset to default</button>}
      </div>
      {hint && <span style={{ display: 'block', fontSize: 11.5, color: OPS_COLORS.muted, marginTop: 4 }}>{hint}</span>}
      {error && <span style={{ display: 'block', fontSize: 12, color: OPS_COLORS.warn, marginTop: 4 }}>{error}</span>}
    </div>
  )
}
