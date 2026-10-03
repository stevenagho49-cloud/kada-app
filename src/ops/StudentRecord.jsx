import { useEffect, useState } from 'react'
import { Pill, OpsButton, OPS_COLORS, OPS_SERIF, opsInputStyle } from './ui'

/* ------------------------------------------------------------------ */
/* Operations > Students > a student's full record: the child, their    */
/* guardian, the family's plan / membership, welfare notes, attendance  */
/* and every booking on the family (marking the ones this child is on). */
/* ------------------------------------------------------------------ */

const money = (pence) => `£${(Number(pence || 0) / 100).toFixed(2)}`
const formatDate = (value) => (value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const statusTone = (value) => (value === 'active' ? 'green' : value === 'cancelled' ? 'red' : 'gold')

function age(dateOfBirth) {
  if (!dateOfBirth) return null
  const birth = new Date(`${dateOfBirth}T00:00:00`)
  const today = new Date()
  let years = today.getFullYear() - birth.getFullYear()
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) years -= 1
  return years
}

function planText(family) {
  if (!family) return 'No family account'
  if (family.planType === 'monthly_membership') {
    if (family.pricing === 'per_child' && family.monthlyPence) return `Monthly Membership · ${money(family.monthlyPence)}/month${family.children ? ` (${family.children} ${family.children === 1 ? 'child' : 'children'})` : ''}`
    return `Monthly Membership${family.monthlyPence ? ` · ${money(family.monthlyPence)}/month (flat rate)` : ''}`
  }
  if (family.planType === 'day_pass') return 'Day passes (pays per class)'
  return 'No plan chosen yet'
}

function bookingState(booking) {
  if (booking.status === 'Cancelled') return { text: 'Cancelled', tone: 'red' }
  if (booking.paymentStatus === 'pending') return { text: 'Checkout not finished', tone: 'default' }
  if (booking.paymentStatus === 'superseded') return { text: 'Covered by membership', tone: 'green' }
  if (booking.invoiceStatus === 'Paid' || booking.paymentStatus === 'paid') return { text: 'Paid', tone: 'green' }
  if (booking.invoiceStatus === 'Sent') return { text: 'Invoice unpaid', tone: 'gold' }
  return { text: booking.status || 'Booked', tone: 'default' }
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 10, padding: '4px 0', fontSize: 13.5 }}>
      <span style={{ color: OPS_COLORS.muted }}>{label}</span>
      <span style={{ color: OPS_COLORS.ink, wordBreak: 'break-word' }}>{children || <span style={{ color: OPS_COLORS.muted }}>Not given</span>}</span>
    </div>
  )
}

