import { useState } from 'react'

/* Shared class-date picker ,  only days the admin has actually scheduled a    */
/* class (its day_of_week) are selectable, today through +12 weeks, and a     */
/* class that has already finished today stops being bookable. Used by both   */
/* the public homepage booking form and the parent portal booking form.       */

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const BOOKING_WINDOW_DAYS = 84 // 12 weeks ahead

export function startOfToday() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

function toLocalIso(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

// True when `date` is today and this class's end time has already passed , 
// a finished class must not remain bookable for the rest of the day.
export function classEndedOnDate(session, date) {
  if (!session || !date) return false
  const endTime = session.end_time || session.start_time
  if (!endTime) return false
  const todayStart = startOfToday()
  if (date.getTime() !== todayStart.getTime()) return false
  const [hours, minutes] = String(endTime).split(':').map(Number)
  const endedAt = new Date(todayStart)
  endedAt.setHours(hours || 0, minutes || 0, 0, 0)
  return new Date() >= endedAt
}

// Nearest date (today or later) on which the given class session actually runs
// and has not already finished.
export function nextClassDate(session, from = startOfToday()) {
  if (!session) return ''
  for (let offset = 0; offset <= BOOKING_WINDOW_DAYS; offset += 1) {
    const candidate = new Date(from)
    candidate.setDate(from.getDate() + offset)
    if (candidate.getDay() === Number(session.day_of_week) && !classEndedOnDate(session, candidate)) return toLocalIso(candidate)
  }
  return ''
}

/* Month-grid date picker. Only dates matching the chosen class's scheduled
   day of week (today → +12 weeks) are selectable; every other day is off. */
export function ClassDatePicker({ session, value, onChange }) {
  const todayStart = startOfToday()
  const maxDate = new Date(todayStart)
  maxDate.setDate(maxDate.getDate() + BOOKING_WINDOW_DAYS)
  const todayIsEndedClassDay = Boolean(session) && todayStart.getDay() === Number(session?.day_of_week) && classEndedOnDate(session, todayStart)
  const selected = value ? new Date(`${value}T00:00:00`) : null
  const [month, setMonth] = useState(() => {
    const base = selected && !Number.isNaN(selected.getTime()) && selected > todayStart ? selected : todayStart
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })

  const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1)
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7 // Monday-first grid
  const cells = [...Array(leadingBlanks).fill(null)]
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(month.getFullYear(), month.getMonth(), day))
  const earliestMonth = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1)
  const canGoBack = firstOfMonth > earliestMonth
  const canGoForward = new Date(month.getFullYear(), month.getMonth() + 1, 1) <= maxDate

  return (
    <div className="class-date-picker">
      <div className="class-date-picker-head">
        <button type="button" aria-label="Previous month" disabled={!canGoBack} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
        <strong>{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</strong>
        <button type="button" aria-label="Next month" disabled={!canGoForward} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
      </div>
      <div className="class-date-grid class-date-weekdays">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="class-date-grid">
        {cells.map((date, index) => {
          if (!date) return <span key={`blank-${index}`} className="class-date-cell empty" aria-hidden="true" />
          const iso = toLocalIso(date)
          const enabled = Boolean(session) && date >= todayStart && date <= maxDate && date.getDay() === Number(session.day_of_week) && !classEndedOnDate(session, date)
          const isSelected = value === iso
          return (
            <button key={iso} type="button" className={`class-date-cell${isSelected ? ' selected' : ''}`} disabled={!enabled} aria-pressed={isSelected} aria-label={date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} onClick={() => onChange(iso)}>
              {date.getDate()}
            </button>
          )
        })}
      </div>
      <p className="class-date-hint">
        {session
          ? `${session.name} runs every ${DAY_NAMES[Number(session.day_of_week)]}${session.start_time ? `, ${String(session.start_time).slice(0, 5)}${session.end_time ? ` to ${String(session.end_time).slice(0, 5)}` : ''}` : ''}. Only class days are selectable.${todayIsEndedClassDay ? " Today's class has already finished, so today is no longer bookable." : ''}`
          : 'Choose a class to see its available dates.'}
      </p>
    </div>
  )
}
