import { useEffect, useState } from 'react'
import { OpsButton, Pill, OPS_COLORS, opsInputStyle } from './ui'

/* ------------------------------------------------------------------ */
/* Operations > Session types ('sessions' permission). An open list of  */
/* session types ("2 Full Days", "Half Day Intensive", ...) that staff  */
/* schedule on one or more dates. Scheduling posts to the job board at  */
/* once, as one combined job (claimed together) or one job per date     */
/* (claimed independently), and the dates appear on the Calendar.       */
/* ------------------------------------------------------------------ */

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, marginBottom: 4 }
const cardStyle = { border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 10, padding: 16, background: OPS_COLORS.ivory, marginBottom: 14 }
const blankDate = () => ({ date: '', startTime: '09:00', endTime: '15:00' })
const emptyType = { name: '', description: '', defaultPrice: '', defaultInstructorPay: '' }
const emptySchedule = (type) => ({ dates: [blankDate()], postingMode: '', instructorPayPerDay: type?.default_instructor_pay ?? '', studentCount: '', schoolId: '', locationArea: '', title: '', notes: '' })
const money = (value) => `£${Number(value || 0).toFixed(2)}`
const dayLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const jobTone = { open: 'gold', pending: 'gold', accepted: 'green', rejected: 'red' }

function Field({ label, children, style }) {
  return <label style={{ display: 'block', ...style }}><span style={labelStyle}>{label}</span>{children}</label>
}

// The dates and how they go on the job board. Shared by "new type" and "schedule again".
function ScheduleFields({ value, onChange, schools }) {
  const set = (changes) => onChange({ ...value, ...changes })
  const setDate = (index, changes) => set({ dates: value.dates.map((item, itemIndex) => (itemIndex === index ? { ...item, ...changes } : item)) })
  const multi = value.dates.length > 1
  return (
    <div>
      <span style={labelStyle}>Dates and times</span>
      {value.dates.map((item, index) => (
        <div key={index} style={{ display: 'grid', gridTemplateColumns: '70px minmax(140px, 1fr) 110px 110px auto', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 13, color: OPS_COLORS.muted }}>Day {index + 1}</span>
          <input type="date" aria-label={`Day ${index + 1} date`} style={opsInputStyle} value={item.date} onChange={(event) => setDate(index, { date: event.target.value })} />
          <input type="time" aria-label={`Day ${index + 1} start`} style={opsInputStyle} value={item.startTime} onChange={(event) => setDate(index, { startTime: event.target.value })} />
          <input type="time" aria-label={`Day ${index + 1} end`} style={opsInputStyle} value={item.endTime} onChange={(event) => setDate(index, { endTime: event.target.value })} />
          {value.dates.length > 1 ? <button type="button" aria-label={`Remove day ${index + 1}`} onClick={() => set({ dates: value.dates.filter((_, itemIndex) => itemIndex !== index) })} style={{ border: 0, background: 'none', color: OPS_COLORS.warn, cursor: 'pointer', fontSize: 18 }}>×</button> : <span />}
        </div>
      ))}
      <OpsButton small variant="ghost" onClick={() => set({ dates: [...value.dates, { ...blankDate(), startTime: value.dates.at(-1)?.startTime || '09:00', endTime: value.dates.at(-1)?.endTime || '15:00' }] })}>+ Add another date</OpsButton>

      {multi && (
        <fieldset style={{ border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 8, padding: '10px 12px', margin: '12px 0 0' }}>
          <legend style={{ ...labelStyle, padding: '0 4px', marginBottom: 0 }}>How should it go on the job board?</legend>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13.5, marginBottom: 6, cursor: 'pointer' }}>
            <input type="radio" name="postingMode" checked={value.postingMode === 'combined'} onChange={() => set({ postingMode: 'combined' })} style={{ marginTop: 3 }} />
            <span><strong>Post as one combined job</strong><br /><span style={{ color: OPS_COLORS.muted, fontSize: 12.5 }}>One instructor claims all {value.dates.length} dates together; nobody can take just one day.</span></span>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13.5, cursor: 'pointer' }}>
            <input type="radio" name="postingMode" checked={value.postingMode === 'separate'} onChange={() => set({ postingMode: 'separate' })} style={{ marginTop: 3 }} />
            <span><strong>Post as separate jobs</strong><br /><span style={{ color: OPS_COLORS.muted, fontSize: 12.5 }}>Each date is its own listing, so different instructors can take different days (or one can claim several).</span></span>
          </label>
        </fieldset>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 12 }}>
        <Field label="Instructor pay per day (£)"><input type="number" min="1" step="0.01" style={opsInputStyle} value={value.instructorPayPerDay} onChange={(event) => set({ instructorPayPerDay: event.target.value })} /></Field>
        <Field label="Students (approx.)"><input type="number" min="0" style={opsInputStyle} value={value.studentCount} onChange={(event) => set({ studentCount: event.target.value })} /></Field>
        <Field label="School (optional)"><select style={opsInputStyle} value={value.schoolId} onChange={(event) => set({ schoolId: event.target.value })}><option value="">No school / internal</option>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></Field>
        <Field label="Area shown to instructors"><input style={opsInputStyle} placeholder="e.g. North Birmingham" value={value.locationArea} onChange={(event) => set({ locationArea: event.target.value })} /></Field>
      </div>
      <Field label="Notes (internal, optional)" style={{ marginTop: 10 }}><input style={opsInputStyle} value={value.notes} onChange={(event) => set({ notes: event.target.value })} /></Field>
      {multi && value.postingMode && Number(value.instructorPayPerDay) > 0 && (
        <p style={{ margin: '10px 0 0', fontSize: 12.5, color: OPS_COLORS.muted }}>
          {value.postingMode === 'combined'
            ? `Posts 1 job paying ${money(Number(value.instructorPayPerDay) * value.dates.length)} for all ${value.dates.length} days.`
            : `Posts ${value.dates.length} jobs paying ${money(value.instructorPayPerDay)} each.`}
        </p>
      )}
    </div>
  )
}

