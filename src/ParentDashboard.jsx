/* Parent dashboard — lazy-loaded from App.jsx so the public site bundle
   doesn't carry it. All data/actions arrive via props from App. */
import { useState } from 'react'
import { OpsSidebar, DataTable, Pill, OpsButton, EmptyState } from './ops/ui'

const emerald = '#0b3d2e'
const muted = '#767066'

const formatCurrency = (value) => `£${Number(value || 0).toLocaleString()}`

function ageFromDob(dateOfBirth) {
  if (!dateOfBirth) return ''
  const today = new Date()
  const birth = new Date(`${dateOfBirth}T00:00:00`)
  let age = today.getFullYear() - birth.getFullYear()
  const beforeBirthday = today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())
  if (beforeBirthday) age -= 1
  return age
}

function Button({ children, onClick, type = 'button', disabled, variant = 'primary', small = false }) {
  const styles = { primary: { background: emerald, color: '#fffdf8' }, ghost: { background: 'transparent', color: emerald, border: '1px solid #e4ddc9' }, danger: { background: 'transparent', color: '#a3401f', border: '1px solid #e4ddc9' } }
  return <button type={type} disabled={disabled} onClick={onClick} style={{ ...styles[variant], borderRadius: 6, padding: small ? '6px 11px' : '9px 18px', fontFamily: 'inherit', fontSize: small ? 12 : 13.5, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1 }}>{children}</button>
}

function ParentDashboard({ session, family, bookings, students, onCancelBooking, onBillingPortal, onCancelSubscription, onBack, onSignOut }) {
  const [parentTab, setParentTab] = useState('dashboard')
  const [openGroups, setOpenGroups] = useState(() => new Set(['Your family']))
  const activeStudents = students.filter((student) => student.membershipStatus === 'active' || student.familyId === family?.id)
  const sidebarItems = [
    { key: 'dashboard', label: 'Dashboard' },
    { label: 'Your family', children: [{ key: 'bookings', label: 'Bookings' }, { key: 'children', label: 'Children' }] },
  ]
  const toggleGroup = (label) => setOpenGroups((previous) => {
    const next = new Set(previous)
    if (next.has(label)) next.delete(label)
    else next.add(label)
    return next
  })

  const bookingColumns = [
    { key: 'session', label: 'Class', render: (booking) => <strong style={{ color: emerald }}>{booking.sessionType}</strong> },
    { key: 'date', label: 'Date', render: (booking) => booking.date || 'To be confirmed' },
    { key: 'price', label: 'Price', render: (booking) => formatCurrency(booking.price) },
    { key: 'status', label: 'Status', render: (booking) => <Pill text={booking.status} tone={booking.status === 'Cancelled' ? 'red' : booking.status === 'Confirmed' ? 'green' : 'gold'} /> },
    { key: 'actions', label: '', render: (booking) => booking.status !== 'Cancelled' ? <OpsButton small variant="danger" onClick={() => onCancelBooking(booking.id)}>Cancel booking</OpsButton> : null },
  ]
  const childColumns = [
    { key: 'name', label: 'Child', render: (student) => <strong style={{ color: emerald }}>{student.name}</strong> },
    { key: 'dob', label: 'Date of birth', render: (student) => student.dateOfBirth },
    { key: 'age', label: 'Age', render: (student) => ageFromDob(student.dateOfBirth) },
    { key: 'class', label: 'Class', render: (student) => student.className || 'Not set' },
    { key: 'status', label: 'Status', render: (student) => <Pill text={student.membershipStatus} tone={student.membershipStatus === 'active' ? 'green' : student.membershipStatus === 'cancelled' ? 'red' : 'gold'} /> },
  ]

  return (
    <main className="ops-shell wrap ops-layout" style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      <OpsSidebar caption="Parent" items={sidebarItems} active={parentTab} onSelect={setParentTab} openGroups={openGroups} onToggleGroup={toggleGroup} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="ops-header">
          <div>
            <p className="eyebrow dark">Parent dashboard</p>
            <h2 className="display">Welcome, {family?.guardian_name || session.user.email}</h2>
            <p style={{ color: muted }}>Your family bookings, students, and plan.</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={onBack}>Back to site</Button>
            <Button variant="ghost" onClick={onSignOut}>Sign out</Button>
          </div>
        </div>

        {parentTab === 'dashboard' && <>
          <div className="ops-grid">
            <div className="panel stat-panel"><div className="panel-label">Plan</div><strong>{family?.plan_type === 'monthly_membership' ? '£25 / month' : family?.plan_type === 'day_pass' ? 'Day pass' : 'No plan yet'}</strong></div>
            <div className="panel stat-panel"><div className="panel-label">Plan status</div><strong>{family?.membership_status || 'Pending'}</strong></div>
            <div className="panel stat-panel"><div className="panel-label">Children</div><strong>{activeStudents.length}</strong></div>
          </div>
          <div className="panel" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {family?.stripe_customer_id && <Button variant="ghost" onClick={onBillingPortal}>Change payment details</Button>}
            {family?.stripe_subscription_id && family.membership_status === 'active' && <Button variant="danger" onClick={onCancelSubscription}>Cancel subscription</Button>}
            {!family && <p style={{ color: muted, margin: 0 }}>Your plan appears here after a completed class booking.</p>}
          </div>
        </>}

        {parentTab === 'bookings' && (
          <div className="panel">
            <div className="panel-head"><h3>Your bookings</h3></div>
            <DataTable columns={bookingColumns} rows={bookings} expanded onToggleExpand={() => {}} pageSize={1000} emptyState={<EmptyState icon="🗓" title="No bookings yet" body="Your class bookings appear here after checkout completes." />} />
          </div>
        )}

        {parentTab === 'children' && (
          <div className="panel">
            <div className="panel-head"><h3>Your children</h3></div>
            <DataTable columns={childColumns} rows={activeStudents} expanded onToggleExpand={() => {}} pageSize={1000} emptyState={<EmptyState icon="🧒" title="No children yet" body="Children appear here after a completed class booking." />} />
          </div>
        )}
      </div>
    </main>
  )
}
export { ParentDashboard }
export default ParentDashboard
