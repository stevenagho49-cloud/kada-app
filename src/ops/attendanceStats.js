/* ------------------------------------------------------------------ */
/* Attendance statistics, computed from attendance rows                */
/* ({ student_id, student_name, class_name, session_date, status }).   */
/* Plain functions (no React) so scripts/verify-attendance.js checks    */
/* the exact code the dashboard runs. Rates are present / marked:      */
/* a child nobody marked counts as neither present nor absent.         */
/* ------------------------------------------------------------------ */

export const rate = (present, marked) => (marked ? present / marked : null)

// Per child: totals, rate, and the last `historySize` marked sessions (newest first).
export function childStats(rows, historySize = 10) {
  const byChild = new Map()
  for (const row of rows) {
    const entry = byChild.get(row.student_id) || { studentId: row.student_id, name: row.student_name, present: 0, absent: 0, sessions: [] }
    if (row.status === 'present') entry.present += 1
    else entry.absent += 1
    entry.sessions.push({ date: row.session_date, className: row.class_name, status: row.status })
    byChild.set(row.student_id, entry)
  }
  return [...byChild.values()].map((entry) => {
    const sessions = entry.sessions.sort((a, b) => b.date.localeCompare(a.date) || a.className.localeCompare(b.className))
    const marked = entry.present + entry.absent
    return {
      studentId: entry.studentId,
      name: entry.name,
      present: entry.present,
      absent: entry.absent,
      marked,
      rate: rate(entry.present, marked),
      lastSession: sessions[0]?.date || '',
      history: sessions.slice(0, historySize),
    }
  })
}

// One entry per class session (class + date), oldest first.
export function sessionStats(rows) {
  const bySession = new Map()
  for (const row of rows) {
    const key = `${row.class_name}|${row.session_date}`
    const entry = bySession.get(key) || { className: row.class_name, date: row.session_date, present: 0, absent: 0 }
    if (row.status === 'present') entry.present += 1
    else entry.absent += 1
    bySession.set(key, entry)
  }
  return [...bySession.values()]
    .map((entry) => ({ ...entry, marked: entry.present + entry.absent, rate: rate(entry.present, entry.present + entry.absent) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.className.localeCompare(b.className))
}

// Trend for a list of sessions (one class, or every class merged by date):
// overall rate, the last `window` sessions vs the `window` before, and the
// sessions whose rate is at least `lowGap` below the average (low-turnout weeks).
export function trend(sessions, { window = 4, lowGap = 0.15 } = {}) {
  const pooled = (list) => rate(list.reduce((sum, item) => sum + item.present, 0), list.reduce((sum, item) => sum + item.marked, 0))
  const average = pooled(sessions)
  const recent = sessions.slice(-window)
  const previous = sessions.slice(-window * 2, -window)
  const recentRate = pooled(recent)
  const previousRate = previous.length ? pooled(previous) : null
  return {
    sessions: sessions.length,
    average,
    recentRate,
    previousRate,
    change: recentRate !== null && previousRate !== null ? recentRate - previousRate : null,
    lowSessions: average === null ? [] : sessions.filter((item) => item.rate !== null && item.rate <= average - lowGap),
  }
}

// Every class's sessions merged per date, for the overall trend.
export function overallByDate(sessions) {
  const byDate = new Map()
  for (const item of sessions) {
    const entry = byDate.get(item.date) || { className: 'All classes', date: item.date, present: 0, absent: 0 }
    entry.present += item.present
    entry.absent += item.absent
    byDate.set(item.date, entry)
  }
  return [...byDate.values()]
    .map((entry) => ({ ...entry, marked: entry.present + entry.absent, rate: rate(entry.present, entry.present + entry.absent) }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export const formatRate = (value) => (value === null || value === undefined ? '–' : `${Math.round(value * 100)}%`)
