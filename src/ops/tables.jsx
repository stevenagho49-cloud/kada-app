import React from 'react'
import { DataTable, EditableText, EditableSelect, StatusMenu, Pill, OpsButton, EmptyState, OPS_COLORS } from './ui'

const SESSION_TYPE_OPTIONS = ['Full day (£490)', 'Half day', 'Single workshop', 'Custom'].map((value) => ({ value, label: value }))
const BOOKING_STATUS_OPTIONS = ['Enquiry', 'Confirmed', 'Delivered', 'Cancelled'].map((value) => ({ value, label: value, danger: value === 'Cancelled' }))
const INVOICE_STATUS_OPTIONS = ['Not sent', 'Sent', 'Paid'].map((value) => ({ value, label: value }))

export function bookingStatusTone(status) {
  return status === 'Confirmed' ? 'green' : status === 'Delivered' ? 'gold' : status === 'Cancelled' ? 'red' : 'default'
}
export function invoiceStatusTone(status) {
  return status === 'Paid' ? 'green' : status === 'Sent' ? 'gold' : 'red'
}

/* ------------------------------------------------------------------ */
/* Bookings                                                            */
/* ------------------------------------------------------------------ */
export function BookingsTable({
  bookings, schools, instructors, jobs, conflicts, instructorLabel,
  isAdmin, isInstructor, canIssueInvoices,
  expanded, onToggleExpand,
  onSaveBooking, onOpenSchool, onEditBooking, onPublishJob, onMarkDone, onInvoice,
}) {
  const schoolName = (booking) => schools.find((school) => school.id === booking.schoolId)?.name || 'School enquiry'

  const columns = [
    {
      key: 'school', label: 'School / contact', render: (booking) => (
        <div>
          <button type="button" onClick={() => onOpenSchool(booking)} style={{ border: 0, background: 'none', padding: 0, color: OPS_COLORS.emerald, fontWeight: 700, cursor: 'pointer', fontSize: 13.5 }}>{schoolName(booking)}</button>
          <div style={{ marginTop: 3 }}>
            <EditableText small disabled={!isAdmin} value={booking.contactName} placeholder="Add contact" onSave={(value) => onSaveBooking({ ...booking, contactName: value })} />
          </div>
          <div style={{ marginTop: 2 }}>
            <EditableText small disabled={!isAdmin} value={booking.contactEmail} placeholder="Add email" onSave={(value) => onSaveBooking({ ...booking, contactEmail: value })} />
          </div>
        </div>
      ),
    },
    {
      key: 'date', label: 'Date', render: (booking) => (
        <EditableText type="date" disabled={!isAdmin} value={booking.date} placeholder="Set date" onSave={(value) => onSaveBooking({ ...booking, date: value })} />
      ),
    },
    {
      key: 'session', label: 'Session', render: (booking) => (
        <div>
          <EditableSelect disabled={!isAdmin} value={booking.sessionType} options={SESSION_TYPE_OPTIONS} onSave={(value) => onSaveBooking({ ...booking, sessionType: value })} />
          <div style={{ marginTop: 3, color: OPS_COLORS.muted, fontSize: 12 }}>
            £<EditableText small type="number" disabled={!isAdmin} value={booking.price} onSave={(value) => onSaveBooking({ ...booking, price: value })} />
          </div>
        </div>
      ),
    },
    {
      key: 'students', label: 'Students', render: (booking) => (
        <EditableText type="number" disabled={!isAdmin} value={booking.studentCount} onSave={(value) => onSaveBooking({ ...booking, studentCount: value })} />
      ),
    },
    {
      key: 'instructor', label: 'Instructor', render: (booking) => (
        isAdmin ? (
          <EditableSelect
            value={booking.instructorId}
            placeholder="Unassigned"
            options={[{ value: '', label: 'Unassigned' }, ...instructors.map((instructor) => ({ value: instructor.id, label: instructor.name }))]}
            onSave={(value) => onSaveBooking({ ...booking, instructorId: value })}
          />
        ) : (
          <span style={{ fontSize: 13.5, color: booking.instructorId ? OPS_COLORS.ink : OPS_COLORS.muted }}>{instructorLabel(booking) || 'To be confirmed'}</span>
        )
      ),
    },
    {
      key: 'status', label: 'Status', render: (booking) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <StatusMenu
            disabled={!isAdmin}
            value={booking.status}
            tone={bookingStatusTone(booking.status)}
            options={BOOKING_STATUS_OPTIONS}
            onChange={(value) => onSaveBooking({ ...booking, status: value })}
          />
          {conflicts?.has(booking.id) && <Pill text="Conflict" tone="red" />}
        </div>
      ),
    },
    {
      key: 'invoice', label: 'Invoice', render: (booking) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <StatusMenu
            disabled={!canIssueInvoices}
            value={booking.invoiceStatus}
            tone={invoiceStatusTone(booking.invoiceStatus)}
            options={INVOICE_STATUS_OPTIONS}
            onChange={(value) => onSaveBooking({ ...booking, invoiceStatus: value })}
          />
          {canIssueInvoices && <OpsButton small variant="ghost" onClick={() => onInvoice(booking)}>Invoice</OpsButton>}
        </div>
      ),
    },
    {
      key: 'actions', label: '', render: (booking) => (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {isInstructor && booking.status !== 'Delivered' && booking.status !== 'Cancelled' && <OpsButton small onClick={() => onMarkDone(booking.id)}>Mark as done</OpsButton>}
          {isAdmin && <OpsButton small variant="ghost" onClick={() => onEditBooking(booking)}>Edit</OpsButton>}
          {isAdmin && !jobs.some((job) => job.bookingId === booking.id) && <OpsButton small onClick={() => onPublishJob(booking)}>Publish job</OpsButton>}
        </div>
      ),
    },
  ]

  return (
    <DataTable
      columns={columns}
      rows={bookings}
      expanded={expanded}
      onToggleExpand={onToggleExpand}
      emptyState={
        <EmptyState
          icon="🗓"
          title="No bookings match"
          body="Bookings appear here as schools and parents request them. Adjust the search or create the first booking."
          ctaLabel={isAdmin ? '+ New booking' : undefined}
          onCta={isAdmin ? () => onEditBooking(null) : undefined}
        />
      }
    />
  )
}