const scheduleReady = (value) => value.dates.every((item) => item.date) && Number(value.instructorPayPerDay) > 0 && (value.dates.length === 1 || value.postingMode)
const schedulePayload = (value) => ({ ...value, postingMode: value.dates.length === 1 ? 'combined' : value.postingMode, studentCount: Number(value.studentCount) || 0 })

export function SessionTypesPage({ session, onChanged }) {
  const [types, setTypes] = useState([])
  const [schools, setSchools] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [creating, setCreating] = useState(null) // { type, scheduleNow, schedule }
  const [editing, setEditing] = useState(null) // type draft with id
  const [scheduling, setScheduling] = useState(null) // { type, schedule }
  const [busy, setBusy] = useState(false)

  const request = async (path, body) => {
    const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${session.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) { const failure = new Error(result.error || 'Request failed.'); failure.result = result; throw failure }
    return result
  }
  const load = async () => {
    try {
      const result = await request('/api/session-types')
      setTypes(result.types || [])
      setSchools(result.schools || [])
      setError('')
    } catch (loadError) {
      setError(loadError.message)
    }
    setLoading(false)
  }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (action, success) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await action()
      setNotice(success(result))
      await load()
      onChanged?.()
      return true
    } catch (actionError) {
      setError(actionError.message)
      return false
    } finally {
      setBusy(false)
    }
  }
  const posted = (result) => (result.jobs ? ` ${result.jobs.length === 1 ? '1 job' : `${result.jobs.length} jobs`} posted to the job board and added to the calendar.` : '')

  const createType = () => run(
    () => request('/api/session-types', { ...creating.type, ...(creating.scheduleNow ? { schedule: schedulePayload(creating.schedule) } : {}) }),
    (result) => `"${result.type.name}" created.${posted(result)}`,
  ).then((ok) => ok && setCreating(null))
  const saveType = () => run(() => request('/api/session-types', editing), (result) => `"${result.type.name}" saved.`).then((ok) => ok && setEditing(null))
  const toggleActive = (type) => run(() => request('/api/session-types', { id: type.id, name: type.name, description: type.description, defaultPrice: type.default_price, defaultInstructorPay: type.default_instructor_pay, active: !type.active }), () => `"${type.name}" ${type.active ? 'switched off' : 'switched on'}.`)
  const scheduleType = () => run(() => request(`/api/session-types/${scheduling.type.id}/schedule`, schedulePayload(scheduling.schedule)), (result) => `"${scheduling.type.name}" scheduled.${posted(result)}`).then((ok) => ok && setScheduling(null))
  const cancelSession = async (scheduled) => {
    if (!window.confirm(`Cancel "${scheduled.title}" on ${scheduled.dates.map((item) => dayLabel(item.session_date)).join(', ')}? Its jobs come off the job board.`)) return
    setBusy(true)
    try {
      await request(`/api/scheduled-sessions/${scheduled.id}/cancel`, {})
    } catch (cancelError) {
      if (cancelError.result?.needsForce && window.confirm(cancelError.message)) await request(`/api/scheduled-sessions/${scheduled.id}/cancel`, { force: true }).catch((forceError) => setError(forceError.message))
      else if (!cancelError.result?.needsForce) setError(cancelError.message)
    }
    setBusy(false)
    await load()
    onChanged?.()
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Session types</h3>
        {!creating && <OpsButton small onClick={() => { setCreating({ type: { ...emptyType }, scheduleNow: true, schedule: emptySchedule() }); setNotice('') }}>+ New session type</OpsButton>}
      </div>
      <p style={{ color: OPS_COLORS.muted, fontSize: 13, margin: '0 0 14px' }}>Your own list of session types. Schedule one on as many dates as it needs: it goes straight onto the job board for instructors to claim and onto the calendar.</p>
      {error && <p role="alert" style={{ color: OPS_COLORS.warn, fontSize: 13 }}>{error}</p>}
      {notice && <p role="status" style={{ color: '#2e6b47', fontSize: 13 }}>{notice}</p>}

      {creating && (
        <div style={cardStyle}>
          <h4 style={{ margin: '0 0 10px', color: OPS_COLORS.emerald }}>New session type</h4>
          <TypeFields value={creating.type} onChange={(type) => setCreating({ ...creating, type, schedule: creating.schedule.instructorPayPerDay === '' && type.defaultInstructorPay ? { ...creating.schedule, instructorPayPerDay: type.defaultInstructorPay } : creating.schedule })} />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, margin: '14px 0 10px' }}><input type="checkbox" checked={creating.scheduleNow} onChange={(event) => setCreating({ ...creating, scheduleNow: event.target.checked })} /> Schedule dates now and post to the job board</label>
          {creating.scheduleNow && <ScheduleFields value={creating.schedule} onChange={(schedule) => setCreating({ ...creating, schedule })} schools={schools} />}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <OpsButton disabled={busy || !creating.type.name.trim() || (creating.scheduleNow && !scheduleReady(creating.schedule))} onClick={createType}>{busy ? 'Saving…' : creating.scheduleNow ? 'Create and post to job board' : 'Create session type'}</OpsButton>
            <OpsButton variant="ghost" onClick={() => setCreating(null)}>Cancel</OpsButton>
          </div>
        </div>
      )}

      {loading ? <p style={{ color: OPS_COLORS.muted }}>Loading…</p> : !types.length && !creating ? <p style={{ color: OPS_COLORS.muted }}>No session types yet. Add your first one above.</p> : types.map((type) => (
        <div key={type.id} style={{ ...cardStyle, opacity: type.active ? 1 : 0.65 }} data-session-type={type.name}>
          {editing?.id === type.id ? (
            <>
              <TypeFields value={editing} onChange={setEditing} />
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}><OpsButton small disabled={busy || !editing.name.trim()} onClick={saveType}>Save</OpsButton><OpsButton small variant="ghost" onClick={() => setEditing(null)}>Cancel</OpsButton></div>
            </>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <strong style={{ fontSize: 16, color: OPS_COLORS.emerald }}>{type.name}</strong>{!type.active && <span style={{ marginLeft: 8 }}><Pill text="Off" /></span>}
                {type.description && <div style={{ fontSize: 13, color: OPS_COLORS.muted }}>{type.description}</div>}
                <div style={{ fontSize: 12.5, color: OPS_COLORS.muted, marginTop: 2 }}>{type.default_price !== null ? `Price ${money(type.default_price)}` : 'No set price'}{type.default_instructor_pay !== null ? ` · Instructor pay ${money(type.default_instructor_pay)}/day` : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {type.active && <OpsButton small onClick={() => setScheduling({ type, schedule: emptySchedule(type) })}>Schedule dates</OpsButton>}
                <OpsButton small variant="ghost" onClick={() => setEditing({ id: type.id, name: type.name, description: type.description || '', defaultPrice: type.default_price ?? '', defaultInstructorPay: type.default_instructor_pay ?? '', active: type.active })}>Edit</OpsButton>
                <OpsButton small variant="ghost" onClick={() => toggleActive(type)}>{type.active ? 'Switch off' : 'Switch on'}</OpsButton>
              </div>
            </div>
          )}

          {scheduling?.type.id === type.id && (
            <div style={{ borderTop: `1px solid ${OPS_COLORS.rule}`, marginTop: 12, paddingTop: 12 }}>
              <ScheduleFields value={scheduling.schedule} onChange={(schedule) => setScheduling({ ...scheduling, schedule })} schools={schools} />
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}><OpsButton disabled={busy || !scheduleReady(scheduling.schedule)} onClick={scheduleType}>{busy ? 'Posting…' : 'Schedule and post to job board'}</OpsButton><OpsButton variant="ghost" onClick={() => setScheduling(null)}>Cancel</OpsButton></div>
            </div>
          )}

          {type.sessions.filter((item) => item.status === 'scheduled').map((scheduled) => (
            <div key={scheduled.id} style={{ borderTop: `1px solid ${OPS_COLORS.rule}`, marginTop: 12, paddingTop: 10, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }} data-scheduled-session={scheduled.id}>
              <div style={{ fontSize: 13 }}>
                <strong>{scheduled.title}</strong>{scheduled.schoolName ? ` · ${scheduled.schoolName}` : ''} <Pill text={scheduled.dates.length > 1 ? (scheduled.posting_mode === 'combined' ? '🔗 One combined job' : `${scheduled.jobs.length} separate jobs`) : '1 job'} tone="default" />
                {scheduled.dates.map((item) => {
                  const job = scheduled.jobs.find((entry) => (entry.session_dates || []).some((dateEntry) => dateEntry.id === item.id))
                  return <div key={item.id} style={{ color: OPS_COLORS.ink, marginTop: 3 }}>Day {item.position}: {dayLabel(item.session_date)}{item.start_time ? ` · ${item.start_time.slice(0, 5)}${item.end_time ? `–${item.end_time.slice(0, 5)}` : ''}` : ''} · <span style={{ color: OPS_COLORS.muted }}>{item.instructorName ? `Instructor: ${item.instructorName}` : job?.status === 'pending' ? `Claimed by ${job.claimedByName}, awaiting acceptance` : job?.status === 'rejected' ? 'Claim rejected' : 'On the job board'}</span></div>
                })}
              </div>
              <div><OpsButton small variant="danger" disabled={busy} onClick={() => cancelSession(scheduled)}>Cancel</OpsButton></div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function TypeFields({ value, onChange }) {
  const set = (changes) => onChange({ ...value, ...changes })
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
      <Field label="Name"><input style={opsInputStyle} placeholder="e.g. 2 Full Days" value={value.name} onChange={(event) => set({ name: event.target.value })} /></Field>
      <Field label="Description (optional)"><input style={opsInputStyle} value={value.description} onChange={(event) => set({ description: event.target.value })} /></Field>
      <Field label="Price to schools (£, optional)"><input type="number" min="0" step="0.01" style={opsInputStyle} value={value.defaultPrice} onChange={(event) => set({ defaultPrice: event.target.value })} /></Field>
      <Field label="Usual instructor pay per day (£, optional)"><input type="number" min="0" step="0.01" style={opsInputStyle} value={value.defaultInstructorPay} onChange={(event) => set({ defaultInstructorPay: event.target.value })} /></Field>
    </div>
  )
}

export default SessionTypesPage
