import React, { useState } from 'react'
import { DataTable, EditableText, EditableSelect, StatusMenu, OpsButton, EmptyState, OPS_COLORS, opsInputStyle } from './ui'

const DAY_OPTIONS = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
]

function timeLabel(value) {
  return value ? String(value).slice(0, 5) : ''
}

/* ------------------------------------------------------------------ */
/* Operations > Class schedule ,  the admin-configurable weekly        */
/* timetable. The public booking form only lets parents pick dates    */
/* that match an active session's day of week.                        */
/* ------------------------------------------------------------------ */
export function ClassSchedulePage({ sessions, onSave, onAdd, onDelete }) {
  const [draft, setDraft] = useState({ name: '', day_of_week: '6', start_time: '10:00', end_time: '11:00', description: '' })
  const [adding, setAdding] = useState(false)

  const canAdd = draft.name.trim() && draft.start_time
  const submitAdd = async () => {
    if (!canAdd) return
    setAdding(true)
    try {
      await onAdd({ ...draft, name: draft.name.trim(), description: draft.description.trim() })
      setDraft({ name: '', day_of_week: '6', start_time: '10:00', end_time: '11:00', description: '' })
    } finally {
      setAdding(false)
    }
  }

  const columns = [
    {
      key: 'class', label: 'Class', render: (session) => (
        <div>
          <EditableText value={session.name} onSave={(value) => onSave(session, { name: value })} />
          <div style={{ marginTop: 3 }}>
            <EditableText small value={session.description} placeholder="Add a description" onSave={(value) => onSave(session, { description: value })} />
          </div>
        </div>
      ),
    },
    {
      key: 'day', label: 'Day', render: (session) => (
        <EditableSelect value={String(session.day_of_week)} options={DAY_OPTIONS} onSave={(value) => onSave(session, { day_of_week: Number(value) })} />
      ),
    },
    {
      key: 'time', label: 'Time', render: (session) => (
        <span style={{ color: OPS_COLORS.ink, whiteSpace: 'nowrap' }}>
          <EditableText type="time" value={timeLabel(session.start_time)} onSave={(value) => onSave(session, { start_time: value })} />
          {'  to  '}
          <EditableText type="time" small value={timeLabel(session.end_time)} placeholder="Not set" onSave={(value) => onSave(session, { end_time: value || null })} />
        </span>
      ),
    },
    {
      key: 'status', label: 'Booking', render: (session) => (
        <StatusMenu
          value={session.active ? 'active' : 'hidden'}
          label={session.active ? 'Bookable' : 'Hidden'}
          tone={session.active ? 'green' : 'default'}
          options={[
            { value: 'active', label: 'Bookable: shown on the site' },
            { value: 'hidden', label: 'Hidden: not bookable' },
          ]}
          onChange={(value) => onSave(session, { active: value === 'active' })}
        />
      ),
    },
    {
      key: 'actions', label: '', render: (session) => (
        <OpsButton small variant="danger" onClick={() => { if (window.confirm(`Remove "${session.name}" from the schedule? Parents will no longer be able to book it.`)) onDelete(session) }}>Remove</OpsButton>
      ),
    },
  ]

  return (
    <div className="panel">
      <div className="panel-head"><h3>Class schedule</h3></div>
      <p style={{ color: OPS_COLORS.muted, fontSize: 13, lineHeight: 1.55, margin: '0 0 16px' }}>
        The weekly timetable parents can book. The public booking form only offers dates that fall on an active class's day of the week, up to 12 weeks ahead.
      </p>
      <DataTable
        columns={columns}
        rows={sessions}
        expanded
        onToggleExpand={() => {}}
        pageSize={1000}
        emptyState={<EmptyState icon="🗓" title="No classes scheduled" body="Add your first weekly class below. It appears on the booking form as soon as it is marked bookable." />}
      />
      {sessions.length > 0 && <PosterDetails sessions={sessions} onSave={onSave} />}
      <div style={{ marginTop: 20, borderTop: `1px solid ${OPS_COLORS.rule}`, paddingTop: 16 }}>
        <h4 style={{ margin: '0 0 12px', fontSize: 14, color: OPS_COLORS.emerald }}>Add a weekly class</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <input style={opsInputStyle} placeholder="Class name (e.g. Saturday Gospel Afrobeats)" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <select style={opsInputStyle} value={draft.day_of_week} onChange={(event) => setDraft({ ...draft, day_of_week: event.target.value })}>
            {DAY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <input style={opsInputStyle} type="time" value={draft.start_time} onChange={(event) => setDraft({ ...draft, start_time: event.target.value })} aria-label="Start time" />
          <input style={opsInputStyle} type="time" value={draft.end_time} onChange={(event) => setDraft({ ...draft, end_time: event.target.value })} aria-label="End time" />
          <input style={{ ...opsInputStyle, gridColumn: '1 / -1' }} placeholder="Description (optional)" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        </div>
        <div style={{ marginTop: 12 }}>
          <OpsButton variant="gold" disabled={!canAdd || adding} onClick={submitAdd}>{adding ? 'Adding…' : 'Add class'}</OpsButton>
        </div>
      </div>
    </div>
  )
}

/* Poster details: every word on the Social Studio weekly class poster comes  */
/* from these fields (plus the class name, day and start time above), and the */
/* poster's QR code is generated from the booking link.                       */
const POSTER_FIELDS = [
  ['category_label', 'Category', 'e.g. Dance Fitness'],
  ['tagline', 'Tagline', 'e.g. When praise meets fitness'],
  ['instructor_first_name', "Instructor's first name", 'Shown large across the photo'],
  ['city', 'City', 'e.g. Birmingham'],
  ['venue_name', 'Venue', 'e.g. North Birmingham Academy'],
  ['venue_postcode', 'Postcode', 'e.g. B44 0HF'],
  ['levels_note', 'Levels line', 'e.g. All levels welcome, no dance experience needed'],
  ['booking_url', 'Booking link (QR code points here)', 'https://kingsarkdance.com/#classes'],
  ['instagram_handle', 'Instagram handle', '@kingsarkdance'],
]

function PosterDetails({ sessions, onSave }) {
  const [classId, setClassId] = useState(sessions[0]?.id || '')
  const current = sessions.find((session) => session.id === classId) || sessions[0]
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const values = form && form.id === current?.id ? form : {
    id: current?.id,
    audience: current?.audience || 'kids',
    ...Object.fromEntries(POSTER_FIELDS.map(([key]) => [key, current?.[key] || ''])),
    price_lines: (current?.price_lines || []).join('\n'),
  }
  const set = (changes) => setForm({ ...values, ...changes })
  const save = async () => {
    if (values.booking_url && !/^https?:\/\/\S+$/.test(values.booking_url.trim())) { window.alert('The booking link must start with https://'); return }
    setSaving(true)
    try {
      await onSave(current, {
        audience: values.audience,
        ...Object.fromEntries(POSTER_FIELDS.map(([key]) => [key, values[key].trim() || null])),
        price_lines: values.price_lines.split('\n').map((line) => line.trim()).filter(Boolean),
      })
      setForm(null)
    } finally {
      setSaving(false)
    }
  }
  if (!current) return null
  return (
    <div style={{ marginTop: 20, borderTop: `1px solid ${OPS_COLORS.rule}`, paddingTop: 16 }}>
      <h4 style={{ margin: '0 0 6px', fontSize: 14, color: OPS_COLORS.emerald }}>Poster details</h4>
      <p style={{ color: OPS_COLORS.muted, fontSize: 13, lineHeight: 1.55, margin: '0 0 12px' }}>Used by the weekly class poster in Social Studio. A poster with a missing field can't be exported.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 10 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald }}>Class
          <select style={{ ...opsInputStyle, marginTop: 4 }} value={current.id} onChange={(event) => { setClassId(event.target.value); setForm(null) }}>
            {sessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald }}>Audience
          <select style={{ ...opsInputStyle, marginTop: 4 }} value={values.audience} onChange={(event) => set({ audience: event.target.value })}>
            <option value="kids">Children</option>
            <option value="adults">Adults</option>
          </select>
        </label>
        {POSTER_FIELDS.map(([key, label, placeholder]) => (
          <label key={key} style={{ fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald }}>{label}
            <input style={{ ...opsInputStyle, marginTop: 4 }} placeholder={placeholder} value={values[key]} onChange={(event) => set({ [key]: event.target.value })} />
          </label>
        ))}
        <label style={{ fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, gridColumn: '1 / -1' }}>Price lines (one per line; leave empty to use the class prices from Stripe)
          <textarea rows={2} style={{ ...opsInputStyle, marginTop: 4 }} placeholder={'£10 per class\n£30 a month'} value={values.price_lines} onChange={(event) => set({ price_lines: event.target.value })} />
        </label>
      </div>
      <div style={{ marginTop: 12 }}>
        <OpsButton disabled={saving || !form} onClick={save}>{saving ? 'Saving…' : 'Save poster details'}</OpsButton>
      </div>
    </div>
  )
}

export default ClassSchedulePage
