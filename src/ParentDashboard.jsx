/* Parent dashboard — lazy-loaded from App.jsx so the public site bundle
   doesn't carry it. All data/actions arrive via props from App. */
import { useState } from 'react'
import { OpsSidebar, DataTable, Pill, OpsButton, EmptyState } from './ops/ui'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

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

function ParentDashboard({ session, family, bookings, students, classSessions = [], onBookClass, checkoutBusy, onCancelBooking, onBillingPortal, onCancelSubscription, onBack, onSignOut }) {
  const [parentTab, setParentTab] = useState('dashboard')
  const [openGroups, setOpenGroups] = useState(() => new Set(['Your family']))
  const activeStudents = students.filter((student) => student.membershipStatus === 'active' || student.familyId === family?.id)
  const sidebarItems = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'book-class', label: 'Book a class' },
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

        {parentTab === 'book-class' && (
          <ParentBookingForm family={family} students={students} classSessions={classSessions} session={session} onBookClass={onBookClass} checkoutBusy={checkoutBusy} />
        )}

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
/* Book-a-class form for signed-in parents — pre-fills from their family
   record and existing children, then hands off to Stripe checkout. */
function ParentBookingForm({ family, students, classSessions, session, onBookClass, checkoutBusy }) {
  const [form, setForm] = useState({
    planType: 'monthly_membership',
    className: classSessions[0]?.name || '',
    classDate: '',
    students: [{ name: '', dateOfBirth: '' }],
  })
  const parentName = family?.guardian_name || session.user.user_metadata?.full_name || ''
  const parentEmail = family?.guardian_email || session.user.email || ''
  const knownChildren = students.filter((student) => student.name)

  const pickChild = (index, name) => {
    const found = knownChildren.find((student) => student.name === name)
    const next = [...form.students]
    next[index] = found ? { name: found.name, dateOfBirth: found.dateOfBirth || found.date_of_birth || '' } : { name: '', dateOfBirth: '' }
    setForm({ ...form, students: next })
  }

  const submit = (event) => {
    event.preventDefault()
    onBookClass({ ...form, parentName, parentEmail })
  }

  const input = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', fontSize: 14, border: '1px solid #e4ddc9', borderRadius: 6, background: '#fffdf8', fontFamily: 'inherit' }
  const label = { display: 'block', fontSize: 12, fontWeight: 700, color: emerald, marginBottom: 4 }

  if (!classSessions.length) {
    return <div className="panel"><EmptyState icon="🗓" title="No classes scheduled" body="Class times are being finalised. Please check back shortly." /></div>
  }

  return (
    <div className="panel">
      <div className="panel-head"><h3>Book a class</h3></div>
      <p style={{ color: muted, fontSize: 13, margin: '0 0 14px' }}>Choose a plan and class, pick your children, and pay securely with Stripe. Your place is confirmed once payment completes.</p>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12, maxWidth: 520 }}>
        <div>
          <span style={label}>Plan</span>
          <select style={input} value={form.planType} onChange={(event) => setForm({ ...form, planType: event.target.value })}>
            <option value="monthly_membership">Monthly Membership (£25/month)</option>
            <option value="day_pass">Day Pass (£10)</option>
          </select>
        </div>
        <div>
          <span style={label}>Class</span>
          <select style={input} value={form.className} onChange={(event) => setForm({ ...form, className: event.target.value })}>
            {classSessions.map((item) => <option key={item.id} value={item.name}>{item.name} · {DAY_NAMES[Number(item.day_of_week)]}s {String(item.start_time).slice(0, 5)}</option>)}
          </select>
        </div>
        <div>
          <span style={label}>Class date</span>
          <input type="date" style={input} value={form.classDate} min={new Date().toISOString().slice(0, 10)} onChange={(event) => setForm({ ...form, classDate: event.target.value })} required />
        </div>
        {form.students.map((student, index) => (
          <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, borderTop: '1px solid #e4ddc9', paddingTop: 10 }}>
            <div>
              <span style={label}>Child {index + 1}</span>
              {knownChildren.length ? (
                <select style={input} value={student.name} onChange={(event) => pickChild(index, event.target.value)} required>
                  <option value="">Select child</option>
                  {knownChildren.map((known) => <option key={known.id || known.name} value={known.name}>{known.name}</option>)}
                  <option value="__new">New child…</option>
                </select>
              ) : (
                <input style={input} placeholder="Child name" value={student.name} onChange={(event) => { const next = [...form.students]; next[index] = { ...student, name: event.target.value }; setForm({ ...form, students: next }) }} required />
              )}
              {student.name === '__new' || (!knownChildren.length) ? null : null}
            </div>
            <div>
              <span style={label}>Date of birth</span>
              <input type="date" style={input} value={student.dateOfBirth} onChange={(event) => { const next = [...form.students]; next[index] = { ...student, dateOfBirth: event.target.value }; setForm({ ...form, students: next }) }} required />
            </div>
          </div>
        ))}
        {form.students.some((s) => s.name === '__new') && (
          <input style={input} placeholder="New child's name" onChange={(event) => { const next = [...form.students]; const idx = next.findIndex((s) => s.name === '__new'); if (idx >= 0) next[idx] = { name: event.target.value, dateOfBirth: next[idx].dateOfBirth }; setForm({ ...form, students: next }) }} />
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <OpsButton small variant="ghost" onClick={() => setForm({ ...form, students: [...form.students, { name: '', dateOfBirth: '' }] })}>+ Add another child</OpsButton>
        </div>
        <OpsButton type="submit" disabled={checkoutBusy || !form.classDate}>{checkoutBusy ? 'Opening checkout…' : 'Continue to payment'}</OpsButton>
      </form>
    </div>
  )
}

export { ParentDashboard }
export default ParentDashboard
