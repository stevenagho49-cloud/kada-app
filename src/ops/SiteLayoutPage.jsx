import { useState } from 'react'
import { Toggle, OpsButton, OPS_COLORS } from './ui'

// Admin homepage layout control: show/hide homepage sections and reorder them.
// Rows are persisted to public.site_sections by the parent via onSave.
export function SiteLayoutPage({ sections, onSave }) {
  const [saving, setSaving] = useState(false)
  const ordered = [...sections].sort((a, b) => a.sortOrder - b.sortOrder)

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
      <div className="panel-head">
        <h3>Homepage layout</h3>
        <span style={{ fontSize: 12, color: OPS_COLORS.muted }}>{saving ? 'Saving…' : 'Saved to Supabase'}</span>
      </div>
      <p style={{ color: OPS_COLORS.muted, fontSize: 13, margin: '0 0 14px' }}>
        Toggle sections on or off and reorder them — the live homepage reads this configuration on every visit.
        Changes apply immediately to the public site. The page footer is always shown.
      </p>
      <div style={{ display: 'grid', gap: 8 }}>
        {ordered.map((section, index) => (
          <div
            key={section.sectionKey}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
              border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 8, background: section.visible ? OPS_COLORS.ivory : OPS_COLORS.cream,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <button type="button" aria-label={`Move ${section.label} up`} disabled={index === 0 || saving} onClick={() => move(index, -1)} style={arrowStyle(index === 0 || saving)}>▲</button>
              <button type="button" aria-label={`Move ${section.label} down`} disabled={index === ordered.length - 1 || saving} onClick={() => move(index, 1)} style={arrowStyle(index === ordered.length - 1 || saving)}>▼</button>
            </div>
            <span style={{ width: 26, textAlign: 'center', fontSize: 12, fontWeight: 700, color: OPS_COLORS.muted }}>{index + 1}</span>
            <span style={{ flex: 1, fontWeight: section.visible ? 600 : 500, fontSize: 14, color: section.visible ? OPS_COLORS.ink : OPS_COLORS.muted }}>{section.label}</span>
            {section.sectionKey === 'events' && <span style={{ fontSize: 11, color: OPS_COLORS.muted }}>also auto-hides when no upcoming events</span>}
            <Toggle label={`Show ${section.label} on homepage`} checked={section.visible} onChange={(value) => toggleVisible(section.sectionKey, value)} disabled={saving} />
            <span style={{ fontSize: 11.5, color: OPS_COLORS.muted, width: 46, textAlign: 'right' }}>{section.visible ? 'Shown' : 'Hidden'}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
        <OpsButton small variant="ghost" disabled={saving} onClick={() => persist(ordered.map((section) => ({ ...section, visible: true })))}>Show all sections</OpsButton>
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
