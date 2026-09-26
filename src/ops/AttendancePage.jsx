import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { OpsButton, Pill, EmptyState, OPS_COLORS, OPS_SERIF, opsInputStyle } from './ui'
import { useAttendanceRows, AttendanceDots, friendlyAttendanceError } from './attendanceShared'
import { childStats, sessionStats, trend, overallByDate, formatRate } from './attendanceStats'

/* ------------------------------------------------------------------ */
/* Operations > Attendance. A register built to be used on a phone     */
/* during a live session: pick the class and date, then one tap per    */
/* child. Nobody starts as present or absent ,  unmarked until someone  */
/* checks them in. Past sessions stay editable. Access is the           */
/* 'attendance' staff permission (RLS on the attendance table).        */
/* ------------------------------------------------------------------ */

const DAY_MS = 86400000
function londonToday() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = (type) => parts.find((part) => part.type === type).value
  return `${get('year')}-${get('month')}-${get('day')}`
}
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay()
// The most recent date (today included) that falls on the class's weekday.
const latestClassDate = (dayOfWeek, today = londonToday()) => (dayOfWeek === null || dayOfWeek === undefined ? today : addDays(today, -((weekday(today) - dayOfWeek + 7) % 7)))
const longDate = (value) => new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const shortDate = (value) => new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export function AttendancePage({ session }) {
  const [view, setView] = useState('register')
  const tabStyle = (key) => ({ border: 0, borderBottom: `3px solid ${view === key ? OPS_COLORS.gold : 'transparent'}`, background: 'none', padding: '10px 4px', marginRight: 18, fontFamily: 'inherit', fontSize: 15, fontWeight: 700, color: view === key ? OPS_COLORS.emerald : OPS_COLORS.muted, cursor: 'pointer' })
  return (
    <div>
      <h2 style={{ fontFamily: OPS_SERIF, color: OPS_COLORS.emerald, fontWeight: 400, margin: '0 0 4px' }}>Attendance</h2>
      <div role="tablist" style={{ borderBottom: `1px solid ${OPS_COLORS.rule}`, marginBottom: 14 }}>
        <button type="button" role="tab" aria-selected={view === 'register'} style={tabStyle('register')} onClick={() => setView('register')}>Register</button>
        <button type="button" role="tab" aria-selected={view === 'stats'} style={tabStyle('stats')} onClick={() => setView('stats')}>Statistics</button>
      </div>
      {view === 'register' ? <Register session={session} /> : <Statistics />}
    </div>
  )
}

/* ---------------------------- Register ---------------------------- */

