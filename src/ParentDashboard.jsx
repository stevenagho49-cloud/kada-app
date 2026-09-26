/* Parent dashboard ,  lazy-loaded from App.jsx so the public site bundle
   doesn't carry it. All data/actions arrive via props from App. */
import { useEffect, useState } from 'react'
import { OpsSidebar, DataTable, Pill, OpsButton, EmptyState } from './ops/ui'
import { ClassDatePicker, DAY_NAMES, nextClassDate } from './lib/classDates'
import { AddressAutocomplete } from './lib/AddressAutocomplete'
import { AwardGallery, LatestAwardPanel, useParentAwards } from './ParentAwards'
import { HomeworkList, HomeworkDuePanel, useParentHomework, outstandingHomework } from './ParentHomework'

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

function ParentDashboard({ initialTab = '', session, family, bookings, students, classSessions = [], onBookClass, checkoutBusy, onCancelBooking, onBillingPortal, onCancelSubscription, onSaveSettings, onBack, onSignOut }) {
  const [parentTab, setParentTab] = useState(['book-class', 'bookings', 'children', 'homework', 'awards', 'settings'].includes(initialTab) ? initialTab : 'dashboard')
  const { awards, error: awardsError } = useParentAwards(true)
  const { tasks: homework, error: homeworkError, reload: reloadHomework } = useParentHomework(true)
  const homeworkTodo = outstandingHomework(homework).length
  const [openGroups, setOpenGroups] = useState(() => new Set(['Your family']))
  const activeStudents = students.filter((student) => student.membershipStatus === 'active' || student.familyId === family?.id)
  const sidebarItems = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'book-class', label: 'Book a class' },
    { label: 'Your family', children: [{ key: 'bookings', label: 'Bookings' }, { key: 'children', label: 'Children' }, { key: 'homework', label: `Homework${homeworkTodo ? ` (${homeworkTodo})` : ''}` }, { key: 'awards', label: `Awards${awards?.length ? ` (${awards.length})` : ''}` }, { key: 'settings', label: 'Settings' }] },
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

        {parentTab === 'dashboard' && <HomeworkDuePanel tasks={homework} onOpen={() => setParentTab('homework')} />}

        {parentTab === 'homework' && <HomeworkList tasks={homework} error={homeworkError} session={session} onChanged={reloadHomework} />}

        {parentTab === 'dashboard' && <LatestAwardPanel awards={awards} onOpen={() => setParentTab('awards')} />}

        {parentTab === 'awards' && <AwardGallery awards={awards} error={awardsError} students={activeStudents} />}

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

        {parentTab === 'settings' && (
          <ParentSettingsView family={family} students={activeStudents} onSave={onSaveSettings} />
        )}
      </div>
    </main>
  )
}
/* Book-a-class form for signed-in parents ,  pre-fills from their family
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
  const selectedSession = classSessions.find((session) => session.name === form.className) || classSessions[0] || null

  // Keep the chosen date on a real class day ,  switching class jumps to the
  // nearest date that class actually runs; only scheduled days are selectable.
  useEffect(() => {
    if (!selectedSession) return
    if (selectedSession.name !== form.className || !form.classDate) {
      setForm((current) => ({ ...current, className: selectedSession.name, classDate: nextClassDate(selectedSession) }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSession?.id, classSessions])

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
          <ClassDatePicker session={selectedSession} value={form.classDate} onChange={(date) => setForm({ ...form, classDate: date })} />
        </div>
        {form.students.map((student, index) => (
          <div key={index} className="pair-grid" style={{ borderTop: '1px solid #e4ddc9', paddingTop: 10 }}>
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

/* Parent portal > Settings ,  everything a parent can keep up to date
   themselves: contact details, emergency contact, communication preferences
   and per-child welfare notes. Saved via the server (ownership checked). */
