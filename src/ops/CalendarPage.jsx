import { useMemo, useState } from 'react'
import { OPS_COLORS, Pill } from './ui'

/* ------------------------------------------------------------------ */
/* Operations > Calendar — weekly/monthly view of bookings + events.   */
/* Clicking a booking opens it in the booking modal; clicking a day    */
/* with no items offers to create an event on that date.               */
/* ------------------------------------------------------------------ */

const DAY_NAMES_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function toIso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function startOfWeek(date) {
  const copy = new Date(date)
  const day = (copy.getDay() + 6) % 7 // Monday-first
  copy.setDate(copy.getDate() - day)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function addDays(date, days) {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}

export function CalendarPage({ bookings, events, instructors, onOpenBooking, onAddEvent }) {
  const [mode, setMode] = useState('week') // 'week' | 'month'
  const [cursor, setCursor] = useState(() => new Date())
  const todayIso = toIso(new Date())

  const bookingsByDate = useMemo(() => {
    const map = {}
    bookings.forEach((booking) => {
      if (!booking.date || booking.status === 'Cancelled') return
      map[booking.date] = [...(map[booking.date] || []), { kind: 'booking', item: booking }]
    })
    return map
  }, [bookings])

  const eventsByDate = useMemo(() => {
    const map = {}
    events.forEach((event) => {
      if (!event.eventDate) return
      map[event.eventDate] = [...(map[event.eventDate] || []), { kind: 'event', item: event }]
    })
    return map
  }, [events])

  const itemsFor = (iso) => [...(bookingsByDate[iso] || []), ...(eventsByDate[iso] || [])]

  const instructorName = (id) => instructors.find((instructor) => instructor.id === id)?.name || ''

  const navigate = (direction) => {
    setCursor((current) => mode === 'week' ? addDays(current, direction * 7) : new Date(current.getFullYear(), current.getMonth() + direction, 1))
  }

  const renderItem = ({ kind, item }) => {
    if (kind === 'event') {
      return (
        <div key={`event-${item.id}`} style={{ background: '#faf1d9', border: '1px solid #e8d9a8', borderRadius: 6, padding: '4px 7px', fontSize: 11.5, marginBottom: 4 }}>
          <strong style={{ color: '#8a6d10' }}>🎟 {item.title}</strong>
          {item.eventTime && <span style={{ color: OPS_COLORS.muted }}> · {item.eventTime}</span>}
        </div>
      )
    }
    const assigned = instructorName(item.instructorId)
    return (
      <button key={`booking-${item.id}`} type="button" onClick={() => onOpenBooking(item)} style={{ display: 'block', width: '100%', textAlign: 'left', background: item.status === 'Confirmed' ? '#e6f0e9' : '#f1eee2', border: '1px solid #e4ddc9', borderRadius: 6, padding: '4px 7px', fontSize: 11.5, marginBottom: 4, cursor: 'pointer', fontFamily: 'inherit' }}>
        <strong style={{ color: OPS_COLORS.emerald }}>{item.sessionType}</strong>
        <br />
        <span style={{ color: OPS_COLORS.muted }}>{item.contactName || 'Booking'}{assigned ? ` · ${assigned}` : ' · Unassigned'}</span>
      </button>
    )
  }

  const weekStart = startOfWeek(cursor)
  const weekDays = [...Array(7)].map((_, index) => addDays(weekStart, index))

  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const monthGridStart = startOfWeek(monthStart)
  const monthWeeks = []
  for (let week = 0; week < 6; week += 1) {
    const days = [...Array(7)].map((_, index) => addDays(monthGridStart, week * 7 + index))
    monthWeeks.push(days)
    if (days[6].getMonth() === cursor.getMonth() && days[6].getDate() >= new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()) break
  }

  const heading = mode === 'week'
    ? `${weekDays[0].getDate()} ${MONTH_NAMES[weekDays[0].getMonth()].slice(0, 3)} – ${weekDays[6].getDate()} ${MONTH_NAMES[weekDays[6].getMonth()].slice(0, 3)} ${weekDays[6].getFullYear()}`
    : `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`

  const cellStyle = (iso, inMonth = true) => ({
    minHeight: mode === 'week' ? 150 : 96,
    border: `1px solid ${OPS_COLORS.rule}`,
    borderRadius: 8,
    padding: 6,
    background: iso === todayIso ? '#fff8e8' : inMonth ? OPS_COLORS.ivory : OPS_COLORS.cream,
    opacity: inMonth ? 1 : 0.45,
    verticalAlign: 'top',
  })

  const dayCell = (date, inMonth = true) => {
    const iso = toIso(date)
    const items = itemsFor(iso)
    return (
      <div key={iso} style={cellStyle(iso, inMonth)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: iso === todayIso ? '#8a6d10' : OPS_COLORS.ink }}>{date.getDate()}</span>
          {items.length === 0 && (
            <button type="button" title="Add event on this date" onClick={() => onAddEvent(iso)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: OPS_COLORS.muted, fontSize: 13, padding: 0, lineHeight: 1 }}>+</button>
          )}
        </div>
        {items.map(renderItem)}
      </div>
    )
  }

  const bookedCount = bookings.filter((booking) => booking.status !== 'Cancelled').length
  const eventsCount = events.length

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Calendar</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Pill text={`${bookedCount} bookings`} tone="green" />
          <Pill text={`${eventsCount} events`} tone="gold" />
          <div style={{ display: 'flex', border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 6, overflow: 'hidden' }}>
            {['week', 'month'].map((option) => (
              <button key={option} type="button" onClick={() => setMode(option)} style={{ border: 'none', padding: '6px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: mode === option ? OPS_COLORS.emerald : 'transparent', color: mode === option ? OPS_COLORS.ivory : OPS_COLORS.ink }}>{option === 'week' ? 'Week' : 'Month'}</button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 14px' }}>
        <button type="button" onClick={() => navigate(-1)} style={navButtonStyle}>← Previous</button>
        <strong style={{ fontSize: 15, color: OPS_COLORS.emerald }}>{heading}</strong>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => setCursor(new Date())} style={navButtonStyle}>Today</button>
          <button type="button" onClick={() => navigate(1)} style={navButtonStyle}>Next →</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {DAY_NAMES_SHORT.map((name) => <div key={name} style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: OPS_COLORS.muted, textAlign: 'center', paddingBottom: 2 }}>{name}</div>)}
        {mode === 'week'
          ? weekDays.map((date) => dayCell(date, true))
          : monthWeeks.flatMap((week) => week.map((date) => dayCell(date, date.getMonth() === cursor.getMonth())))}
      </div>
      <p style={{ color: OPS_COLORS.muted, fontSize: 12, marginTop: 12 }}>
        Bookings show the assigned instructor (click to open the booking). Event days are highlighted in gold. Press + on an empty day to draft an event for that date.
      </p>
    </div>
  )
}

const navButtonStyle = {
  border: `1px solid ${OPS_COLORS.rule}`, background: 'transparent', borderRadius: 6,
  padding: '6px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
  color: OPS_COLORS.emerald, fontFamily: 'inherit',
}

export default CalendarPage