function Block({ title, children }) {
  return (
    <section style={{ borderTop: `1px solid ${OPS_COLORS.rule}`, padding: '12px 0' }}>
      <h4 style={{ margin: '0 0 6px', fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase', color: OPS_COLORS.muted }}>{title}</h4>
      {children}
    </section>
  )
}

const londonToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' })

// Staff put a child in a class by hand (e.g. a walk-in who hasn't booked online):
// they go on that class's register from the start date. No booking or payment.
function ClassAssignment({ session, student, classes, onSaved }) {
  const [className, setClassName] = useState(student.className || classes[0] || '')
  const [startDate, setStartDate] = useState(londonToday())
  const [editing, setEditing] = useState(!student.className)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState({ text: '', tone: '' })
  const cancelled = student.membershipStatus === 'cancelled'

  const save = async () => {
    setBusy(true)
    setMessage({ text: '', tone: '' })
    try {
      const response = await fetch(`/api/admin/students/${encodeURIComponent(student.id)}/class`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ className, startDate }) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'The class could not be saved.')
      onSaved(result.student)
      setEditing(false)
      setMessage({ text: `${student.name.trim()} is now in ${result.student.className} from ${formatDate(result.student.term)} and on that class's register.`, tone: 'ok' })
    } catch (saveError) {
      setMessage({ text: saveError.message, tone: 'warn' })
    }
    setBusy(false)
  }

  return (
    <Block title="Class">
      <Row label="Class">{student.className ? `${student.className}${student.term && /^\d{4}-/.test(student.term) ? ` · from ${formatDate(student.term)}` : ''}` : <span style={{ color: '#8a6d12' }}>Not in a class yet, so not on any register</span>}</Row>
      {cancelled && <p style={{ fontSize: 12.5, color: OPS_COLORS.muted, margin: '4px 0 0' }}>This child is marked cancelled (the family's membership ended). Mark the family active on Subscriptions before putting them in a class.</p>}
      {!cancelled && !editing && <div style={{ marginTop: 6 }}><OpsButton small variant="ghost" onClick={() => setEditing(true)}>Change class</OpsButton></div>}
      {!cancelled && editing && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 6 }}>
          <label style={{ fontSize: 12, color: OPS_COLORS.muted }}>Class<br />
            <select aria-label="Class" value={className} onChange={(event) => setClassName(event.target.value)} style={{ ...opsInputStyle, width: 'auto', minWidth: 220 }}>
              {!classes.length && <option value="">No classes on the schedule</option>}
              {classes.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: OPS_COLORS.muted }}>Starting<br />
            <input type="date" aria-label="Start date" value={startDate} onChange={(event) => setStartDate(event.target.value)} style={{ ...opsInputStyle, width: 'auto' }} />
          </label>
          <OpsButton small disabled={busy || !className} onClick={save}>{busy ? 'Saving…' : student.className ? 'Save class' : 'Put in class'}</OpsButton>
          {student.className && <OpsButton small variant="ghost" onClick={() => setEditing(false)}>Cancel</OpsButton>}
        </div>
      )}
      {!cancelled && editing && <p style={{ fontSize: 12, color: OPS_COLORS.muted, margin: '6px 0 0' }}>They appear on the register from the start date. This doesn't create a booking or take payment: their membership status stays as it is.</p>}
      {message.text && <p role="status" style={{ fontSize: 13, margin: '6px 0 0', color: message.tone === 'ok' ? OPS_COLORS.okGreen : OPS_COLORS.warn }}>{message.text}</p>}
    </Block>
  )
}

