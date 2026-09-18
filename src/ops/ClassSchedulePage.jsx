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
/* Operations > Class schedule — the admin-configurable weekly        */
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
          {' – '}
          <EditableText type="time" small value={timeLabel(session.end_time)} placeholder="—" onSave={(value) => onSave(session, { end_time: value || null })} />
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
            { value: 'active', label: 'Bookable — shown on the site' },
            { value: 'hidden', label: 'Hidden — not bookable' },
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
        emptyState={<EmptyState icon="🗓" title="No classes scheduled" body="Add your first weekly class below — it appears on the booking form as soon as it is marked bookable." />}
      />
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

export default ClassSchedulePage