function Register({ session }) {
  const [classes, setClasses] = useState(null)
  const [className, setClassName] = useState('')
  const [date, setDate] = useState('')
  const [children, setChildren] = useState(null)
  const [classStudents, setClassStudents] = useState([])
  const [error, setError] = useState('')
  const [savingIds, setSavingIds] = useState(new Set())
  const requestRef = useRef(0)

  // Scheduled classes, plus any class that only exists in attendance history.
  useEffect(() => {
    Promise.all([
      supabase.from('class_sessions').select('name,day_of_week,start_time,active').order('day_of_week').order('start_time'),
      supabase.from('attendance').select('class_name').limit(1000),
    ]).then(([scheduled, history]) => {
      if (history.error) setError(friendlyAttendanceError(history.error))
      const list = (scheduled.data || []).map((item) => ({ name: item.name, dayOfWeek: item.day_of_week, startTime: String(item.start_time || '').slice(0, 5), active: item.active }))
      for (const name of new Set((history.data || []).map((row) => row.class_name))) {
        if (!list.some((item) => item.name === name)) list.push({ name, dayOfWeek: null, startTime: '', active: false })
      }
      setClasses(list)
      const first = list.find((item) => item.active) || list[0]
      if (first) {
        setClassName(first.name)
        setDate(latestClassDate(first.dayOfWeek))
      }
    })
  }, [])

  const selectedClass = classes?.find((item) => item.name === className)

  const loadRoster = async () => {
    if (!className || !date) return
    const request = requestRef.current + 1
    requestRef.current = request
    setChildren(null)
    const [roster, students] = await Promise.all([
      supabase.rpc('attendance_roster', { p_class: className, p_date: date }),
      supabase.rpc('attendance_class_students', { p_class: className }),
    ])
    if (request !== requestRef.current) return // a newer class/date was picked meanwhile
    if (roster.error) {
      setError(friendlyAttendanceError(roster.error))
      setChildren([])
      return
    }
    setError('')
    setChildren((roster.data || []).map((row) => ({ id: row.student_id, name: row.student_name, plan: row.plan, registered: row.registered, status: row.status || null, markedAt: row.marked_at, markedBy: row.marked_by_name })))
    setClassStudents(students.data || [])
  }
  useEffect(() => { loadRoster() }, [className, date]) // eslint-disable-line react-hooks/exhaustive-deps

  const pickClass = (name) => {
    const next = classes.find((item) => item.name === name)
    setClassName(name)
    setDate(latestClassDate(next?.dayOfWeek))
  }

  const setSaving = (ids, on) => setSavingIds((current) => {
    const next = new Set(current)
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)))
    return next
  })

  // Tap a status to set it; tap the highlighted one again to clear it (mis-tap).
  const mark = async (child, status) => {
    const next = child.status === status ? null : status
    const previous = child
    setChildren((current) => current.map((item) => (item.id === child.id ? { ...item, status: next, markedAt: new Date().toISOString() } : item)))
    setSaving([child.id], true)
    const key = { student_id: child.id, class_name: className, session_date: date }
    const { error: saveError } = next
      ? await supabase.from('attendance').upsert({ ...key, student_name: child.name, status: next, marked_by: session.user.id, marked_at: new Date().toISOString() }, { onConflict: 'student_id,class_name,session_date' })
      : await supabase.from('attendance').delete().match(key)
    setSaving([child.id], false)
    if (saveError) {
      setChildren((current) => current.map((item) => (item.id === child.id ? previous : item)))
      setError(`${child.name} could not be saved: ${friendlyAttendanceError(saveError)}`)
    }
  }

  const markRestAbsent = async () => {
    const rest = children.filter((child) => !child.status)
    if (!rest.length || !window.confirm(`Mark the ${rest.length} unmarked ${rest.length === 1 ? 'child' : 'children'} as absent?`)) return
    const now = new Date().toISOString()
    setChildren((current) => current.map((item) => (item.status ? item : { ...item, status: 'absent', markedAt: now })))
    setSaving(rest.map((child) => child.id), true)
    const { error: saveError } = await supabase.from('attendance').upsert(rest.map((child) => ({ student_id: child.id, student_name: child.name, class_name: className, session_date: date, status: 'absent', marked_by: session.user.id, marked_at: now })), { onConflict: 'student_id,class_name,session_date' })
    setSaving(rest.map((child) => child.id), false)
    if (saveError) {
      setError(`Could not save: ${friendlyAttendanceError(saveError)}`)
      loadRoster()
    }
  }

  const addChild = (studentId) => {
    const student = classStudents.find((item) => item.student_id === studentId)
    if (!student || children.some((child) => child.id === studentId)) return
    setChildren((current) => [...current, { id: student.student_id, name: student.student_name, plan: 'added', registered: false, status: null }].sort((a, b) => a.name.localeCompare(b.name)))
  }

  if (classes === null) return <p style={{ color: OPS_COLORS.muted }}>Loading classes…</p>
  if (!classes.length) return <EmptyState icon="🗓" title="No classes scheduled" body="Add a class in Students > Class schedule, then its register appears here." />

  const today = londonToday()
  const counts = children ? { present: children.filter((child) => child.status === 'present').length, absent: children.filter((child) => child.status === 'absent').length, total: children.length } : null
  const unmarked = counts ? counts.total - counts.present - counts.absent : 0
  const addable = classStudents.filter((student) => !children?.some((child) => child.id === student.student_id))
  const weekly = selectedClass?.dayOfWeek !== null && selectedClass?.dayOfWeek !== undefined
  const offDay = weekly && weekday(date) !== selectedClass.dayOfWeek

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
        <select aria-label="Class" value={className} onChange={(event) => pickClass(event.target.value)} style={{ ...opsInputStyle, fontSize: 16, padding: '12px' }}>
          {classes.map((item) => <option key={item.name} value={item.name}>{item.name}{item.startTime ? ` · ${item.startTime}` : ''}{item.active ? '' : ' (not scheduled)'}</option>)}
        </select>
        <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr 48px', gap: 8 }}>
          <button type="button" aria-label="Previous session" onClick={() => setDate(addDays(date, weekly ? -7 : -1))} style={navButtonStyle}>‹</button>
          <input type="date" aria-label="Session date" value={date} onChange={(event) => event.target.value && setDate(event.target.value)} style={{ ...opsInputStyle, fontSize: 16, padding: '11px 12px', textAlign: 'center' }} />
          <button type="button" aria-label="Next session" onClick={() => setDate(addDays(date, weekly ? 7 : 1))} style={navButtonStyle}>›</button>
        </div>
        <div style={{ fontSize: 13, color: OPS_COLORS.muted }}>
          {longDate(date)}
          {date === today && <strong style={{ color: OPS_COLORS.emerald }}> · Today</strong>}
          {date < today && ' · past session, still editable'}
          {date > today && ' · upcoming'}
          {offDay && <span style={{ color: OPS_COLORS.warn }}> · this class doesn't normally run on this day</span>}
        </div>
      </div>

      {error && <p role="alert" style={{ background: '#f7e9e4', color: OPS_COLORS.warn, padding: '10px 12px', borderRadius: 6, fontSize: 14 }}>{error}</p>}

      {children === null ? <p style={{ color: OPS_COLORS.muted }}>Loading register…</p> : (
        <>
          <div style={{ position: 'sticky', top: 0, zIndex: 2, background: OPS_COLORS.cream, padding: '8px 0', marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: 14 }}>
              <span><strong style={{ color: OPS_COLORS.emerald }}>{counts.present} present</strong> · {counts.absent} absent · <strong style={{ color: unmarked ? OPS_COLORS.warn : OPS_COLORS.muted }}>{unmarked} not marked</strong></span>
              {unmarked > 0 && counts.present + counts.absent > 0 && <OpsButton small variant="ghost" onClick={markRestAbsent}>Mark rest absent</OpsButton>}
            </div>
            <div aria-hidden="true" style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: '#ebe5d4', marginTop: 6, gap: counts.present && counts.absent ? 2 : 0 }}>
              <div style={{ width: `${(counts.present / Math.max(1, counts.total)) * 100}%`, background: OPS_COLORS.emerald }} />
              <div style={{ width: `${(counts.absent / Math.max(1, counts.total)) * 100}%`, background: '#b9b2a2' }} />
            </div>
          </div>

          {!children.length ? (
            <EmptyState icon="🧒" title="Nobody registered for this session" body="Children appear here once they have a Day Pass for this date or an active membership for this class." />
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {children.map((child) => (
                <li key={child.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', borderBottom: `1px solid ${OPS_COLORS.rule}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: OPS_COLORS.ink, overflowWrap: 'anywhere' }}>{child.name}</div>
                    <div style={{ fontSize: 11.5, color: OPS_COLORS.muted }}>
                      {child.plan === 'membership' ? 'Member' : child.plan === 'day_pass' ? 'Day Pass' : 'Added to this register'}
                      {child.markedBy && child.status ? ` · ${child.markedBy}` : ''}
                    </div>
                  </div>
                  <StatusButton label="Present" icon="✓" active={child.status === 'present'} disabled={savingIds.has(child.id)} onClick={() => mark(child, 'present')} tone="present" name={child.name} />
                  <StatusButton label="Absent" icon="✕" active={child.status === 'absent'} disabled={savingIds.has(child.id)} onClick={() => mark(child, 'absent')} tone="absent" name={child.name} />
                </li>
              ))}
            </ul>
          )}

          {addable.length > 0 && (
            <label style={{ display: 'block', marginTop: 16, fontSize: 13, color: OPS_COLORS.muted }}>
              Add a child who isn't listed (e.g. booked by phone)
              <select value="" onChange={(event) => addChild(event.target.value)} style={{ ...opsInputStyle, marginTop: 4, fontSize: 16, padding: '11px 12px' }}>
                <option value="">Choose a child…</option>
                {addable.map((student) => <option key={student.student_id} value={student.student_id}>{student.student_name}</option>)}
              </select>
            </label>
          )}
        </>
      )}
    </div>
  )
}

