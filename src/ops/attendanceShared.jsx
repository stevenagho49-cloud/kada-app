import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { OPS_COLORS } from './ui'

/* Shared by Operations > Attendance and the Students tab. */

const MISSING_TABLE = /relation .*attendance.* does not exist|could not find the (table|function)/i
export const attendanceSetupMessage = 'The attendance register is not set up yet. Apply supabase/migrations/20260926_attendance.sql in the Supabase SQL Editor.'
export const friendlyAttendanceError = (error) => (MISSING_TABLE.test(error?.message || '') ? attendanceSetupMessage : error?.message || 'Attendance could not be loaded.')

// Every attendance row the signed-in user may read (RLS: attendance permission
// or admin). PostgREST caps a response at 1000 rows, so page through.
export async function fetchAllAttendance() {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('attendance')
      .select('student_id,student_name,class_name,session_date,status')
      .order('session_date').order('id')
      .range(from, from + 999)
    if (error) throw new Error(friendlyAttendanceError(error))
    rows.push(...(data || []))
    if (!data || data.length < 1000) return rows
  }
}

export function useAttendanceRows(enabled = true) {
  const [state, setState] = useState({ rows: null, error: '' })
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!enabled) return undefined
    let active = true
    fetchAllAttendance()
      .then((rows) => { if (active) setState({ rows, error: '' }) })
      .catch((error) => { if (active) setState({ rows: [], error: error.message }) })
    return () => { active = false }
  }, [enabled, version])
  return { ...state, reload: () => setVersion((value) => value + 1) }
}

const shortDate = (value) => new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

// Last sessions, oldest on the left: filled dot = present, hollow = absent
// (shape, not just colour, carries the meaning).
export function AttendanceDots({ history, size = 12 }) {
  const ordered = [...history].reverse()
  if (!ordered.length) return <span style={{ color: OPS_COLORS.muted, fontSize: 12 }}>No sessions marked</span>
  const present = ordered.filter((item) => item.status === 'present').length
  return (
    <span role="img" aria-label={`Last ${ordered.length} sessions: ${present} present, ${ordered.length - present} absent`} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', verticalAlign: 'middle' }}>
      {ordered.map((item) => (
        <span
          key={`${item.date}-${item.className}`}
          title={`${shortDate(item.date)} · ${item.className} · ${item.status === 'present' ? 'Present' : 'Absent'}`}
          style={{ width: size, height: size, borderRadius: '50%', boxSizing: 'border-box', background: item.status === 'present' ? OPS_COLORS.emerald : 'transparent', border: `2px solid ${item.status === 'present' ? OPS_COLORS.emerald : '#b9b2a2'}` }}
        />
      ))}
    </span>
  )
}