function ParentSettingsView({ family, students, onSave }) {
  const input = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', fontSize: 14, border: '1px solid #e4ddc9', borderRadius: 6, background: '#fffdf8', fontFamily: 'inherit' }
  const label = { display: 'block', fontSize: 12, fontWeight: 700, color: emerald, marginBottom: 4 }
  const section = { border: '1px solid #e4ddc9', borderRadius: 10, padding: 16, background: '#fffdf8', marginBottom: 14 }

  const [form, setForm] = useState({
    guardian_name: family?.guardian_name || '',
    guardian_phone: family?.guardian_phone || '',
    address: family?.address || '',
    emergency_contact_name: family?.emergency_contact_name || '',
    emergency_contact_phone: family?.emergency_contact_phone || '',
    comms: { reminders: true, marketing: false, ...(family?.comms || {}) },
  })
  const [childNotes, setChildNotes] = useState(() => Object.fromEntries(students.map((student) => [student.id, {
    dietary_requirements: student.dietaryRequirements || '',
    medical_notes: student.medicalNotes || '',
    photo_consent: student.photoConsent === null || student.photoConsent === undefined ? '' : String(student.photoConsent),
  }])))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const save = async () => {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await onSave({
        family: form,
        students: Object.entries(childNotes).map(([id, notes]) => ({ id, ...notes, photo_consent: notes.photo_consent === '' ? null : notes.photo_consent === 'true' })),
      })
      setMessage('Settings saved. Thank you for keeping your details up to date.')
    } catch (saveError) {
      setError(saveError.message)
    }
    setSaving(false)
  }

  return (
    <div className="panel">
      <div className="panel-head"><h3>Family settings</h3></div>
      <p style={{ color: muted, fontSize: 13, margin: '0 0 14px' }}>Keep your details current so we can reach you quickly and look after your children properly.</p>

      <div style={section}>
        <h4 style={{ margin: '0 0 12px', fontSize: 15, color: emerald }}>Contact details</h4>
        <div className="pair-grid">
          <div><span style={label}>Your name</span><input style={input} value={form.guardian_name} onChange={(event) => setForm({ ...form, guardian_name: event.target.value })} /></div>
          <div><span style={label}>Phone</span><input style={input} value={form.guardian_phone} onChange={(event) => setForm({ ...form, guardian_phone: event.target.value })} /></div>
        </div>
        <div style={{ marginTop: 10 }}>
          <span style={label}>Home address</span>
          <AddressAutocomplete
            style={input}
            value={form.address}
            placeholder="Your postcode or the start of your street"
            onChange={(value) => setForm({ ...form, address: value })}
            onSelect={(result) => setForm((current) => ({ ...current, address: result.label }))}
          />
        </div>
        <p style={{ fontSize: 12, color: muted, margin: '8px 0 0' }}>Your email is your sign-in address ,  contact us if it changes.</p>
      </div>

      <div style={section}>
        <h4 style={{ margin: '0 0 12px', fontSize: 15, color: emerald }}>Emergency contact</h4>
        <div className="pair-grid">
          <div><span style={label}>Contact name</span><input style={input} value={form.emergency_contact_name} onChange={(event) => setForm({ ...form, emergency_contact_name: event.target.value })} /></div>
          <div><span style={label}>Contact phone</span><input style={input} value={form.emergency_contact_phone} onChange={(event) => setForm({ ...form, emergency_contact_phone: event.target.value })} /></div>
        </div>
      </div>

      <div style={section}>
        <h4 style={{ margin: '0 0 12px', fontSize: 15, color: emerald }}>Communications</h4>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, marginBottom: 6 }}><input type="checkbox" checked={Boolean(form.comms.reminders)} onChange={(event) => setForm({ ...form, comms: { ...form.comms, reminders: event.target.checked } })} /> Class reminders and essential updates</label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5 }}><input type="checkbox" checked={Boolean(form.comms.marketing)} onChange={(event) => setForm({ ...form, comms: { ...form.comms, marketing: event.target.checked } })} /> News, events and offers from KADA</label>
      </div>

      {students.length > 0 && (
        <div style={section}>
          <h4 style={{ margin: '0 0 4px', fontSize: 15, color: emerald }}>Children's welfare</h4>
          <p style={{ fontSize: 12.5, color: muted, margin: '0 0 12px' }}>Dietary requirements, allergies and medical notes are shared with instructors so every child is safe in class.</p>
          {students.map((student) => {
            const notes = childNotes[student.id] || { dietary_requirements: '', medical_notes: '', photo_consent: '' }
            const update = (changes) => setChildNotes((current) => ({ ...current, [student.id]: { ...notes, ...changes } }))
            return (
              <div key={student.id} style={{ borderTop: '1px solid #e4ddc9', paddingTop: 12, marginTop: 8 }}>
                <strong style={{ display: 'block', marginBottom: 8 }}>{student.name}</strong>
                <div className="pair-grid">
                  <div><span style={label}>Dietary requirements</span><input style={input} placeholder="e.g. vegetarian, nut allergy" value={notes.dietary_requirements} onChange={(event) => update({ dietary_requirements: event.target.value })} /></div>
                  <div><span style={label}>Photos & videos</span>
                    <select style={input} value={notes.photo_consent} onChange={(event) => update({ photo_consent: event.target.value })}>
                      <option value="">Not specified</option>
                      <option value="true">I consent to photos/videos</option>
                      <option value="false">No photos/videos, please</option>
                    </select>
                  </div>
                </div>
                <div style={{ marginTop: 10 }}><span style={label}>Allergies & medical notes</span><textarea style={{ ...input, minHeight: 56 }} placeholder="Anything instructors should know ,  asthma, injuries, additional needs…" value={notes.medical_notes} onChange={(event) => update({ medical_notes: event.target.value })} /></div>
              </div>
            )
          })}
        </div>
      )}

      {error && <p style={{ color: '#a3401f', fontSize: 13 }}>{error}</p>}
      {message && <p style={{ color: '#2e6b47', fontSize: 13 }}>{message}</p>}
      <OpsButton disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save settings'}</OpsButton>
    </div>
  )
}

export { ParentDashboard }
export default ParentDashboard