export function StudentRecord({ session, studentId, attendance, onClose, onClassChanged = () => {} }) {
  const [record, setRecord] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/admin/students/${encodeURIComponent(studentId)}/record`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.error || 'The record could not be loaded.')
        setRecord(result)
      })
      .catch((loadError) => setError(loadError.message))
  }, [studentId])

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const student = record?.student
  const years = age(student?.dateOfBirth)
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, padding: 16, overflowY: 'auto', background: 'rgba(20,18,10,.45)' }}>
      <div role="dialog" aria-label="Student record" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 720, margin: '24px auto', background: '#fffdf8', borderRadius: 10, border: `1px solid ${OPS_COLORS.rule}`, boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${OPS_COLORS.rule}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontFamily: OPS_SERIF, color: OPS_COLORS.emerald, fontWeight: 400, fontSize: 22 }}>{student?.name || 'Student record'}</h3>
            {student && <div style={{ fontSize: 13, color: OPS_COLORS.muted, marginTop: 2 }}>{[years !== null ? `Age ${years}` : '', student.dateOfBirth ? `born ${formatDate(student.dateOfBirth)}` : '', student.className].filter(Boolean).join(' · ')}</div>}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {student && <Pill text={student.membershipStatus || 'inactive'} tone={statusTone(student.membershipStatus)} />}
            <button type="button" aria-label="Close" onClick={onClose} style={{ border: 0, background: 'none', cursor: 'pointer', fontSize: 20, color: OPS_COLORS.muted }}>×</button>
          </div>
        </div>
        <div style={{ padding: '4px 18px 16px' }}>
          {error && <p style={{ color: OPS_COLORS.warn }}>{error}</p>}
          {!record && !error && <p style={{ color: OPS_COLORS.muted }}>Loading record…</p>}
          {record && <>
            <Block title="Guardian">
              <Row label="Name">{record.guardian.name}</Row>
              <Row label="Email">{record.guardian.email && <a href={`mailto:${record.guardian.email}`} style={{ color: OPS_COLORS.emerald }}>{record.guardian.email}</a>}</Row>
              <Row label="Phone">{record.guardian.phone}</Row>
              {record.guardian.address && <Row label="Address">{record.guardian.address}</Row>}
              <Row label="Emergency contact">{[record.guardian.emergencyName, record.guardian.emergencyPhone].filter(Boolean).join(' · ')}</Row>
              {record.siblings.length > 0 && <Row label="Siblings">{record.siblings.join(', ')}</Row>}
            </Block>
            <ClassAssignment session={session} student={student} classes={record.classes || []} onSaved={(saved) => { setRecord((current) => ({ ...current, student: { ...current.student, className: saved.className, term: saved.term } })); onClassChanged(saved) }} />
            <Block title="Plan and membership">
              <Row label="Plan">{planText(record.family)}</Row>
              <Row label="Membership">{record.family ? <><Pill text={record.family.paused && record.family.membershipStatus === 'active' ? 'Paused' : record.family.membershipStatus} tone={statusTone(record.family.membershipStatus)} />{record.family.hasSubscription ? <span style={{ fontSize: 12, color: OPS_COLORS.muted, marginLeft: 8 }}>Stripe subscription</span> : null}</> : null}</Row>
              <Row label="This child">{<Pill text={student.membershipStatus || 'inactive'} tone={statusTone(student.membershipStatus)} />}</Row>
              <Row label="Account">{record.family ? `${record.family.hasLogin ? 'Parent has a login' : 'No parent login yet'} · since ${formatDate(record.family.since)}` : null}</Row>
            </Block>
            <Block title="Welfare">
              <Row label="Medical notes">{student.medicalNotes}</Row>
              <Row label="Dietary">{student.dietaryRequirements}</Row>
              <Row label="Photo consent">{student.photoConsent === null ? null : student.photoConsent ? 'Yes' : 'No'}</Row>
            </Block>
            {attendance && (
              <Block title="Attendance">
                <Row label="Attended">{attendance.marked ? `${attendance.present} of ${attendance.marked} marked sessions (${Math.round((attendance.rate || 0) * 100)}%)` : 'No attendance marked yet'}</Row>
              </Block>
            )}
            <Block title={`Booking history (${record.bookings.length})`}>
              {record.bookings.length ? (
                <div style={{ overflowX: 'auto' }}>
                  <table className="ops-table" style={{ width: '100%' }}>
                    <thead><tr><th>Date</th><th>Booking</th><th>Amount</th><th>Status</th></tr></thead>
                    <tbody>
                      {record.bookings.map((booking) => {
                        const state = bookingState(booking)
                        return (
                          <tr key={booking.id}>
                            <td style={{ whiteSpace: 'nowrap' }}>{formatDate(booking.date) || (booking.arrears ? 'Arrears' : 'No date')}</td>
                            <td>
                              <div>{(booking.sessionType || 'Booking').replace('(monthly_membership)', '(Monthly Membership)').replace('(day_pass)', '(Day Pass)')}{booking.invoiceNumber ? ` · ${booking.invoiceNumber}` : ''}</div>
                              <div style={{ fontSize: 11.5, color: booking.includesChild ? OPS_COLORS.emerald : OPS_COLORS.muted }}>{booking.includesChild ? `${student.name.split(' ')[0]} is on this booking` : 'Family booking'}</div>
                            </td>
                            <td>{money(booking.price * 100)}</td>
                            <td><Pill text={state.text} tone={state.tone} /></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : <p style={{ margin: 0, fontSize: 13, color: OPS_COLORS.muted }}>No bookings yet.</p>}
            </Block>
          </>}
        </div>
      </div>
    </div>
  )
}