const navButtonStyle = { border: `1px solid ${OPS_COLORS.rule}`, background: OPS_COLORS.ivory, borderRadius: 6, fontSize: 24, lineHeight: 1, color: OPS_COLORS.emerald, cursor: 'pointer' }

function StatusButton({ label, icon, active, disabled, onClick, tone, name }) {
  const on = tone === 'present' ? { background: OPS_COLORS.emerald, color: OPS_COLORS.ivory, borderColor: OPS_COLORS.emerald } : { background: OPS_COLORS.warn, color: OPS_COLORS.ivory, borderColor: OPS_COLORS.warn }
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${name}: ${label}`}
      disabled={disabled}
      onClick={onClick}
      style={{ minWidth: 84, minHeight: 52, padding: '0 10px', borderRadius: 10, border: `2px solid ${OPS_COLORS.rule}`, background: OPS_COLORS.ivory, color: OPS_COLORS.muted, fontFamily: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', touchAction: 'manipulation', opacity: disabled ? 0.7 : 1, ...(active ? on : {}) }}
    >
      {icon} {label}
    </button>
  )
}

/* --------------------------- Statistics --------------------------- */

function Statistics() {
  const { rows, error } = useAttendanceRows(true)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('rate')

  const data = useMemo(() => {
    if (!rows) return null
    const sessions = sessionStats(rows)
    const classNames = [...new Set(sessions.map((item) => item.className))].sort()
    return {
      sessions,
      overall: trend(overallByDate(sessions)),
      classes: classNames.map((name) => {
        const classSessions = sessions.filter((item) => item.className === name)
        return { name, sessions: classSessions, trend: trend(classSessions) }
      }),
      children: childStats(rows),
    }
  }, [rows])

  const children = useMemo(() => {
    if (!data) return []
    const term = search.trim().toLowerCase()
    const list = data.children.filter((child) => !term || child.name.toLowerCase().includes(term))
    const sorters = {
      rate: (a, b) => (a.rate ?? 2) - (b.rate ?? 2) || a.name.localeCompare(b.name),
      attended: (a, b) => b.present - a.present || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
    }
    return [...list].sort(sorters[sortBy])
  }, [data, search, sortBy])

  if (error) return <p role="alert" style={{ color: OPS_COLORS.warn }}>{error}</p>
  if (!data) return <p style={{ color: OPS_COLORS.muted }}>Loading statistics…</p>
  if (!data.sessions.length) return <EmptyState icon="📊" title="No attendance recorded yet" body="Statistics appear once the first register has been taken." />

  const { overall } = data
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 18 }}>
        <StatTile label="Overall attendance" value={formatRate(overall.average)} note={`${data.sessions.reduce((sum, item) => sum + item.present, 0)} of ${data.sessions.reduce((sum, item) => sum + item.marked, 0)} marks present`} />
        <StatTile label="Last 4 sessions" value={formatRate(overall.recentRate)} note={changeText(overall.change, 'the 4 before')} />
        <StatTile label="Sessions recorded" value={String(data.sessions.length)} note={`${data.classes.length} class${data.classes.length === 1 ? '' : 'es'}`} />
        <StatTile label="Children tracked" value={String(data.children.length)} />
      </div>

      {data.classes.map((item) => <ClassTrend key={item.name} name={item.name} sessions={item.sessions} summary={item.trend} />)}

      <div className="panel">
        <div className="panel-head"><h3>Children</h3></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <input aria-label="Search children" placeholder="Search children" value={search} onChange={(event) => setSearch(event.target.value)} style={{ ...opsInputStyle, flex: '1 1 180px', width: 'auto' }} />
          <select aria-label="Sort children" value={sortBy} onChange={(event) => setSortBy(event.target.value)} style={{ ...opsInputStyle, width: 'auto' }}>
            <option value="rate">Lowest attendance first</option>
            <option value="attended">Most sessions attended</option>
            <option value="name">Name</option>
          </select>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="ops-table">
            <thead><tr><th>Child</th><th>Attended</th><th>Rate</th><th>Last 10</th></tr></thead>
            <tbody>
              {children.map((child) => (
                <tr key={child.studentId}>
                  <td><strong>{child.name}</strong><div style={{ fontSize: 11.5, color: OPS_COLORS.muted }}>Last marked {shortDate(child.lastSession)}</div></td>
                  <td>{child.present} of {child.marked}</td>
                  <td>{child.rate !== null && child.rate < 0.5 ? <Pill text={formatRate(child.rate)} tone="red" /> : formatRate(child.rate)}</td>
                  <td><AttendanceDots history={child.history} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function changeText(change, against) {
  if (change === null) return 'Not enough sessions to compare yet'
  const points = Math.round(change * 100)
  if (points === 0) return `Same as ${against}`
  return `${points > 0 ? '▲' : '▼'} ${Math.abs(points)} pts vs ${against}`
}

function StatTile({ label, value, note }) {
  return (
    <div style={{ background: OPS_COLORS.ivory, border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 8, padding: '10px 14px' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: OPS_COLORS.muted, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: OPS_COLORS.ink, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {note && <div style={{ fontSize: 12, color: OPS_COLORS.muted }}>{note}</div>}
    </div>
  )
}

/* Attendance rate per session for one class: one hue, one axis (0–100%). */
function ClassTrend({ name, sessions, summary }) {
  const [hover, setHover] = useState(null)
  const [showTable, setShowTable] = useState(false)
  const shown = sessions.slice(-16)
  const slot = 40
  const barWidth = 20
  const plotHeight = 140
  const top = 18
  const left = 38
  const width = left + shown.length * slot + 8
  const height = top + plotHeight + 28
  const y = (value) => top + plotHeight * (1 - value)
  const low = new Set(summary.lowSessions.map((item) => item.date))

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head" style={{ flexWrap: 'wrap', gap: 6 }}>
        <h3>{name}</h3>
        <span style={{ fontSize: 13, color: OPS_COLORS.muted }}>Average {formatRate(summary.average)} · {changeText(summary.change, 'previous 4 sessions')}</span>
      </div>
      <p style={{ margin: '0 0 8px', fontSize: 13, color: OPS_COLORS.muted }}>
        Attendance rate per session{sessions.length > shown.length ? ` (last ${shown.length} of ${sessions.length})` : ''}.
        {summary.lowSessions.length > 0 && ` Low turnout: ${summary.lowSessions.map((item) => `${shortDate(item.date)} (${formatRate(item.rate)})`).join(', ')}.`}
      </p>
      <div style={{ overflowX: 'auto', position: 'relative' }}>
        <svg width={width} height={height} role="img" aria-label={`${name} attendance rate by session`} style={{ display: 'block', fontFamily: 'inherit' }}>
          {[0, 0.5, 1].map((tick) => (
            <g key={tick}>
              <line x1={left} x2={width - 4} y1={y(tick)} y2={y(tick)} stroke="#e4ddc9" strokeWidth="1" />
              <text x={left - 6} y={y(tick) + 4} textAnchor="end" fontSize="10.5" fill={OPS_COLORS.muted}>{tick * 100}%</text>
            </g>
          ))}
          {shown.map((item, index) => {
            const x = left + index * slot + (slot - barWidth) / 2
            const barTop = y(item.rate ?? 0)
            const barHeight = Math.max(0, top + plotHeight - barTop)
            const radius = Math.min(4, barHeight)
            const path = barHeight > 0 ? `M${x},${top + plotHeight} V${barTop + radius} Q${x},${barTop} ${x + radius},${barTop} H${x + barWidth - radius} Q${x + barWidth},${barTop} ${x + barWidth},${barTop + radius} V${top + plotHeight} Z` : ''
            const active = hover === index
            return (
              <g key={item.date} onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(index)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${longDate(item.date)}: ${formatRate(item.rate)}, ${item.present} of ${item.marked} present`}>
                <rect x={left + index * slot} y={top} width={slot} height={plotHeight + 28} fill="transparent" />
                {path && <path d={path} fill={OPS_COLORS.emerald} opacity={hover === null || active ? 1 : 0.55} />}
                {low.has(item.date) && <text x={x + barWidth / 2} y={barTop - 5} textAnchor="middle" fontSize="10" fontWeight="700" fill={OPS_COLORS.warn}>low</text>}
                <text x={x + barWidth / 2} y={top + plotHeight + 16} textAnchor="middle" fontSize="10" fill={active ? OPS_COLORS.ink : OPS_COLORS.muted}>{shortDate(item.date)}</text>
              </g>
            )
          })}
        </svg>
        {hover !== null && shown[hover] && (
          <div role="status" style={{ position: 'absolute', top: 0, left: Math.min(left + hover * slot + slot, width - 150), background: OPS_COLORS.ink, color: OPS_COLORS.ivory, borderRadius: 6, padding: '6px 9px', fontSize: 12, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
            <strong>{shortDate(shown[hover].date)}</strong> · {formatRate(shown[hover].rate)}<br />{shown[hover].present} of {shown[hover].marked} present
          </div>
        )}
      </div>
      <button type="button" onClick={() => setShowTable((value) => !value)} style={{ border: 0, background: 'none', padding: 0, marginTop: 8, color: OPS_COLORS.emerald, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>{showTable ? 'Hide table' : 'Show as table'}</button>
      {showTable && (
        <table className="ops-table" style={{ marginTop: 8 }}>
          <thead><tr><th>Session</th><th>Present</th><th>Absent</th><th>Rate</th></tr></thead>
          <tbody>{[...sessions].reverse().map((item) => <tr key={item.date}><td>{longDate(item.date)}</td><td>{item.present}</td><td>{item.absent}</td><td>{formatRate(item.rate)}{low.has(item.date) ? ' · low' : ''}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  )
}