/* ------------------------------------------------------------------ */
/* Schools                                                             */
/* ------------------------------------------------------------------ */
export function SchoolsTable({ schools, bookings, expanded, onToggleExpand, onSaveSchool, onView, onMessage }) {
  const columns = [
    {
      key: 'name', label: 'School', render: (school) => (
        <EditableText value={school.name} onSave={(value) => onSaveSchool({ ...school, name: value })} />
      ),
    },
    {
      key: 'contact', label: 'Contact', render: (school) => (
        <EditableText value={school.contactName} placeholder="Add contact" onSave={(value) => onSaveSchool({ ...school, contactName: value })} />
      ),
    },
    {
      key: 'email', label: 'Email', render: (school) => (
        <EditableText value={school.email} placeholder="Add email" onSave={(value) => onSaveSchool({ ...school, email: value })} />
      ),
    },
    {
      key: 'phone', label: 'Phone', render: (school) => (
        <EditableText value={school.phone} placeholder="Add phone" onSave={(value) => onSaveSchool({ ...school, phone: value })} />
      ),
    },
    {
      key: 'bookings', label: 'Bookings', render: (school) => (
        <span style={{ color: OPS_COLORS.muted }}>{bookings.filter((booking) => booking.schoolId === school.id).length}</span>
      ),
    },
    {
      key: 'actions', label: '', render: (school) => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <OpsButton small variant="ghost" onClick={() => onView(school)}>View</OpsButton>
          <OpsButton small variant="ghost" onClick={() => onMessage(school)}>Message</OpsButton>
        </div>
      ),
    },
  ]

  return (
    <DataTable
      columns={columns}
      rows={schools}
      expanded={expanded}
      onToggleExpand={onToggleExpand}
      emptyState={
        <EmptyState
          icon="🏫"
          title="No schools yet"
          body="School accounts appear here once they sign up or are added manually."
        />
      }
    />
  )
}

/* ------------------------------------------------------------------ */
/* Instructors                                                         */
/* ------------------------------------------------------------------ */
export function InstructorsTable({ instructors, expanded, onToggleExpand, completedBy, onSaveInstructor, onMessage, onEdit, onOpenDbs, onReviewDbs }) {
  const columns = [
    {
      key: 'name', label: 'Instructor', render: (instructor) => (
        <div>
          <EditableText value={instructor.name} onSave={(value) => onSaveInstructor({ ...instructor, name: value })} />
          <div style={{ marginTop: 3 }}>
            <EditableText small value={instructor.email} placeholder="Add email" onSave={(value) => onSaveInstructor({ ...instructor, email: value })} />
          </div>
        </div>
      ),
    },
    {
      key: 'locations', label: 'Locations', render: (instructor) => (
        <EditableText value={instructor.locationAreas} placeholder="Add areas" onSave={(value) => onSaveInstructor({ ...instructor, locationAreas: value })} />
      ),
    },
    {
      key: 'gender', label: 'Gender', render: (instructor) => (
        <EditableText value={instructor.gender} placeholder="Not provided" onSave={(value) => onSaveInstructor({ ...instructor, gender: value })} />
      ),
    },
    {
      key: 'rate', label: 'Rate', render: (instructor) => (
        <span>£<EditableText type="number" value={instructor.rate} onSave={(value) => onSaveInstructor({ ...instructor, rate: value })} /></span>
      ),
    },
    {
      key: 'completed', label: 'Completed', render: (instructor) => (
        <span style={{ color: OPS_COLORS.muted }}>{completedBy(instructor.id)}</span>
      ),
    },
    {
      key: 'dbs', label: 'DBS', render: (instructor) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
          <Pill text={`DBS ${instructor.dbsStatus}`} tone={instructor.dbsStatus === 'Approved' ? 'green' : instructor.dbsStatus === 'Rejected' ? 'red' : 'gold'} />
          {instructor.dbsStatus === 'Rejected' && instructor.dbsRejectionReason && <span style={{ color: OPS_COLORS.warn, fontSize: 12 }}>Rejected: {instructor.dbsRejectionReason}</span>}
          {instructor.dbsFilePath && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <OpsButton small variant="ghost" onClick={() => onOpenDbs(instructor.id)}>View DBS</OpsButton>
              <OpsButton small onClick={() => onReviewDbs(instructor, 'Approved')}>Approve</OpsButton>
              <OpsButton small variant="danger" onClick={() => onReviewDbs(instructor, 'Rejected', window.prompt('Optional rejection reason') || '')}>Reject</OpsButton>
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'actions', label: '', render: (instructor) => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <OpsButton small variant="ghost" onClick={() => onMessage(instructor)}>Message</OpsButton>
          <OpsButton small variant="ghost" onClick={() => onEdit(instructor)}>Edit</OpsButton>
        </div>
      ),
    },
  ]

  return (
    <DataTable
      columns={columns}
      rows={instructors}
      expanded={expanded}
      onToggleExpand={onToggleExpand}
      emptyState={
        <EmptyState
          icon="🕺"
          title="No instructors yet"
          body="Add your first instructor to start assigning bookings and publishing jobs."
        />
      }
    />
  )
}
