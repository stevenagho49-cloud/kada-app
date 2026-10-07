import { useEffect, useMemo, useRef, useState, lazy, Suspense, Component } from 'react'
import { supabase, initialAuthCallback, verifyAuthToken } from './lib/supabase'
import { compressFlyer, flyerFileName } from './lib/flyerImage'
import { readAuthCallback } from './lib/authRecovery'
import './App.css'
import { OpsSidebar, DataTable, Pill, OpsButton, EmptyState } from './ops/ui'
import { BookingsTable, SchoolsTable, InstructorsTable } from './ops/tables'
import SubscriptionsPage from './ops/SubscriptionsPage'
import { EventsPage, EventForm, emptyEvent, normalizeEvent, toDbEvent } from './ops/EventsPage'
import { SiteLayoutPage } from './ops/SiteLayoutPage'
import { SiteContentPage } from './ops/SiteContentPage'
import { CalendarPage } from './ops/CalendarPage'
import { ClassSchedulePage } from './ops/ClassSchedulePage'
import { ContactsPage } from './ops/ContactsPage'
import { TeamPage } from './ops/TeamPage'
import { SettingsPage } from './ops/SettingsPage'
import { CampaignsPage } from './ops/CampaignsPage'
import { SiteAnalytics } from './ops/SiteAnalytics'
import { PaymentsPanel } from './ops/PaymentsPanel'
import { useAttendanceRows, AttendanceDots } from './ops/attendanceShared'
import { childStats, formatRate } from './ops/attendanceStats'
import { StudentRecord } from './ops/StudentRecord'
import { NotInClassCard } from './ops/NotInClass'
import HomePage, { DEFAULT_SECTION_ORDER } from './HomePage'
import { applySiteFavicon } from './lib/useSiteLogo'

// Routable screens loaded on demand ,  the public homepage bundle doesn't pay for them.
const EventTicketPage = lazy(() => import('./EventTicketPage').then((module) => ({ default: module.EventTicketPage })))
const LegalPage = lazy(() => import('./LegalPages').then((module) => ({ default: module.LegalPage })))
const PaymentLinkPage = lazy(() => import('./PaymentLinkPage').then((module) => ({ default: module.PaymentLinkPage })))
const PaymentLinksPage = lazy(() => import('./ops/PaymentLinksPage').then((module) => ({ default: module.PaymentLinksPage })))
const AttendancePage = lazy(() => import('./ops/AttendancePage').then((module) => ({ default: module.AttendancePage })))
const HomeworkPage = lazy(() => import('./ops/HomeworkPage').then((module) => ({ default: module.HomeworkPage })))
const FormationsPage = lazy(() => import('./ops/FormationsPage').then((module) => ({ default: module.FormationsPage })))
const SessionTypesPage = lazy(() => import('./ops/SessionTypesPage').then((module) => ({ default: module.SessionTypesPage })))
const SocialStudioPage = lazy(() => import('./ops/SocialStudioPage').then((module) => ({ default: module.SocialStudioPage })))
const ArrearsPage = lazy(() => import('./ops/ArrearsPage').then((module) => ({ default: module.ArrearsPage })))
const ParentDashboard = lazy(() => import('./ParentDashboard').then((module) => ({ default: module.ParentDashboard })))

const emerald = '#0b3d2e'
const emeraldLight = '#145c40'
const gold = '#c9a227'
const cream = '#f6f3ea'
const ivory = '#fffdf8'
const ink = '#232323'
const muted = '#767066'
const rule = '#e4ddc9'
const warn = '#a3401f'
const okGreen = '#2e6b47'
const serif = "'Iowan Old Style', 'Georgia', 'Times New Roman', serif"
const sans = "'Inter', -apple-system, 'Helvetica Neue', Arial, sans-serif"

const defaultSchools = [
  { id: 'school-1', name: 'Birmingham Academy', contactName: 'Mrs. Adebayo', email: 'head@birminghamacademy.org', phone: '0121 555 0144', notes: 'Primary enrichment' },
  { id: 'school-2', name: 'Oakridge School', contactName: 'Mr. Patterson', email: 'patterson@oakridge.uk', phone: '0121 555 7612', notes: 'Black History Month' },
]

const defaultInstructors = [
  { id: 'instr-1', name: 'Steven', email: 'steven@kingsarkdance.com', phone: '07800 000001', rate: 180 },
  { id: 'instr-2', name: 'Temilade', email: 'temi@kingsarkdance.com', phone: '07800 000002', rate: 160 },
  { id: 'instr-3', name: 'Annedrea', email: 'annedrea@kingsarkdance.com', phone: '07800 000003', rate: 170 },
]

const defaultBookings = [
  {
    id: 'book-1',
    schoolId: 'school-1',
    contactName: 'Mrs. Adebayo',
    contactEmail: 'head@birminghamacademy.org',
    date: '2026-09-12',
    sessionType: 'Full day (£490)',
    price: 490,
    studentCount: 42,
    instructorId: 'instr-1',
    status: 'Confirmed',
    invoiceStatus: 'Paid',
    invoiceNumber: 'KADA-0001',
    notes: 'Primary pupils, 2 instructors recommended',
  },
  {
    id: 'book-2',
    schoolId: 'school-2',
    contactName: 'Mr. Patterson',
    contactEmail: 'patterson@oakridge.uk',
    date: '2026-09-18',
    sessionType: 'Full day (£490)',
    price: 980,
    studentCount: 60,
    instructorId: 'instr-2',
    status: 'Enquiry',
    invoiceStatus: 'Not sent',
    invoiceNumber: '',
    notes: 'Awaiting confirmation',
  },
]

const defaultTemplate = {
  sections: [
    { id: 'welcome', title: 'Welcome & warm up', minutes: 10 },
    { id: 'teach', title: 'Core routine teach', minutes: 15 },
    { id: 'run', title: 'Full run through', minutes: 10 },
    { id: 'reflect', title: 'Performance & reflection', minutes: 10 },
  ],
  maxStudentsPerStaff: 30,
  defaultDuration: 45,
  notes: 'Begin with a short prayer and energy check. Keep movement inclusive and uplifting.',
}
function normalizePublicInstructor(row) {
  return { id: row.id, firstName: row.first_name || 'Instructor' }
}

const valueItems = [
  { roman: 'I', title: 'Faith First', text: 'Everything we do is rooted in purpose, not just performance.' },
  { roman: 'II', title: 'Excellence', text: 'Every session, every school, held to the same high standard.' },
  { roman: 'III', title: 'Confidence', text: 'Dance is the vehicle. Confidence is what we are building.' },
  { roman: 'IV', title: 'Culture', text: 'Gospel Afrobeats connects young people to heritage and joy.' },
  { roman: 'V', title: 'Community', text: 'Never a one-off booking. We build relationships that last.' },
]

const formatCurrency = (value) => `£${Number(value || 0).toLocaleString()}`

const parseStored = (key, fallback) => {
  if (typeof window === 'undefined') return fallback
  try {
    const item = window.localStorage.getItem(key)
    return item ? JSON.parse(item) : fallback
  } catch {
    return fallback
  }
}

// Public event and legal pages live at real URL paths (/event/<id>, /privacy, /terms,
// /accessibility) so they survive being shared on Instagram etc., which encodes a bare
// # as %23 and breaks hash-based links. Old #event/<id> / #privacy-style links (already
// shared before this change) still resolve: parseRoute falls back to the hash, and the
// route-sync effect below rewrites the URL to its real path with history.replaceState.
function parseRoute() {
  if (typeof window === 'undefined') return { eventId: null, legalId: null, paySlug: null }
  const pathname = window.location.pathname
  const hash = window.location.hash || ''
  // Payment links (/pay/<slug>) were born as real paths ,  no legacy hash form to support.
  const paySlug = pathname.match(/^\/pay\/([a-z0-9-]+)\/?$/)?.[1] || null
  if (paySlug) return { eventId: null, legalId: null, paySlug }
  // 1. Real URL path ,  the current, shareable format.
  let eventId = pathname.match(/^\/event\/([\w-]+)/)?.[1] || null
  let legalId = pathname.match(/^\/(privacy|terms|accessibility)$/)?.[1] || null
  if (eventId || legalId) return { eventId, legalId }
  // 2. A genuine hash fragment from an old #event/<id> link opened directly (rare ,
  // most browsers/apps preserve a real #, so this only fires for hand-typed/pasted links).
  eventId = hash.match(/^#event\/([\w-]+)/)?.[1] || null
  legalId = hash.match(/^#(privacy|terms|accessibility)$/)?.[1] || null
  if (eventId || legalId) return { eventId, legalId }
  // 3. Instagram (and similar link-in-bio tools) percent-encode a bare # as %23 when
  // rendering a bio/story link, so an old .../#event/<id> link arrives here as a
  // literal "/%23event/<id>" *pathname* ,  no real fragment at all ,  rather than a hash.
  // This is the exact breakage this migration fixes; a real path has no # to mangle.
  let decodedPath = pathname
  try { decodedPath = decodeURIComponent(pathname) } catch { /* malformed sequence, ignore */ }
  eventId = decodedPath.match(/^\/#event\/([\w-]+)/)?.[1] || null
  legalId = decodedPath.match(/^\/#(privacy|terms|accessibility)$/)?.[1] || null
  return { eventId, legalId }
}

const supabaseReady = Boolean(supabase)

function normalizeBooking(row = {}) {
  return {
    id: row.id,
    schoolId: row.school_id ?? row.schoolId ?? '',
    familyId: row.family_id ?? row.familyId ?? '',
    contactName: row.contact_name ?? row.contactName ?? '',
    contactEmail: row.contact_email ?? row.contactEmail ?? '',
    date: row.date ?? '',
    sessionType: row.session_type ?? row.sessionType ?? 'Full day (£490)',
    price: Number(row.price ?? 0),
    studentCount: Number(row.student_count ?? row.studentCount ?? 0),
    instructorId: row.instructor_id ?? row.instructorId ?? '',
    status: row.status ?? 'Enquiry',
    invoiceStatus: row.invoice_status ?? row.invoiceStatus ?? 'Not sent',
    invoiceNumber: row.invoice_number ?? row.invoiceNumber ?? '',
    notes: row.notes ?? '',
    requestedBy: row.requested_by ?? row.requestedBy ?? '',
    instructorPay: Number(row.instructor_pay ?? row.instructorPay ?? 0),
    needsAdminAttention: Boolean(row.needs_admin_attention ?? row.needsAdminAttention),
    completedAt: row.completed_at ?? row.completedAt ?? '',
    // 'pending' = checkout started but never paid ,  excluded from stats and notifications.
    paymentStatus: row.payment_status ?? row.paymentStatus ?? '',
    // Edits saved on the invoice (description, amounts, discount). Read-only here:
    // only the invoice endpoints write them.
    invoiceOverrides: row.invoice_overrides ?? row.invoiceOverrides ?? null,
    invoiceSentAt: row.invoice_sent_at ?? row.invoiceSentAt ?? '',
  }
}

// The invoice preview edits, seeded from what was last saved on the booking.
function withSavedInvoiceEdits(booking) {
  const saved = booking.invoiceOverrides || {}
  return {
    ...booking,
    ...(saved.description !== undefined ? { invoiceDescription: saved.description } : {}),
    ...(saved.rate !== undefined ? { invoiceRate: saved.rate } : {}),
    ...(saved.amount !== undefined ? { invoiceAmount: saved.amount } : {}),
    discountType: saved.discountType === 'amount' ? 'amount' : 'percent',
    discountPercent: saved.discountPercent ?? 0,
    discountAmount: saved.discountAmount ?? 0,
    discountCode: saved.discountCode || '',
  }
}

const invoiceEditPayload = (booking) => ({ description: booking.invoiceDescription, rate: booking.invoiceRate, amount: booking.invoiceAmount, discountType: booking.discountType || 'percent', discountPercent: booking.discountType === 'amount' ? undefined : booking.discountPercent, discountAmount: booking.discountType === 'amount' ? booking.discountAmount : undefined, discountCode: booking.discountCode || undefined })
const invoicePdfParams = (booking) => new URLSearchParams(Object.entries({ description: booking.invoiceDescription ?? booking.sessionType ?? '', rate: String(booking.invoiceRate ?? booking.price ?? 0), amount: String(booking.invoiceAmount ?? booking.price ?? 0), discountType: booking.discountType || 'percent', discountPercent: String(booking.discountPercent ?? 0), discountAmount: String(booking.discountAmount ?? 0), discountCode: booking.discountCode || '' }).filter(([, value]) => value !== ''))

// Totals exactly as the server prints them on the PDF (see invoiceTotals in server/index.js).
function invoicePreviewTotals(booking) {
  const subtotal = Math.max(0, Number(booking.invoiceAmount ?? booking.price ?? 0))
  const discount = booking.discountType === 'amount'
    ? Math.min(subtotal, Math.max(0, Number(booking.discountAmount || 0)))
    : subtotal * Math.min(100, Math.max(0, Number(booking.discountPercent || 0))) / 100
  const rounded = Math.round(discount * 100) / 100
  return { subtotal, discount: rounded, total: Math.max(0, Math.round((subtotal - rounded) * 100) / 100) }
}

function normalizeSchool(row = {}) {
  return {
    id: row.id,
    name: row.name ?? '',
    contactName: row.contact_name ?? row.contactName ?? '',
    email: row.email ?? '',
    phone: row.phone ?? '',
    notes: row.notes ?? '',
  }
}

function normalizeInstructor(row = {}) {
  return {
    id: row.id,
    name: row.name ?? '',
    email: row.email ?? '',
    phone: row.phone ?? '',
    rate: Number(row.rate ?? 0),
    locationAreas: row.location_areas ?? row.locationAreas ?? '',
    gender: row.gender ?? '',
    dbsStatus: row.dbs_status ?? row.dbsStatus ?? 'Missing',
    dbsFilePath: row.dbs_file_path ?? row.dbsFilePath ?? '',
    dbsUploadedAt: row.dbs_uploaded_at ?? row.dbsUploadedAt ?? '',
    dbsDecidedAt: row.dbs_decided_at ?? row.dbsDecidedAt ?? '',
    dbsRejectionReason: row.dbs_rejection_reason ?? row.dbsRejectionReason ?? '',
  }
}

function normalizeStudent(row = {}) {
  return { id: row.id, bookingId: row.booking_id ?? row.bookingId ?? '', familyId: row.family_id ?? row.familyId ?? '', parentName: row.parent_name ?? row.parentName ?? '', parentEmail: row.parent_email ?? row.parentEmail ?? '', name: row.name ?? '', dateOfBirth: row.date_of_birth ?? row.dateOfBirth ?? '', className: row.class_name ?? row.className ?? '', term: row.term ?? '', membershipStatus: row.membership_status ?? row.membershipStatus ?? 'active', dietaryRequirements: row.dietary_requirements ?? row.dietaryRequirements ?? '', medicalNotes: row.medical_notes ?? row.medicalNotes ?? '', photoConsent: row.photo_consent ?? row.photoConsent ?? null }
}

function normalizeJob(row = {}) {
  return { id: row.id, bookingId: row.booking_id ?? '', scheduledSessionId: row.scheduled_session_id ?? '', sessionDates: Array.isArray(row.session_dates) ? row.session_dates : [], date: row.date ?? '', sessionType: row.session_type ?? '', studentCount: Number(row.student_count ?? 0), locationArea: row.location_area ?? '', instructorPay: Number(row.instructor_pay ?? 0), status: row.status ?? 'open', claimedBy: row.claimed_by ?? '', rejectionReason: row.rejection_reason ?? '', claimedAt: row.claimed_at ?? row.claimedAt ?? '', decidedAt: row.decided_at ?? row.decidedAt ?? '' }
}

function normalizeMessage(row = {}) {
  return { id: row.id, senderKind: row.sender_kind ?? '', senderInstructorId: row.sender_instructor_id ?? '', senderSchoolId: row.sender_school_id ?? '', recipientKind: row.recipient_kind ?? '', recipientInstructorId: row.recipient_instructor_id ?? '', recipientSchoolId: row.recipient_school_id ?? '', body: row.body ?? '', readAt: row.read_at ?? '', createdAt: row.created_at ?? '' }
}

function toDbBooking(row) {
  return {
    id: row.id,
    school_id: row.schoolId,
    contact_name: row.contactName,
    contact_email: row.contactEmail,
    date: row.date,
    session_type: row.sessionType,
    price: Number(row.price ?? 0),
    student_count: Number(row.studentCount ?? 0),
    instructor_id: row.instructorId,
    status: row.status,
    invoice_status: row.invoiceStatus,
    invoice_number: row.invoiceNumber,
    notes: row.notes,
    requested_by: row.requestedBy || null,
    instructor_pay: Number(row.instructorPay || 0),
    needs_admin_attention: Boolean(row.needsAdminAttention),
    completed_at: row.completedAt || null,
    family_id: row.familyId || null,
  }
}

function toDbSchool(row) {
  return {
    id: row.id,
    name: row.name,
    contact_name: row.contactName,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
  }
}

function toDbInstructor(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    rate: Number(row.rate ?? 0),
    location_areas: row.locationAreas || '',
    gender: row.gender || null,
    dbs_status: row.dbsStatus || 'Missing',
    dbs_file_path: row.dbsFilePath || null,
    dbs_uploaded_at: row.dbsUploadedAt || null,
    dbs_decided_at: row.dbsDecidedAt || null,
    dbs_rejection_reason: row.dbsRejectionReason || null,
  }
}

function toDbStudent(row) {
  return { id: row.id, booking_id: row.bookingId, parent_name: row.parentName, parent_email: row.parentEmail, name: row.name, date_of_birth: row.dateOfBirth, class_name: row.className, term: row.term, membership_status: row.membershipStatus }
}

function toDbJob(row) {
  return { id: row.id, booking_id: row.bookingId || null, date: row.date, session_type: row.sessionType, student_count: Number(row.studentCount || 0), location_area: row.locationArea, instructor_pay: Number(row.instructorPay || 0), status: row.status, claimed_by: row.claimedBy || null, rejection_reason: row.rejectionReason || null, published_at: row.publishedAt, claimed_at: row.claimedAt || null, decided_at: row.decidedAt || null }
}

// Homepage content blocks (published ones for visitors; all of them for staff
// with the site area, via RLS), each with its linked published event attached.
async function loadSiteBlocks() {
  if (!supabaseReady) return null
  const { data, error } = await supabase.from('site_blocks').select('*').order('created_at')
  if (error) return null
  const eventIds = [...new Set((data || []).map((row) => row.event_id).filter(Boolean))]
  const { data: linked } = eventIds.length ? await supabase.from('events').select('*').in('id', eventIds).eq('status', 'published') : { data: [] }
  const byId = new Map((linked || []).map((row) => [row.id, normalizeEvent(row)]))
  return (data || []).map((row) => ({ ...row, event: byId.get(row.event_id) || null }))
}

async function loadTable(tableName, fallback) {
  if (!supabaseReady) {
    return parseStored(tableName, fallback)
  }

  const { data, error } = await supabase.from(tableName).select('*')
  if (error) {
    console.error(`Supabase load failed for ${tableName}:`, error)
    return []
  }

  if (!data || !data.length) return []

  if (tableName === 'bookings') return data.map(normalizeBooking)
  if (tableName === 'schools') return data.map(normalizeSchool)
  if (tableName === 'instructors') return data.map(normalizeInstructor)
    if (tableName === 'instructor_public_profiles') return data.map(normalizePublicInstructor)
  if (tableName === 'students') return data.map(normalizeStudent)
  if (tableName === 'job_board_jobs') return data.map(normalizeJob)
  if (tableName === 'messages') return data.map(normalizeMessage)
  if (tableName === 'events') return data.map(normalizeEvent)
  return data
}

async function saveTable(tableName, rows) {
  if (!supabaseReady) {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(tableName, JSON.stringify(rows))
    }
    return
  }

  const payload =
    tableName === 'bookings'
      ? rows.map(toDbBooking)
      : tableName === 'schools'
        ? rows.map(toDbSchool)
        : tableName === 'instructors'
          ? rows.map(toDbInstructor)
          : tableName === 'students'
            ? rows.map(toDbStudent)
            : tableName === 'job_board_jobs'
              ? rows.map(toDbJob)
          : rows

  // Returns the error so the caller can tell the user: a failed save must not look saved.
  const { error } = await supabase.from(tableName).upsert(payload, { onConflict: 'id' })
  return error || null
}

// Built-in workshop types plus every active staff-made session type (and the
// booking's current value, so an old or switched-off type still shows).
const PRESET_SESSION_TYPES = ['Full day (£490)', 'Half day', 'Single workshop', 'Custom']
function sessionTypeNames(sessionTypes = [], current = '') {
  return [...new Set([...PRESET_SESSION_TYPES.slice(0, 3), ...sessionTypes.map((type) => type.name), 'Custom', ...(current ? [current] : [])])]
}

function buildPrice({ studentCount, sessionType }, sessionTypes = []) {
  const baseMap = {
    'Full day (£490)': 490,
    'Half day': 260,
    'Single workshop': 150,
    Custom: 0,
  }

  const count = Number(studentCount || 0)
  const custom = sessionTypes.find((type) => type.name === sessionType)
  const base = baseMap[sessionType] ?? Number(custom?.default_price || 0)
  const staffNeeded = Math.max(1, Math.ceil(count / 30))
  if (custom && !custom.default_price) return { price: 0, staffNeeded, recommended: 'Custom quote' }

  if (sessionType === 'Custom') {
    return { price: 0, staffNeeded, recommended: 'Custom quote' }
  }

  return {
    price: base * staffNeeded,
    staffNeeded,
    recommended: staffNeeded > 1 ? `${staffNeeded} instructors recommended` : '1 instructor recommended',
  }
}

function Card({ children, style }) {
  return <div style={{ background: ivory, color: ink, border: `1px solid ${rule}`, borderRadius: 10, ...style }}>{children}</div>
}

// If a single homepage section throws during render, React would normally unmount
// the whole page. This boundary keeps the failure contained to that one section.
class SectionError extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error) { console.error(`Homepage section failed:`, error) }
  render() {
    if (this.state.failed) {
      return <section style={{ padding: '60px 20px', textAlign: 'center', fontFamily: sans, color: muted }}>This section could not load. Please refresh the page.</section>
    }
    return this.props.children
  }
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span style={{ display: 'block', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#767066', marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  )
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '9px 11px', fontFamily: 'inherit', fontSize: 14,
  color: ink, border: `1px solid ${rule}`, borderRadius: 6, outline: 'none', background: ivory,
}

function Button({ children, onClick, type = 'button', disabled, variant = 'primary', small = false }) {
  const styles = { primary: { background: emerald, color: ivory }, gold: { background: gold, color: emeraldLight }, ghost: { background: 'transparent', color: emerald, border: `1px solid ${rule}` }, danger: { background: 'transparent', color: warn, border: `1px solid ${rule}` } }
  return <button type={type} disabled={disabled} onClick={onClick} style={{ ...styles[variant], borderRadius: 6, padding: small ? '6px 11px' : '9px 18px', fontFamily: 'inherit', fontSize: small ? 12 : 13.5, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1 }}>{children}</button>
}

function Modal({ title, onClose, children, wide = false }) {
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, padding: 20, overflowY: 'auto', background: 'rgba(20,18,10,.45)' }}><div role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()} style={{ maxWidth: wide ? 680 : 500, margin: '20px auto', background: cream, borderRadius: 10, border: `1px solid ${rule}`, boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}><div style={{ padding: '16px 20px', borderBottom: `1px solid ${rule}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h3 style={{ margin: 0, fontFamily: serif, color: emerald, fontWeight: 400 }}>{title}</h3><button type="button" aria-label="Close" onClick={onClose} style={{ border: 0, background: 'none', cursor: 'pointer', fontSize: 18, color: muted }}>×</button></div><div style={{ padding: 20 }}>{children}</div></div></div>
}

function ResetPreview({ preview, counts, confirmText, onConfirmTextChange, onConfirm, busy }) {
  const groups = [
    { key: 'bookings', label: 'Bookings', rows: preview.bookings, describe: (row) => `${row.contact_name || 'Unknown'} · ${row.session_type || 'Booking'} · ${row.date || 'no date'} · £${Number(row.price || 0).toFixed(2)} · ${row.status}${row.payment_status ? ` · ${row.payment_status}` : ''}` },
    { key: 'students', label: 'Students', rows: preview.students, describe: (row) => `${row.name || 'Unnamed'} · ${row.parent_email || 'no email'}${row.class_name ? ` · ${row.class_name}` : ''} · ${row.membership_status}` },
    { key: 'parentFamilies', label: 'Family accounts', rows: preview.parentFamilies, describe: (row) => `${row.guardian_name || 'Unknown'} · ${row.guardian_email || 'no email'} · ${row.plan_type || 'no plan'} · ${row.membership_status}${row.stripe_subscription_id ? ' · has Stripe subscription' : ''}` },
    { key: 'eventTicketOrders', label: 'Event ticket orders', rows: preview.eventTicketOrders, describe: (row) => `${row.buyer_name || 'Unknown'} · ${row.buyer_email || 'no email'} · ${row.tier_name || 'Ticket'} × ${row.tickets} · £${(Number(row.total_pence || 0) / 100).toFixed(2)} · ${row.payment_status}` },
  ]
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  const confirmed = confirmText.trim().toUpperCase() === 'DELETE'
  return (
    <div style={{ display: 'grid', gap: 14, fontFamily: sans }}>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: ink }}>
        The following <strong>{total} record{total === 1 ? '' : 's'}</strong> will be permanently deleted. Site content (events, schools, instructors, class schedule, messages) is not touched, and nothing in Stripe is modified. Process any refunds separately in the Stripe dashboard.
      </p>
      {groups.map((group) => (
        <div key={group.key} style={{ border: `1px solid ${rule}`, borderRadius: 8, padding: '10px 12px', background: ivory }}>
          <strong style={{ fontSize: 13, color: emerald }}>{group.label} ({group.rows.length})</strong>
          {group.rows.length === 0 ? <div style={{ fontSize: 12.5, color: muted, marginTop: 6 }}>None.</div> : (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, display: 'grid', gap: 4 }}>
              {group.rows.map((row) => <li key={row.id} style={{ fontSize: 12.5, color: ink, lineHeight: 1.45 }}>{group.describe(row)}</li>)}
            </ul>
          )}
        </div>
      ))}
      {total > 0 ? (
        <>
          <Field label="Type DELETE to confirm"><input style={inputStyle} value={confirmText} onChange={(event) => onConfirmTextChange(event.target.value)} placeholder="DELETE" autoComplete="off" /></Field>
          <div><Button variant="danger" disabled={!confirmed || busy} onClick={onConfirm}>{busy ? 'Deleting…' : `Permanently delete ${total} record${total === 1 ? '' : 's'}`}</Button></div>
        </>
      ) : <p style={{ margin: 0, fontSize: 13, color: okGreen }}>Nothing to delete. The tables are already empty.</p>}
    </div>
  )
}

function statusTone(status) { return status === 'Confirmed' ? 'green' : status === 'Delivered' ? 'gold' : status === 'Cancelled' ? 'red' : 'default' }
function invoiceTone(status) { return status === 'Paid' ? 'green' : status === 'Sent' ? 'gold' : 'red' }
function Badge({ text, tone = 'default' }) { const colors = { default: ['#f1eee2', muted], green: ['#e6f0e9', okGreen], gold: ['#faf1d9', '#8a6d10'], red: ['#f7e9e4', warn] }; return <span style={{ background: colors[tone][0], color: colors[tone][1], borderRadius: 20, padding: '3px 9px', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{text}</span> }

function BookingForm({ booking, schools, instructors, families = [], sessionTypes = [], onSave, onDelete, onCreateFamily }) {
  const [form, setForm] = useState(booking)
  // Bill a school, or a parent/family (e.g. an offline family who owes for classes).
  const [billTo, setBillTo] = useState(booking.familyId && !booking.schoolId ? 'family' : 'school')
  const [newFamily, setNewFamily] = useState({ name: '', email: '' })
  const [saving, setSaving] = useState(false)
  const set = (field) => (event) => setForm({ ...form, [field]: event.target.value })
  const pickFamily = (familyId) => {
    const family = families.find((item) => item.id === familyId)
    setForm({ ...form, familyId, schoolId: '', ...(family ? { contactName: family.guardian_name || '', contactEmail: family.guardian_email || '' } : {}) })
  }
  const submit = async (event) => {
    event.preventDefault()
    const next = { ...form, price: Number(form.price || 0), studentCount: Number(form.studentCount || 0) }
    if (billTo === 'family') {
      next.schoolId = ''
      if (next.familyId === '__new') {
        setSaving(true)
        const familyId = await onCreateFamily({ name: newFamily.name.trim(), email: newFamily.email.trim().toLowerCase() })
        setSaving(false)
        if (!familyId) return
        Object.assign(next, { familyId, contactName: newFamily.name.trim(), contactEmail: newFamily.email.trim().toLowerCase() })
      }
    } else {
      next.familyId = ''
    }
    onSave(next)
  }
  return <form onSubmit={submit}>
    <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 13.5 }}>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="radio" checked={billTo === 'school'} onChange={() => setBillTo('school')} /> School booking</label>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="radio" checked={billTo === 'family'} onChange={() => setBillTo('family')} /> Parent / family</label>
    </div>
    {billTo === 'family' && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <Field label="Family"><select style={inputStyle} value={form.familyId || ''} onChange={(event) => pickFamily(event.target.value)} required><option value="">Select family</option>{families.map((family) => <option key={family.id} value={family.id}>{family.guardian_name || 'Family'} · {family.guardian_email}</option>)}<option value="__new">New family (not signed up yet)…</option></select></Field>
      {form.familyId === '__new' ? <>
        <Field label="Parent / guardian name"><input style={inputStyle} value={newFamily.name} onChange={(event) => setNewFamily({ ...newFamily, name: event.target.value })} required /></Field>
        <Field label="Parent / guardian email"><input type="email" style={inputStyle} value={newFamily.email} onChange={(event) => setNewFamily({ ...newFamily, email: event.target.value })} required /></Field>
        <p style={{ gridColumn: '1 / -1', margin: '-6px 0 8px', fontSize: 12, color: muted }}>When this parent signs up with the same email, this booking and its invoice appear in their account automatically.</p>
      </> : null}
    </div>}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {billTo === 'school' && <Field label="School"><select style={inputStyle} value={form.schoolId} onChange={set('schoolId')} required><option value="">Select school</option>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></Field>}
      <Field label="Date"><input type="date" style={inputStyle} value={form.date} onChange={set('date')} required /></Field>
      <Field label="Session type"><select style={inputStyle} value={form.sessionType} onChange={set('sessionType')}>{sessionTypeNames(sessionTypes, form.sessionType).map((name) => <option key={name}>{name}</option>)}</select></Field>
      <Field label="Price (£)"><input type="number" style={inputStyle} value={form.price} onChange={set('price')} /></Field>
      <Field label="Instructor pay (£)"><input type="number" style={inputStyle} value={form.instructorPay || ''} onChange={set('instructorPay')} placeholder="Set before publishing" /></Field>
      <Field label="Students"><input type="number" style={inputStyle} value={form.studentCount} onChange={set('studentCount')} /></Field>
      <Field label="Instructor"><select style={inputStyle} value={form.instructorId} onChange={set('instructorId')}><option value="">Unassigned</option>{instructors.map((instructor) => <option key={instructor.id} value={instructor.id}>{instructor.name}</option>)}</select></Field>
      <Field label="Booking status"><select style={inputStyle} value={form.status} onChange={set('status')}>{['Enquiry', 'Confirmed', 'Delivered', 'Cancelled'].map((status) => <option key={status}>{status}</option>)}</select></Field>
      <Field label="Invoice status"><select style={inputStyle} value={form.invoiceStatus} onChange={set('invoiceStatus')}>{['Not sent', 'Sent', 'Paid'].map((status) => <option key={status}>{status}</option>)}</select></Field>
    </div>
    {Number(form.studentCount) > 30 && <p style={{ color: warn, fontSize: 12.5 }}>Over 30 students: a second instructor is recommended.</p>}
    <Field label="Contact name"><input style={inputStyle} value={form.contactName} onChange={set('contactName')} /></Field>
    <Field label="Contact email"><input type="email" style={inputStyle} value={form.contactEmail} onChange={set('contactEmail')} /></Field>
    <Field label="Notes"><textarea style={{ ...inputStyle, minHeight: 70 }} value={form.notes} onChange={set('notes')} /></Field>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}><div>{onDelete && <Button variant="danger" onClick={onDelete}>Delete booking</Button>}</div><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save booking'}</Button></div>
  </form>
}

function SchoolForm({ school, onSave, onDelete }) {
  const [form, setForm] = useState(school)
  const set = (field) => (event) => setForm({ ...form, [field]: event.target.value })
  return <form onSubmit={(event) => { event.preventDefault(); onSave(form) }}><Field label="School name"><input style={inputStyle} value={form.name} onChange={set('name')} required /></Field><Field label="Contact name"><input style={inputStyle} value={form.contactName} onChange={set('contactName')} /></Field><Field label="Email"><input type="email" style={inputStyle} value={form.email} onChange={set('email')} /></Field><Field label="Phone"><input style={inputStyle} value={form.phone} onChange={set('phone')} /></Field><Field label="Notes"><textarea style={{ ...inputStyle, minHeight: 70 }} value={form.notes} onChange={set('notes')} /></Field><div style={{ display: 'flex', justifyContent: 'space-between' }}><div>{onDelete && <Button variant="danger" onClick={onDelete}>Delete</Button>}</div><Button type="submit">Save school</Button></div></form>
}

function SchoolRecord({ school, bookings, instructorLabel, onEdit, onBooking, onMessage, onClose }) {
  const related = bookings.filter((booking) => booking.schoolId === school.id)
  return <Modal title={school.name} onClose={onClose} wide><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}><div><strong>Contact</strong><p>{school.contactName || 'Not set'}<br />{school.email || 'No email'}<br />{school.phone || 'No phone'}</p></div><div><strong>Notes</strong><p>{school.notes || 'No notes'}</p></div></div><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}><h4 style={{ margin: 0, color: emerald }}>Bookings</h4><Button small onClick={() => onBooking({ ...emptyBooking(), schoolId: school.id, contactName: school.contactName, contactEmail: school.email })}>New booking</Button></div>{related.length === 0 ? <p style={{ color: muted }}>No bookings for this school.</p> : related.map((booking) => <div key={booking.id} onClick={() => onBooking(booking)} style={{ borderTop: `1px solid ${rule}`, padding: '10px 0', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}><span>{booking.date || 'No date'} · {booking.sessionType}<br /><small>{instructorLabel(booking) || 'Unassigned'}</small></span><span style={{ display: 'flex', gap: 6 }}><Badge text={booking.status} tone={statusTone(booking.status)} /><Badge text={booking.invoiceStatus} tone={invoiceTone(booking.invoiceStatus)} /></span></div>)}<div style={{ marginTop: 18, display: 'flex', gap: 8 }}><Button variant="ghost" onClick={() => onEdit(school)}>Edit school</Button><Button variant="ghost" onClick={() => onMessage(school)}>Message school</Button></div></Modal>
}

function InvoicePreview({ booking, onUpdate, onSave, onSaveEdits, onSend, onDownload, onRemind, sending, onClose, pdfUrl }) {
  const invoiceNumber = booking.invoiceNumber || 'Not numbered'
  const setInvoice = (field) => (event) => onUpdate({ [field]: event.target.value })
  const totals = invoicePreviewTotals(booking)
  const paid = booking.invoiceStatus === 'Paid'
  const money = (value) => `£${Number(value || 0).toFixed(2)}`
  return <Modal title={`Invoice ${invoiceNumber}`} onClose={onClose} wide><div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 0.8fr) minmax(0, 1.4fr)', gap: 18, alignItems: 'start' }}><div><h4 style={{ margin: '0 0 10px', color: emerald }}>{paid ? 'Paid invoice' : 'Edit before sending'}</h4><Field label="Line item description"><input style={inputStyle} disabled={paid} value={booking.invoiceDescription ?? booking.sessionType ?? ''} onChange={setInvoice('invoiceDescription')} /></Field><Field label="Rate"><input type="number" min="0" step="0.01" style={inputStyle} disabled={paid} value={booking.invoiceRate ?? booking.price ?? 0} onChange={setInvoice('invoiceRate')} /></Field><Field label="Amount"><input type="number" min="0" step="0.01" style={inputStyle} disabled={paid} value={booking.invoiceAmount ?? booking.price ?? 0} onChange={setInvoice('invoiceAmount')} /></Field>
    <Field label="Discount"><div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8 }}><select style={inputStyle} disabled={paid} value={booking.discountType || 'percent'} onChange={setInvoice('discountType')}><option value="percent">% off</option><option value="amount">£ off</option></select>{booking.discountType === 'amount'
      ? <input type="number" min="0" step="0.01" aria-label="Discount in pounds" style={inputStyle} disabled={paid} value={booking.discountAmount ?? 0} onChange={setInvoice('discountAmount')} />
      : <input type="number" min="0" max="100" step="0.01" aria-label="Discount percentage" style={inputStyle} disabled={paid} value={booking.discountPercent ?? 0} onChange={setInvoice('discountPercent')} />}</div></Field>
    {booking.discountCode && <p style={{ margin: '-6px 0 10px', fontSize: 12, color: muted }}>From discount code <strong>{booking.discountCode}</strong>.</p>}
    <div style={{ border: `1px solid ${rule}`, borderRadius: 8, background: ivory, padding: '10px 12px', fontSize: 13, display: 'grid', gap: 4 }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span>{money(totals.subtotal)}</span></div>{totals.discount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', color: muted }}><span>Discount</span><span>-{money(totals.discount)}</span></div>}<div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: emerald }}><span>Total due</span><span>{money(totals.total)}</span></div></div>
    {!paid && <div style={{ marginTop: 10 }}><Button small variant="ghost" disabled={sending} onClick={() => onSaveEdits(booking)}>Save changes</Button></div>}
  </div><div style={{ border: `1px solid ${rule}`, background: '#e9e5da', padding: 10, minHeight: 520 }}>{pdfUrl ? <iframe title={`Invoice ${invoiceNumber} PDF preview`} src={pdfUrl} style={{ display: 'block', width: '100%', height: 620, border: 0, background: '#fff' }} /> : <p style={{ padding: 18, color: muted }}>Loading designed invoice preview…</p>}</div></div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}><Button variant="gold" disabled={sending || paid} onClick={() => onSend(booking)}>{sending ? 'Sending…' : 'Send invoice'}</Button><Button variant="ghost" onClick={() => onDownload(booking)}>Download PDF</Button>{booking.invoiceStatus === 'Sent' && <Button variant="ghost" disabled={sending} onClick={() => onRemind(booking)}>Send reminder</Button>}<Button variant="ghost" onClick={() => onSave({ ...booking, invoiceStatus: 'Sent' })}>Mark sent</Button>{['Not sent', 'Sent', 'Paid'].map((status) => <Button key={status} variant={booking.invoiceStatus === status ? 'primary' : 'ghost'} onClick={() => onSave({ ...booking, invoiceStatus: status })}>{status}</Button>)}</div></Modal>
}

function InvoiceSettings({ settings, onSave, saving }) {
  const [local, setLocal] = useState(settings)
  const set = (field) => (event) => setLocal({ ...local, [field]: event.target.value })
  return <div><h2 style={{ fontFamily: serif, color: emerald, fontWeight: 400 }}>Invoice settings</h2><p style={{ color: muted }}>Payment details shown on generated invoices. Admin access only.</p><Card style={{ maxWidth: 560, padding: 20 }}><Field label="Bank account name"><input style={inputStyle} value={local.accountName} onChange={set('accountName')} required /></Field><Field label="Sort code"><input style={inputStyle} value={local.sortCode} onChange={set('sortCode')} required /></Field><Field label="Account number"><input style={inputStyle} value={local.accountNumber} onChange={set('accountNumber')} required /></Field><Button disabled={saving} onClick={() => onSave(local)}>{saving ? 'Saving…' : 'Save invoice settings'}</Button></Card></div>
}

function emptyBooking() { return { id: crypto.randomUUID(), schoolId: '', contactName: '', contactEmail: '', date: '', sessionType: 'Full day (£490)', price: 490, studentCount: '', instructorId: '', status: 'Enquiry', invoiceStatus: 'Not sent', invoiceNumber: '', notes: '' } }
function emptySchool() { return { id: crypto.randomUUID(), name: '', contactName: '', email: '', phone: '', notes: '' } }

function ageFromDob(dateOfBirth) {
  if (!dateOfBirth) return ''
  const today = new Date()
  const birth = new Date(`${dateOfBirth}T00:00:00`)
  let age = today.getFullYear() - birth.getFullYear()
  const beforeBirthday = today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())
  if (beforeBirthday) age -= 1
  return age
}

function birthdayDistance(dateOfBirth) {
  if (!dateOfBirth) return null
  const today = new Date()
  const birth = new Date(`${dateOfBirth}T00:00:00`)
  const next = new Date(today.getFullYear(), birth.getMonth(), birth.getDate())
  if (next < new Date(today.getFullYear(), today.getMonth(), today.getDate())) next.setFullYear(today.getFullYear() + 1)
  return Math.round((next - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000)
}

function InstructorForm({ instructor, onSave, onDelete }) {
  const [form, setForm] = useState(instructor)
  const set = (field) => (event) => setForm({ ...form, [field]: event.target.value })
  return <form onSubmit={(event) => { event.preventDefault(); onSave({ ...form, rate: Number(form.rate || 0) }) }}><Field label="Name"><input style={inputStyle} value={form.name} onChange={set('name')} required /></Field><Field label="Email"><input type="email" style={inputStyle} value={form.email} onChange={set('email')} /></Field><Field label="Phone"><input style={inputStyle} value={form.phone} onChange={set('phone')} /></Field><Field label="Rate per session (£)"><input type="number" style={inputStyle} value={form.rate} onChange={set('rate')} /></Field><Field label="Locations / areas"><input style={inputStyle} value={form.locationAreas} onChange={set('locationAreas')} placeholder="e.g. Birmingham, Solihull" /></Field><Field label="Gender (optional)"><select style={inputStyle} value={form.gender} onChange={set('gender')}><option value="">Prefer not to say</option><option>Female</option><option>Male</option><option>Non-binary</option><option>Self-describe</option></select></Field><div style={{ display: 'flex', justifyContent: 'space-between' }}><div>{onDelete && <Button variant="danger" onClick={onDelete}>Delete</Button>}</div><Button type="submit">Save instructor</Button></div></form>
}

function TemplateView({ template, onSave, readOnly = false }) {
  const [local, setLocal] = useState(template)
  if (readOnly) {
    const total = template.sections.reduce((sum, section) => sum + Number(section.minutes || 0), 0)
    return <div><h2 style={{ fontFamily: serif, color: emerald, fontWeight: 400 }}>Workshop template</h2><p style={{ color: muted }}>How every KADA workshop runs: {template.defaultDuration} minutes, up to {template.maxStudentsPerStaff} students per instructor.</p><Card style={{ padding: 20 }}>{template.sections.length ? template.sections.map((section, index) => <div key={section.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderTop: index ? `1px solid ${rule}` : 0 }}><span>{index + 1}. {section.title || 'Untitled section'}</span><strong>{section.minutes} min</strong></div>) : <p style={{ color: muted, margin: 0 }}>No sections yet.</p>}<p style={{ color: muted, fontSize: 12, margin: '10px 0 0' }}>{total} minutes in total</p>{template.notes && <p style={{ margin: '14px 0 0', lineHeight: 1.6 }}>{template.notes}</p>}</Card></div>
  }
  const setSection = (id, field, value) => setLocal({ ...local, sections: local.sections.map((section) => section.id === id ? { ...section, [field]: value } : section) })
  const total = local.sections.reduce((sum, section) => sum + Number(section.minutes || 0), 0)
  return <div><h2 style={{ fontFamily: serif, color: emerald, fontWeight: 400 }}>Workshop template</h2><p style={{ color: muted }}>Edit the live template used by instructors.</p><Card style={{ padding: 20 }}><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}><Field label="Default duration (minutes)"><input type="number" style={inputStyle} value={local.defaultDuration} onChange={(event) => setLocal({ ...local, defaultDuration: event.target.value })} /></Field><Field label="Max students per staff"><input type="number" style={inputStyle} value={local.maxStudentsPerStaff} onChange={(event) => setLocal({ ...local, maxStudentsPerStaff: event.target.value })} /></Field></div><p style={{ color: total === Number(local.defaultDuration) ? okGreen : warn, fontSize: 12 }}>{total} minutes total</p>{local.sections.length === 0 && <EmptyState icon="📝" title="No sections yet" body="Build the template instructors follow in every session, one section at a time." ctaLabel="Add first section" onCta={() => setLocal({ ...local, sections: [{ id: crypto.randomUUID(), title: '', minutes: 10 }] })} />}{local.sections.map((section, index) => <div key={section.id} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 90px', gap: 8, marginBottom: 8, alignItems: 'center' }}><span>{index + 1}</span><input style={inputStyle} value={section.title} onChange={(event) => setSection(section.id, 'title', event.target.value)} /><input type="number" style={inputStyle} value={section.minutes} onChange={(event) => setSection(section.id, 'minutes', event.target.value)} /></div>)}<Button variant="ghost" onClick={() => setLocal({ ...local, sections: [...local.sections, { id: crypto.randomUUID(), title: '', minutes: 10 }] })}>Add section</Button><Field label="Notes"><textarea style={{ ...inputStyle, minHeight: 80 }} value={local.notes} onChange={(event) => setLocal({ ...local, notes: event.target.value })} /></Field><Button onClick={() => onSave(local)}>Save template</Button></Card></div>
}

function BirthdayNotice({ students }) {
  const upcoming = students.filter((student) => student.membershipStatus === 'active' && birthdayDistance(student.dateOfBirth) !== null && birthdayDistance(student.dateOfBirth) <= 7)
  if (!upcoming.length) return null
  return <Card style={{ padding: 16, marginBottom: 18, background: '#fff8e8', borderColor: '#ead7a3' }}><strong style={{ color: emerald }}>Birthdays coming up</strong>{upcoming.map((student) => <p key={student.id} style={{ margin: '6px 0 0', color: ink, fontSize: 13 }}>{student.name} · {birthdayDistance(student.dateOfBirth) === 0 ? 'today' : `in ${birthdayDistance(student.dateOfBirth)} days`} · turning {ageFromDob(student.dateOfBirth) + 1}</p>)}</Card>
}

function NeedsAttention({ jobs, bookings, instructors, messages, schools, signups = [], isAdmin, canManageMessages, onOpenJobs, onOpenBookings, onOpenInstructors, onOpenMessages, onOpenStudents, dismissed, onDismiss }) {
  const weekAgo = Date.now() - 7 * 86400000
  const roleLabel = { parent: 'parent', instructor: 'instructor', school: 'school' }
  const notifications = [
    ...signups.map((signup) => ({ id: `signup:${signup.id}`, label: `New ${roleLabel[signup.role] || 'account'} sign-up · ${signup.name || signup.email} · ${signup.email}${signup.confirmed ? '' : ' · email not confirmed yet'}`, onOpen: signup.role === 'instructor' ? onOpenInstructors : signup.role === 'parent' ? onOpenStudents : onOpenBookings })),
    ...jobs.filter((job) => job.status === 'pending').map((job) => ({ id: `claim:${job.id}:${job.claimedAt || ''}`, label: `Job claim pending approval · ${job.date} · ${instructors.find((instructor) => instructor.id === job.claimedBy)?.name || 'Instructor'}`, onOpen: onOpenJobs })),
    ...jobs.filter((job) => job.status === 'accepted' && job.decidedAt && Date.parse(job.decidedAt) >= weekAgo).map((job) => ({ id: `accepted:${job.id}:${job.decidedAt}`, label: `Job accepted · ${job.date} · ${instructors.find((instructor) => instructor.id === job.claimedBy)?.name || 'Instructor'} assigned`, onOpen: onOpenJobs })),
    ...bookings.filter((booking) => booking.needsAdminAttention).map((booking) => ({ id: `completed:${booking.id}:${booking.completedAt || ''}`, label: `Session delivered · payment review needed · ${booking.date}`, onOpen: onOpenBookings })),
    // Paid (or free) checkouts only: a family invoice raised by the admin isn't a new booking.
    ...bookings.filter((booking) => booking.familyId && booking.status !== 'Cancelled' && booking.paymentStatus === 'paid' && !booking.invoiceSentAt).map((booking) => ({ id: `parent-booking:${booking.id}`, label: `New parent booking · ${booking.date} · ${booking.sessionType}`, onOpen: onOpenBookings })),
    ...bookings.filter((booking) => booking.status === 'Enquiry' && !booking.familyId).map((booking) => ({ id: `school-enquiry:${booking.id}`, label: `New school enquiry · ${booking.contactName || 'School contact'} · ${booking.date || 'Date to confirm'}`, onOpen: onOpenBookings })),
    ...(isAdmin ? instructors.filter((instructor) => instructor.dbsStatus === 'Pending').map((instructor) => ({ id: `dbs:${instructor.id}:${instructor.dbsUploadedAt || ''}`, label: `DBS certificate uploaded · review required · ${instructor.name}`, onOpen: onOpenInstructors })) : []),
    ...(canManageMessages ? messages.filter((message) => !message.readAt && message.recipientKind === 'admin').map((message) => ({ id: `message:${message.id}`, label: `New message · ${message.senderKind === 'instructor' ? instructors.find((instructor) => instructor.id === message.senderInstructorId)?.name || 'Instructor' : schools.find((school) => school.id === message.senderSchoolId)?.name || 'School'} · ${message.body.slice(0, 60)}${message.body.length > 60 ? '…' : ''}`, onOpen: onOpenMessages })) : []),
  ].filter((notification) => !dismissed.includes(notification.id))
  if (!notifications.length) return null
  return <Card style={{ padding: 18, marginBottom: 20, borderColor: '#ead7a3', background: '#fff8e8' }}><h3 style={{ margin: '0 0 10px', color: emerald }}>Needs attention</h3>{notifications.map((notification) => <div key={notification.id} style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: `1px solid ${rule}` }}><button type="button" onClick={notification.onOpen} style={{ flex: 1, display: 'block', padding: '9px 0', textAlign: 'left', border: 0, background: 'transparent', cursor: 'pointer', color: ink }}>{notification.label}</button><button type="button" aria-label={`Dismiss ${notification.label}`} title="Dismiss notification" onClick={() => onDismiss(notification.id)} style={{ border: 0, background: 'transparent', color: muted, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 6 }}>×</button></div>)}</Card>
}

function StudentPlansView({ students, canSeeAttendance, session, onStudentChanged = () => {} }) {
  // Attendance summary per child, for users who can read the register (RLS).
  const { rows: attendanceRows, error: attendanceError } = useAttendanceRows(canSeeAttendance)
  const attendance = new Map(childStats(attendanceRows || []).map((child) => [child.studentId, child]))
  // Clicking a student opens their full record (guardian, plan, bookings).
  const [openId, setOpenId] = useState('')
  const [notInClassKey, setNotInClassKey] = useState(0)
  const classChanged = (change) => { onStudentChanged(change); setNotInClassKey((key) => key + 1) }
  return <div><h2 style={{ fontFamily: serif, color: emerald, fontWeight: 400 }}>Students</h2><p style={{ color: muted }}>Current membership status{canSeeAttendance ? ' and attendance' : ''} by student. Click a student to open their full record.</p>{session && <NotInClassCard session={session} refreshKey={notInClassKey} onOpenChild={setOpenId} />}{attendanceError && <p style={{ color: '#a3401f' }}>{attendanceError}</p>}{openId && session && <StudentRecord session={session} studentId={openId} attendance={canSeeAttendance ? attendance.get(openId) || { marked: 0 } : null} onClassChanged={classChanged} onClose={() => setOpenId('')} />}<Card>{students.length ? students.map((student) => { const summary = attendance.get(student.id); return <div key={student.id} role="button" tabIndex={0} aria-label={`Open ${student.name}'s record`} onClick={() => setOpenId(student.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpenId(student.id) } }} className="student-row-link" style={{ padding: '13px 18px', borderTop: `1px solid ${rule}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', cursor: 'pointer' }}><div><strong style={{ color: emerald }}>{student.name}</strong>{student.className ? <div style={{ fontSize: 12, color: muted }}>{student.className}</div> : student.membershipStatus !== 'cancelled' && <div style={{ fontSize: 12, color: '#8a6d12' }}>Not in a class yet</div>}</div><div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>{canSeeAttendance && (summary ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}><span>Attended <strong>{summary.present}</strong> of {summary.marked} · <strong>{formatRate(summary.rate)}</strong></span><AttendanceDots history={summary.history} size={10} /></span> : <span style={{ fontSize: 12, color: muted }}>{attendanceRows ? 'No attendance marked yet' : ''}</span>)}<Badge text={student.membershipStatus} tone={student.membershipStatus === 'active' ? 'green' : student.membershipStatus === 'cancelled' ? 'red' : 'gold'} /></div></div> }) : <p style={{ padding: 18, color: muted }}>No students found.</p>}</Card></div>
}

function DbsUpload({ instructor, onUpload, uploading }) {
  const [file, setFile] = useState(null)
  if (!instructor) return null
  return <Card style={{ padding: 18, marginBottom: 20, borderColor: instructor.dbsStatus === 'Approved' ? rule : '#ead7a3', background: instructor.dbsStatus === 'Approved' ? ivory : '#fff8e8' }}><h3 style={{ margin: '0 0 10px', color: emerald }}>DBS certificate</h3><p style={{ color: muted, margin: '0 0 10px' }}>Your DBS must be approved before job board listings become available.</p><div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><Badge text={instructor.dbsStatus} tone={instructor.dbsStatus === 'Approved' ? 'green' : instructor.dbsStatus === 'Rejected' ? 'red' : 'gold'} />{instructor.dbsStatus === 'Rejected' && instructor.dbsRejectionReason && <span style={{ color: warn, fontSize: 12 }}>Rejected: {instructor.dbsRejectionReason}</span>}<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0] || null)} /><Button small disabled={!file || uploading} onClick={() => onUpload(file)}>{uploading ? 'Uploading…' : instructor.dbsStatus === 'Missing' ? 'Upload DBS' : 'Re-upload DBS'}</Button></div></Card>
}

// canManage: admins and staff with the 'messages' permission. They speak as KADA
// admin and can open a conversation with any instructor or school. Everyone else
// (instructors, schools) only ever talks to KADA admin.
function MessagesView({ messages, myKind, myInstructorId, mySchoolId, schools, instructors, canManage, onSend, onMarkRead }) {
  const isAdmin = canManage
  const [draft, setDraft] = useState('')
  const [target, setTarget] = useState(null)
  const [starting, setStarting] = useState('')
  const threads = {}
  messages.forEach((message) => {
    const other = message.senderKind === 'admin' ? (message.recipientKind === 'instructor' ? `instructor:${message.recipientInstructorId}` : message.recipientKind === 'school' ? `school:${message.recipientSchoolId}` : 'admin') : (message.senderKind === 'instructor' ? `instructor:${message.senderInstructorId}` : message.senderKind === 'school' ? `school:${message.senderSchoolId}` : 'admin')
    threads[other] = [...(threads[other] || []), message]
  })
  const threadKeys = Object.keys(threads).sort((a, b) => (threads[b].at(-1)?.createdAt || '').localeCompare(threads[a].at(-1)?.createdAt || ''))
  // A conversation picked from "New conversation" is active before it has any messages.
  const active = target && (threads[target] || isAdmin) ? target : threadKeys[0] || null
  const activeMessages = active && threads[active] ? threads[active].slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : []
  const threadLabel = (key) => { const [kind, id] = key.split(':'); return kind === 'instructor' ? instructors.find((instructor) => instructor.id === id)?.name || 'Instructor' : kind === 'school' ? schools.find((school) => school.id === id)?.name || 'School' : 'KADA Admin' }
  const unreadInThread = (key) => threads[key].filter((message) => !message.readAt && !(message.senderKind === myKind && (myKind === 'admin' || message.senderInstructorId === myInstructorId || message.senderSchoolId === mySchoolId))).length
  const send = () => {
    if (!draft.trim()) return
    if (isAdmin) {
      if (!active) return
      const [kind, id] = active.split(':')
      onSend({ senderKind: 'admin', recipientKind: kind, recipientInstructorId: kind === 'instructor' ? id : null, recipientSchoolId: kind === 'school' ? id : null, body: draft.trim() })
    } else {
      // Non-admin senders always message KADA admin ,  no existing thread required,
      // otherwise a school's/instructor's first ever message is silently dropped.
      onSend({ senderKind: myKind, senderInstructorId: myInstructorId || null, senderSchoolId: mySchoolId || null, recipientKind: 'admin', body: draft.trim() })
    }
    setDraft('')
  }
  useEffect(() => {
    if (!active || !threads[active]) return
    threads[active]
      .filter((message) => !message.readAt && !(message.senderKind === myKind && (myKind === 'admin' || message.senderInstructorId === myInstructorId || message.senderSchoolId === mySchoolId)))
      .forEach((message) => onMarkRead(message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, messages])
  const startOptions = [
    ...instructors.map((instructor) => ({ key: `instructor:${instructor.id}`, label: `Instructor · ${instructor.name}` })),
    ...schools.map((school) => ({ key: `school:${school.id}`, label: `School · ${school.name}` })),
  ].sort((a, b) => a.label.localeCompare(b.label))
  const threadList = active && !threads[active] ? [active, ...threadKeys] : threadKeys
  return <div><h2 style={{ fontFamily: serif, color: emerald, fontWeight: 400 }}>Messages</h2><p style={{ color: muted }}>{isAdmin ? 'Conversations with instructors and schools, as KADA admin.' : 'Your conversation with KADA admin.'}</p>{isAdmin && <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}><select aria-label="Start a conversation" style={{ ...inputStyle, maxWidth: 360 }} value={starting} onChange={(event) => setStarting(event.target.value)}><option value="">New conversation with…</option>{startOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select><Button small disabled={!starting} onClick={() => { setTarget(starting); setStarting('') }}>Open</Button></div>}<div className="messages-grid" style={{ display: 'grid', gridTemplateColumns: isAdmin ? 'minmax(160px, 220px) 1fr' : '1fr', gap: 14 }}>{isAdmin && <Card style={{ padding: 10 }}>{threadList.length ? threadList.map((key) => <button key={key} type="button" onClick={() => setTarget(key)} style={{ display: 'flex', justifyContent: 'space-between', width: '100%', padding: '9px 8px', border: 0, borderTop: `1px solid ${rule}`, background: active === key ? '#f1eee2' : 'transparent', cursor: 'pointer', color: ink, fontWeight: active === key ? 700 : 400, textAlign: 'left' }}><span>{threadLabel(key)}</span>{threads[key] && unreadInThread(key) > 0 && <span style={{ background: warn, color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{unreadInThread(key)}</span>}</button>) : <p style={{ color: muted, padding: 8, fontSize: 13 }}>No conversations yet.</p>}</Card>}<Card style={{ padding: 16 }}>{isAdmin && active && <p style={{ margin: '0 0 10px', fontWeight: 700, color: emerald }}>{threadLabel(active)}</p>}{activeMessages.length ? activeMessages.map((message) => { const mine = message.senderKind === myKind && (myKind === 'admin' || message.senderInstructorId === myInstructorId || message.senderSchoolId === mySchoolId); return <div key={message.id} style={{ marginBottom: 10, textAlign: mine ? 'right' : 'left' }}><div style={{ display: 'inline-block', maxWidth: '75%', background: mine ? emerald : '#f1eee2', color: mine ? '#fff' : ink, borderRadius: 10, padding: '8px 12px', fontSize: 13, lineHeight: 1.5, textAlign: 'left' }}>{message.body}</div><div style={{ fontSize: 11, color: muted, marginTop: 2 }}>{mine ? (myKind === 'admin' ? 'KADA admin' : 'You') : threadLabel(`${message.senderKind}:${message.senderInstructorId || message.senderSchoolId || ''}`)} · {new Date(message.createdAt).toLocaleString()}{!mine && !message.readAt ? ' · new' : ''}</div></div> }) : <p style={{ color: muted }}>No messages yet. {isAdmin ? (active ? 'Write the first message below.' : 'Choose who to message above.') : 'Send a message below to reach KADA admin.'}</p>}<div style={{ display: 'flex', gap: 8, marginTop: 12 }}><input style={inputStyle} placeholder="Write a message…" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') send() }} /><Button small onClick={send} disabled={!draft.trim() || (isAdmin && !active)}>Send</Button></div></Card></div></div>
}

const formatJobDay = (item) => `${new Date(`${item.date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}${item.start ? ` · ${item.start}${item.end ? `–${item.end}` : ''}` : ''}`

// The date(s) a session-type job covers. A combined job lists every date and is
// claimed as one; a separate job is one day of a longer session.
function JobDates({ job }) {
  const dates = job.sessionDates
  const combined = dates.length > 1
  return <div style={{ margin: '6px 0 0', fontSize: 13 }}>
    <span style={{ display: 'inline-block', background: combined ? '#e8eef9' : '#f1eee2', color: combined ? '#2d4a7a' : muted, borderRadius: 12, padding: '2px 9px', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>{combined ? `🔗 ${dates.length} dates, one job: claimed together` : dates[0]?.of > 1 ? `Day ${dates[0].position} of ${dates[0].of} · separate job` : 'Single date'}</span>
    {dates.map((item) => <div key={item.id} style={{ color: ink }}>{combined ? `Day ${item.position}: ` : ''}{formatJobDay(item)}</div>)}
  </div>
}

// canManage: admins and staff with the 'jobs' permission post jobs and decide
// claims. Instructors see open jobs and their own claims.
function JobBoardView({ jobs, bookings, schools, instructors, canManage, onClaim, onDecision, onPublish, onGoToBookings }) {
  const isAdmin = canManage
  const [reasonJob, setReasonJob] = useState(null)
  const [reason, setReason] = useState('')
  const [posting, setPosting] = useState(null) // { bookingId, pay, location }
  const [busy, setBusy] = useState(false)
  const postable = bookings.filter((booking) => booking.date && booking.status !== 'Cancelled' && booking.status !== 'Delivered' && !booking.familyId && !jobs.some((job) => job.bookingId === booking.id)).sort((a, b) => a.date.localeCompare(b.date))
  const bookingLabel = (booking) => `${booking.date} · ${schools.find((school) => school.id === booking.schoolId)?.name || booking.contactName || 'School'} · ${booking.sessionType} · ${booking.studentCount || 0} students`
  const publish = async () => {
    setBusy(true)
    const ok = await onPublish(posting)
    setBusy(false)
    if (ok) setPosting(null)
  }
  return <div><div style={{ marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}><div><h2 style={{ fontFamily: serif, color: emerald, fontWeight: 400, margin: 0 }}>Job board</h2><p style={{ color: muted, margin: '6px 0 0' }}>Available work is anonymized until a claim is accepted.</p></div>{isAdmin && <Button onClick={() => setPosting({ bookingId: '', pay: '', location: '' })}>Post a job</Button>}</div><Card style={{ padding: 18 }}>{jobs.length ? jobs.map((job) => <div key={job.id} style={{ borderTop: `1px solid ${rule}`, padding: '14px 0', display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}><div>{isAdmin && job.claimedBy && <p style={{ margin: '0 0 5px', color: emerald, fontWeight: 700 }}>Claimed by {instructors.find((instructor) => instructor.id === job.claimedBy)?.name || 'Instructor'}</p>}{isAdmin && job.claimedBy && <p style={{ margin: '0 0 5px', color: muted, fontSize: 12 }}>{(() => { const instructor = instructors.find((item) => item.id === job.claimedBy); return instructor ? `${instructor.email || 'No email'} · ${instructor.phone || 'No phone'} · ${instructor.locationAreas || 'No locations'} · ${instructor.gender || 'Gender not provided'}` : 'Instructor profile unavailable' })()}</p>}<strong>{job.status === 'accepted' && job.bookingId ? schools.find((school) => school.id === bookings.find((booking) => booking.id === job.bookingId)?.schoolId)?.name || 'School workshop' : job.scheduledSessionId ? job.sessionType : 'School workshop'}</strong><p style={{ margin: '4px 0 0', color: muted }}>{job.sessionDates.length ? job.sessionType : `${job.date} · ${job.sessionType}`} · {job.locationArea || 'Location shared after acceptance'} · {job.studentCount} students · {formatCurrency(job.instructorPay)}{job.sessionDates.length > 1 ? ' for all dates' : ''}</p>{job.sessionDates.length > 0 && <JobDates job={job} />}{job.status === 'rejected' && <p style={{ color: warn, margin: '4px 0 0' }}>Rejected: {job.rejectionReason}</p>}</div><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Badge text={job.status} tone={job.status === 'accepted' ? 'green' : job.status === 'rejected' ? 'red' : 'gold'} />{isAdmin && job.status === 'pending' && <><Button small onClick={() => onDecision(job, 'accepted')}>Accept</Button><Button small variant="danger" onClick={() => { setReasonJob(job); setReason('') }}>Reject</Button></>}{isAdmin && (job.status === 'accepted' || job.status === 'rejected') && <Button small variant="ghost" onClick={() => onDecision(job, 'undo')}>Undo</Button>}{!isAdmin && job.status === 'open' && <Button small onClick={() => onClaim(job)}>Claim job</Button>}{!isAdmin && job.status === 'pending' && <span style={{ color: muted, fontSize: 12 }}>Pending approval</span>}</div></div>) : <EmptyState icon="🧰" title="No jobs on the board yet" body={isAdmin ? 'Post a booking to the job board so approved instructors can claim it.' : 'New jobs appear here once KADA publishes them. Check back soon.'} ctaLabel={isAdmin ? 'Post a job' : undefined} onCta={isAdmin ? () => setPosting({ bookingId: '', pay: '', location: '' }) : undefined} />}</Card>
    {reasonJob && <Modal title="Reject claim" onClose={() => setReasonJob(null)}><Field label="Reason"><textarea style={{ ...inputStyle, minHeight: 80 }} value={reason} onChange={(event) => setReason(event.target.value)} required /></Field><Button disabled={!reason.trim()} onClick={() => { onDecision(reasonJob, 'rejected', reason); setReasonJob(null) }}>Reject claim</Button></Modal>}
    {posting && <Modal title="Post a job" onClose={() => setPosting(null)}>{postable.length ? <>
      <Field label="Booking"><select style={inputStyle} value={posting.bookingId} onChange={(event) => { const booking = postable.find((item) => item.id === event.target.value); setPosting({ ...posting, bookingId: event.target.value, pay: posting.pay || (booking?.instructorPay ? String(booking.instructorPay) : '') }) }}><option value="">Choose a booking</option>{postable.map((booking) => <option key={booking.id} value={booking.id}>{bookingLabel(booking)}</option>)}</select></Field>
      <Field label="Instructor pay (£)"><input type="number" min="1" step="0.01" style={inputStyle} value={posting.pay} onChange={(event) => setPosting({ ...posting, pay: event.target.value })} /></Field>
      <Field label="Area shown to instructors (optional)"><input style={inputStyle} placeholder="e.g. North Birmingham" value={posting.location} onChange={(event) => setPosting({ ...posting, location: event.target.value })} /></Field>
      <p style={{ fontSize: 12, color: muted, margin: '0 0 12px' }}>Instructors see the date, session, students, area and pay. The school is only shown once you accept a claim.</p>
      <Button disabled={busy || !posting.bookingId || !(Number(posting.pay) > 0)} onClick={publish}>{busy ? 'Posting…' : 'Post to job board'}</Button>
    </> : <><p style={{ color: muted, marginTop: 0 }}>Every upcoming school booking with a date is already on the board.</p><Button variant="ghost" onClick={() => { setPosting(null); onGoToBookings() }}>Go to bookings</Button></>}</Modal>}
  </div>
}



function AuthScreen({ onAuthenticated, requirePasswordSetup = false, initialMessage = '' }) {
  const [mode, setMode] = useState(requirePasswordSetup ? 'setup' : 'signin')
  const [role, setRole] = useState('school')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [schoolName, setSchoolName] = useState('')
  const [children, setChildren] = useState([{ name: '', dateOfBirth: '' }])
  const [message, setMessage] = useState(initialMessage)
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')

    try {
      if (mode === 'forgot') {
        const response = await fetch('/api/public/password-reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) })
        const result = await response.json()
        if (!response.ok) setMessage(result.error || 'Unable to send a reset link. Please try again.')
        else setMessage(result.message)
      } else if (mode === 'setup') {
        if (password !== confirmPassword) {
          setMessage('Passwords do not match.')
          return
        }
        const { error } = await supabase.auth.updateUser({ password })
        if (error) setMessage(error.message)
        else onAuthenticated()
      } else if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) setMessage(error.message)
        else onAuthenticated()
      } else {
        // Children are carried on the account and added to the family when the
        // parent first signs in (see resolveParentFamily in server/index.js).
        const childList = role === 'parent' ? children.map((child) => ({ name: child.name.trim(), dateOfBirth: child.dateOfBirth })).filter((child) => child.name && child.dateOfBirth) : []
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          // An address missing from Supabase's Redirect URLs falls back to its Site URL.
          options: { emailRedirectTo: window.location.origin, data: { role, full_name: fullName, school_name: schoolName, ...(childList.length ? { children: childList } : {}) } },
        })
        if (error) {
          setMessage(error.message)
        } else if (data.user) {
          void fetch('/api/public/signup-ping', { method: 'POST' }).catch(() => {})
          setMessage('Account created. Check your email if confirmation is enabled, then sign in.')
        }
      }
    } catch (error) {
      setMessage(error.message || 'Unable to connect. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ minHeight: '100vh', background: cream, display: 'grid', placeItems: 'center', padding: 24, fontFamily: sans }}>
      <div style={{ width: '100%', maxWidth: 430 }}>
        <p style={{ color: gold, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 700 }}>King's Ark Dance Academy</p>
        <h1 style={{ fontFamily: serif, color: emerald, fontSize: 32, fontWeight: 400, margin: '6px 0 8px' }}>{mode === 'setup' ? 'Set your password.' : mode === 'forgot' ? 'Reset your password.' : mode === 'signin' ? 'Welcome back.' : 'Create an account.'}</h1>
        <p style={{ color: muted, fontSize: 14, marginBottom: 24 }}>{mode === 'setup' ? 'Choose a new password of at least 8 characters.' : mode === 'forgot' ? 'Enter your account email and we will send you a password reset link.' : mode === 'signin' ? 'Sign in to access your KADA workspace.' : 'Create a parent, school or instructor account.'}</p>
        <Card style={{ padding: 22 }}>
          <form onSubmit={submit}>
            {mode === 'signup' && <>
              <Field label="Account type"><select style={inputStyle} value={role} onChange={(event) => setRole(event.target.value)}><option value="parent">Parent</option><option value="school">School</option><option value="instructor">Instructor</option></select></Field>
              <Field label="Full name"><input style={inputStyle} value={fullName} onChange={(event) => setFullName(event.target.value)} required /></Field>
              {role === 'school' && <Field label="School name"><input style={inputStyle} value={schoolName} onChange={(event) => setSchoolName(event.target.value)} required /></Field>}
              {role === 'parent' && <div style={{ marginBottom: 14 }}>
                <span style={{ display: 'block', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: muted, marginBottom: 6 }}>Your children (you can add more later)</span>
                {children.map((child, index) => <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 150px auto', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                  <input aria-label={`Child ${index + 1} name`} style={inputStyle} placeholder={`Child ${index + 1} name`} value={child.name} onChange={(event) => setChildren(children.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} required={Boolean(child.dateOfBirth)} />
                  <input aria-label={`Child ${index + 1} date of birth`} type="date" style={inputStyle} value={child.dateOfBirth} onChange={(event) => setChildren(children.map((item, itemIndex) => itemIndex === index ? { ...item, dateOfBirth: event.target.value } : item))} required={Boolean(child.name.trim())} />
                  {children.length > 1 ? <button type="button" aria-label={`Remove child ${index + 1}`} onClick={() => setChildren(children.filter((_, itemIndex) => itemIndex !== index))} style={{ border: 0, background: 'none', color: warn, cursor: 'pointer', fontSize: 18 }}>×</button> : <span />}
                </div>)}
                <button type="button" onClick={() => setChildren([...children, { name: '', dateOfBirth: '' }])} style={{ background: 'none', border: 0, padding: 0, color: emerald, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>+ Add another child</button>
              </div>}
            </>}
            {mode !== 'setup' && <Field label="Email"><input type="email" autoComplete="email" style={inputStyle} value={email} onChange={(event) => setEmail(event.target.value)} required /></Field>}
            {mode !== 'forgot' && <Field label={mode === 'setup' ? 'New password' : 'Password'}><input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength="8" style={inputStyle} value={password} onChange={(event) => setPassword(event.target.value)} required /></Field>}
            {mode === 'setup' && <Field label="Confirm new password"><input type="password" autoComplete="new-password" minLength="8" style={inputStyle} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></Field>}
            {mode === 'signin' && <button type="button" disabled={busy} onClick={() => { setMode('forgot'); setMessage('') }} style={{ display: 'block', margin: '0 0 18px', background: 'none', border: 0, padding: '6px 0', color: emerald, fontFamily: sans, fontSize: 15, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}>Forgot password?</button>}
            <Button type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'setup' ? 'Save password and continue' : mode === 'forgot' ? 'Send reset link' : mode === 'signin' ? 'Sign in' : 'Create account'}</Button>
          </form>
          {message && <p role="status" style={{ fontSize: 13, lineHeight: 1.5, color: message.includes('created') || message.startsWith('If an account') ? okGreen : warn, margin: '16px 0 0' }}>{message}</p>}
          {mode !== 'setup' && <button type="button" disabled={busy} onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage(''); setPassword('') }} style={{ marginTop: 18, background: 'none', border: 'none', padding: 0, color: emerald, fontFamily: sans, fontSize: 13, cursor: 'pointer' }}>{mode === 'signin' ? 'Create a new account' : 'Back to sign in'}</button>}
        </Card>
      </div>
    </main>
  )
}

function App() {
  const [view, setView] = useState('site')
  const pendingPublicSection = useRef(null)
  const pendingOpsRecord = useRef(null)
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [authReady, setAuthReady] = useState(!supabaseReady)
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false)
  const [authLinkError, setAuthLinkError] = useState('')
  const [bookings, setBookings] = useState(defaultBookings)
  const [schools, setSchools] = useState(defaultSchools)
  const [instructors, setInstructors] = useState(defaultInstructors)
    const [publicInstructors, setPublicInstructors] = useState([])
  const [template, setTemplate] = useState(() => parseStored('kada-template', defaultTemplate))
  const [tab, setTab] = useState('dashboard')
  const [bookingSearch, setBookingSearch] = useState('')
  const [schoolSearch, setSchoolSearch] = useState('')
  const [instructorSearch, setInstructorSearch] = useState('')
  const [instructorSort, setInstructorSort] = useState('name')
  const [showAllBookings, setShowAllBookings] = useState(false)
  const [showAllSchools, setShowAllSchools] = useState(false)
  const [showAllInstructors, setShowAllInstructors] = useState(false)
  const [bookingModal, setBookingModal] = useState(null)
  const [schoolModal, setSchoolModal] = useState(null)
  const [schoolRecord, setSchoolRecord] = useState(null)
  const [instructorModal, setInstructorModal] = useState(null)
  const [invoiceBooking, setInvoiceBooking] = useState(null)
  const [invoicePdfUrl, setInvoicePdfUrl] = useState('')
  const [messageTarget, setMessageTarget] = useState(null)
  const [messageDraft, setMessageDraft] = useState('')
  const [dbsUploading, setDbsUploading] = useState(false)
  const [invoiceSettings, setInvoiceSettings] = useState({ accountName: '', sortCode: '', accountNumber: '' })
  const [invoiceSettingsSaving, setInvoiceSettingsSaving] = useState(false)
  const [quote, setQuote] = useState(null)
  const [toast, setToast] = useState('')
  const [dismissedNotifications, setDismissedNotifications] = useState(() => parseStored('kada-dismissed-notifications', []))
  const [schoolRequest, setSchoolRequest] = useState({
    schoolName: '',
    contactName: '',
    email: '',
    studentCount: 45,
    sessionType: 'Full day (£490)',
    date: new Date().toISOString().slice(0, 10),
    notes: '',
  })

  useEffect(() => {
    if (view !== 'site' || !pendingPublicSection.current) return undefined
    const target = pendingPublicSection.current
    const frame = window.requestAnimationFrame(() => {
      document.querySelector(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      pendingPublicSection.current = null
    })
    return () => window.cancelAnimationFrame(frame)
  }, [view])
  const [parentBooking, setParentBooking] = useState({ planType: 'monthly_membership', className: 'Saturday Gospel Afrobeats', classDate: '', parentName: '', parentEmail: '', students: [{ name: '', dateOfBirth: '' }] })
  const [students, setStudents] = useState([])
  const [families, setFamilies] = useState([])
  const [parentInvoices, setParentInvoices] = useState([])
  const [signups, setSignups] = useState([])
  const [sessionEntries, setSessionEntries] = useState([]) // scheduled session-type dates for the Calendar
  const [sessionTypes, setSessionTypes] = useState([]) // active session types for the booking forms
  const [sessionsVersion, setSessionsVersion] = useState(0)
  const [jobs, setJobs] = useState([])
  const [messages, setMessages] = useState([])
  const [events, setEvents] = useState([])
  const [promoteEventId, setPromoteEventId] = useState('')
  const [ticketOrders, setTicketOrders] = useState([])
  const [eventModal, setEventModal] = useState(null)
  const [eventPageId, setEventPageId] = useState(() => parseRoute().eventId)
  const [legalPageId, setLegalPageId] = useState(() => parseRoute().legalId)
  const [payLinkSlug, setPayLinkSlug] = useState(() => parseRoute().paySlug)
  const [paymentLinkFocus, setPaymentLinkFocus] = useState('')
  const [siteEvents, setSiteEvents] = useState([])
  const [sectionLayout, setSectionLayout] = useState([])
  // Custom homepage content blocks (Homepage layout > Add content block).
  const [siteBlocks, setSiteBlocks] = useState([])
  const [siteContent, setSiteContent] = useState({})
  const [classSessions, setClassSessions] = useState([])
  const [classSessionsVersion, setClassSessionsVersion] = useState(0)
  const [subscriptionBusyId, setSubscriptionBusyId] = useState('')
  const [resetPreview, setResetPreview] = useState(null)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetConfirmText, setResetConfirmText] = useState('')
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [invoiceSending, setInvoiceSending] = useState(false)
  const [publicMenuOpen, setPublicMenuOpen] = useState(false)
  const [opsOpenGroups, setOpsOpenGroups] = useState(() => new Set(['Operations', 'Events', 'Sales', 'Your family']))
  const [publicForm, setPublicForm] = useState(null)
  const [classBookingSuccess, setClassBookingSuccess] = useState(null) // null | 'loading' | 'pending' | booking details object
  const headerRef = useRef(null)

  useEffect(() => {
    if (!publicMenuOpen) return undefined
    const closeOnOutsideTap = (event) => {
      if (!headerRef.current?.contains(event.target)) setPublicMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideTap)
    return () => document.removeEventListener('pointerdown', closeOnOutsideTap)
  }, [publicMenuOpen])

  // Anonymous site analytics: record each public navigation (path + referrer
  // only, no personal data). Skips the admin/ops dashboard itself.
  useEffect(() => {
    if (view !== 'site' && !eventPageId && !legalPageId && !payLinkSlug) return undefined
    const track = () => {
      fetch('/api/track/pageview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: window.location.pathname !== '/' ? window.location.pathname : (window.location.hash || '/'), referrer: document.referrer || '' }),
        keepalive: true,
      }).catch(() => {})
    }
    track()
    window.addEventListener('hashchange', track)
    window.addEventListener('popstate', track)
    return () => {
      window.removeEventListener('hashchange', track)
      window.removeEventListener('popstate', track)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, eventPageId, legalPageId, payLinkSlug])

  // Public pages live at /event/<id> (ticketed events) and /privacy /terms
  // /accessibility (legal pages) ,  all reachable by guests without sign-in.
  // Supabase auth links (invite / password setup) arrive as
  // #access_token=…&type=recovery ,  the client signs in from the hash itself.
  useEffect(() => {
    const syncRoute = () => {
      const hash = window.location.hash || ''
      if (hash.includes('access_token=') || hash.includes('token_hash=')) return // Supabase/invite auth hash being consumed
      const { eventId, legalId, paySlug } = parseRoute()
      // Migrate an already-shared #event/<id> or #privacy-style link to its real
      // URL path so old links keep working instead of breaking.
      if (eventId && window.location.pathname !== `/event/${eventId}`) {
        window.history.replaceState(null, '', `/event/${eventId}${window.location.search}`)
      } else if (legalId && window.location.pathname !== `/${legalId}`) {
        window.history.replaceState(null, '', `/${legalId}`)
      }
      setEventPageId(eventId)
      setLegalPageId(legalId)
      setPayLinkSlug(paySlug)
    }
    window.addEventListener('hashchange', syncRoute)
    window.addEventListener('popstate', syncRoute)
    return () => {
      window.removeEventListener('hashchange', syncRoute)
      window.removeEventListener('popstate', syncRoute)
    }
  }, [])

  // Class booking success ,  Stripe redirects back to ?payment=success&session_id=…
  // Poll for the webhook-recorded booking (the webhook can lag a second or two),
  // then show an on-screen confirmation; a confirmation email arrives separately.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get('session_id') || ''
    if (params.get('payment') !== 'success' || !sessionId) return undefined
    setClassBookingSuccess('loading')
    window.history.replaceState(null, '', `${window.location.pathname}#classes`)
    let cancelled = false
    let attempts = 0
    const poll = async () => {
      attempts += 1
      try {
        const response = await fetch(`/api/stripe/class-booking/${encodeURIComponent(sessionId)}`)
        if (response.ok) {
          const result = await response.json()
          if (!cancelled) setClassBookingSuccess(result.booking)
          return
        }
      } catch { /* retry below */ }
      if (!cancelled && attempts < 10) window.setTimeout(poll, 1500)
      else if (!cancelled) setClassBookingSuccess('pending')
    }
    poll()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!supabase) return undefined

    let mounted = true
    const loadSession = async () => {
      const { tokenHash, type, isAuthLink: authHash, needsPasswordSetup: isRecoveryLink } = initialAuthCallback
      let callbackError = initialAuthCallback.error
      if (tokenHash && !callbackError) {
        if (type !== 'recovery' && type !== 'invite') callbackError = 'Invalid password reset link.'
        else {
          const { error } = await verifyAuthToken(tokenHash, type)
          callbackError = error?.message
        }
      }
      const { data, error: sessionError } = await supabase.auth.getSession()
      callbackError ||= sessionError?.message
      let sessionNow = data.session
      if (!sessionNow && authHash && !callbackError) {
        await new Promise((resolve) => window.setTimeout(resolve, 600))
        const retry = await supabase.auth.getSession()
        sessionNow = retry.data.session
      }
      if (!mounted) return
      setSession(sessionNow)
      setAuthReady(true)
      if (authHash) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${sessionNow && !callbackError ? '#ops' : ''}`)
        if (sessionNow && !callbackError) {
          // Recovery/invite links mean the person must set a password first.
          if (isRecoveryLink) {
            window.sessionStorage.setItem('kada-password-setup-user', sessionNow.user.id)
            setNeedsPasswordSetup(true)
          }
          setView('ops')
          return
        }
        setNeedsPasswordSetup(false)
        setView('auth')
        setAuthLinkError('That password reset or invitation link is invalid or has expired. Request a new link.')
        return
      }
      if (sessionNow && window.sessionStorage.getItem('kada-password-setup-user') === sessionNow.user.id) {
        setNeedsPasswordSetup(true)
        setView('ops')
      }
      // Deep link into a specific dashboard tab/record, e.g. #ops/bookings/book-123 from an admin email.
      const opsMatch = window.location.hash.match(/^#ops\/([\w-]+)(?:\/([\w-]+))?/)
      if (opsMatch && sessionNow) {
        setTab(opsMatch[1])
        if (opsMatch[2]) pendingOpsRecord.current = { tab: opsMatch[1], id: opsMatch[2] }
        setView('ops')
        // Keep the tab in the hash so a refresh lands back on the same page;
        // only strip the optional record id.
        if (opsMatch[2]) window.history.replaceState(null, '', `${window.location.pathname + window.location.search}#ops/${opsMatch[1]}`)
      }
    }
    loadSession()
    const reloadAuthCallback = () => {
      if (readAuthCallback(window.location.hash).isAuthLink) window.location.reload()
    }
    window.addEventListener('hashchange', reloadAuthCallback)

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession)
      if (event === 'PASSWORD_RECOVERY' && nextSession) {
        window.sessionStorage.setItem('kada-password-setup-user', nextSession.user.id)
        setNeedsPasswordSetup(true)
        setView('ops')
      }
      if (!nextSession) {
        setProfile(null)
        setNeedsPasswordSetup(false)
        window.sessionStorage.removeItem('kada-password-setup-user')
        setView('site')
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
      }
    })

    return () => {
      mounted = false
      window.removeEventListener('hashchange', reloadAuthCallback)
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session || !supabaseReady) return undefined
    let mounted = true

    const loadRecords = async () => {
      const { data: nextProfile } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
      const parentResponse = nextProfile?.role === 'parent'
        ? await fetch('/api/parent/dashboard', { headers: { Authorization: `Bearer ${session.access_token}` } })
        : null
      const parentData = parentResponse?.ok ? await parentResponse.json() : null
      const [nextBookings, nextSchools, nextInstructors, nextPublicInstructors, nextStudents, nextFamilies, nextJobs, nextMessages, nextEvents, nextTicketOrders, templateResponse] = await Promise.all([
        loadTable('bookings', []),
        loadTable('schools', []),
        loadTable('instructors', []),
        loadTable('instructor_public_profiles', []),
        loadTable('students', []),
        loadTable('parent_families', []),
        loadTable('job_board_jobs', []),
        loadTable('messages', []),
        loadTable('events', []),
        loadTable('event_ticket_orders', []),
        supabase.from('workshop_template').select('*').limit(1).maybeSingle(),
      ])

      if (!mounted) return
      setBookings(parentData ? parentData.bookings.map(normalizeBooking) : nextBookings)
      setSchools(nextSchools)
      setInstructors(nextInstructors)
        setPublicInstructors(nextPublicInstructors)
      setStudents(parentData ? parentData.students.map(normalizeStudent) : nextStudents)
      setFamilies(parentData ? (parentData.family ? [parentData.family] : []) : nextFamilies)
      setParentInvoices(parentData?.invoices || [])
      setJobs(nextJobs)
      setMessages(nextMessages)
      setEvents(nextEvents)
      setTicketOrders(nextTicketOrders)
      setTemplate(templateResponse.data
        ? { sections: templateResponse.data.sections || [], maxStudentsPerStaff: templateResponse.data.max_students_per_staff || 30, defaultDuration: templateResponse.data.default_duration || 45, notes: templateResponse.data.notes || '' }
        : parseStored('kada-template', defaultTemplate))
      setProfile(nextProfile)

      // Open the specific record an admin email linked to (now that records are loaded).
      const pending = pendingOpsRecord.current
      if (pending && nextProfile?.role === 'admin') {
        pendingOpsRecord.current = null
        if (pending.tab === 'bookings') { const found = (nextBookings || []).find((item) => item.id === pending.id); if (found) setBookingModal(found) }
        if (pending.tab === 'schools') { const found = (nextSchools || []).find((item) => item.id === pending.id); if (found) setSchoolRecord(found) }
        if (pending.tab === 'instructors') { const found = (nextInstructors || []).find((item) => item.id === pending.id); if (found) setInstructorModal(found) }
        if (pending.tab === 'events-published' || pending.tab === 'events-drafts' || pending.tab === 'events-archived') { const found = (nextEvents || []).map(normalizeEvent).find((item) => item.id === pending.id); if (found) setEventModal(found) }
        if (pending.tab === 'payment-links') setPaymentLinkFocus(pending.id)
      }
    }

    loadRecords()

    return () => {
      mounted = false
    }
  }, [session])

  useEffect(() => {
    const canSeeInvoiceSettings = profile?.role === 'admin' || (profile?.role === 'staff' && (profile?.permissions || []).includes('sales'))
    if (!supabaseReady || !canSeeInvoiceSettings) return undefined
    let mounted = true
    supabase.from('invoice_settings').select('account_name,sort_code,account_number').eq('id', 'default').maybeSingle().then(({ data }) => {
      if (mounted && data) setInvoiceSettings({ accountName: data.account_name || '', sortCode: data.sort_code || '', accountNumber: data.account_number || '' })
    })
    return () => { mounted = false }
  }, [profile?.role])

  useEffect(() => {
    if (!supabaseReady || view !== 'site') return undefined
    const today = new Date().toISOString().slice(0, 10)
    let mounted = true
    supabase.from('events').select('*').eq('status', 'published').eq('show_on_homepage', true).gte('event_date', today).order('event_date', { ascending: true }).limit(6).then(({ data, error }) => {
      if (error) console.error('Homepage events failed to load:', error)
      if (mounted && !error && data) setSiteEvents(data.map(normalizeEvent))
    })
    return () => { mounted = false }
  }, [view])

  // Homepage section layout (visible + order) ,  read by guests and by the Site Layout admin page.
  useEffect(() => {
    if (!supabaseReady) return undefined
    let mounted = true
    supabase.from('site_sections').select('*').order('sort_order').then(({ data, error }) => {
      if (mounted && !error && data?.length) {
        setSectionLayout(data.map((row) => ({ sectionKey: row.section_key, label: row.label, visible: row.visible, sortOrder: row.sort_order, template: row.template || '', mirror: Boolean(row.mirror) })))
      }
    })
    loadSiteBlocks().then((blocks) => { if (mounted && blocks) setSiteBlocks(blocks) })
    return () => { mounted = false }
  }, [view])

  // Homepage copy/team/contact/prices ,  key/value rows from site_content,
  // editable from Operations > Site > Site content. Public read, admin write.
  useEffect(() => {
    if (!supabaseReady) return undefined
    let mounted = true
    supabase.from('site_content').select('key,value').then(({ data, error }) => {
      if (mounted && !error && data?.length) {
        setSiteContent(Object.fromEntries(data.map((row) => [row.key, row.value])))
      }
    })
    return () => { mounted = false }
  }, [view])

  // A custom logo (Settings > Branding) also replaces the browser tab icon.
  useEffect(() => {
    applySiteFavicon(siteContent.branding?.logoUrl)
  }, [siteContent.branding?.logoUrl])

  // Weekly class schedule ,  guests/parents get bookable (active) sessions for the
  // public booking form; admins get every row for the Class schedule page.
  useEffect(() => {
    if (!supabaseReady) return undefined
    let mounted = true
    let query = supabase.from('class_sessions').select('*').order('day_of_week').order('start_time')
    if (profile?.role !== 'admin') query = query.eq('active', true)
    query.then(({ data, error }) => { if (mounted && !error && data) setClassSessions(data) })
    return () => { mounted = false }
  }, [profile?.role, classSessionsVersion])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('kada-bookings', JSON.stringify(bookings))
      window.localStorage.setItem('kada-schools', JSON.stringify(schools))
      window.localStorage.setItem('kada-instructors', JSON.stringify(instructors))
      window.localStorage.setItem('kada-template', JSON.stringify(template))
    }
  }, [bookings, schools, instructors, template])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 2000)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    window.localStorage.setItem('kada-dismissed-notifications', JSON.stringify(dismissedNotifications))
  }, [dismissedNotifications])

  useEffect(() => {
    if (!supabaseReady || profile?.role !== 'admin' || (tab !== 'dashboard' && tab !== 'instructors')) return undefined
    let mounted = true
    supabase.from('instructors').select('*').then(({ data, error }) => {
      if (mounted && !error && data) setInstructors(data.map(normalizeInstructor))
    })
    return () => { mounted = false }
  }, [tab, profile?.role])

  // Active session types (Operations > Session types) for every session-type dropdown,
  // including the public school enquiry form.
  useEffect(() => {
    if (!supabaseReady) return undefined
    let mounted = true
    supabase.from('session_types').select('id,name,default_price').eq('active', true).order('name').then(({ data, error }) => { if (mounted && !error) setSessionTypes(data || []) })
    return () => { mounted = false }
  }, [sessionsVersion])

  // Scheduled session dates for the Calendar, and fresh jobs after scheduling.
  useEffect(() => {
    if (!session || !profile) return undefined
    let mounted = true
    fetch('/api/sessions/calendar', { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((response) => (response.ok ? response.json() : { entries: [] }))
      .then((result) => { if (mounted) setSessionEntries(result.entries || []) })
      .catch(() => {})
    if (sessionsVersion) loadTable('job_board_jobs', []).then((rows) => { if (mounted) setJobs(rows) })
    return () => { mounted = false }
  }, [session, profile, sessionsVersion, tab])

  // New self-service sign-ups (parents, instructors, schools) for Needs attention.
  useEffect(() => {
    if (!session || profile?.role !== 'admin' || tab !== 'dashboard') return undefined
    let mounted = true
    fetch('/api/admin/recent-signups', { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((response) => (response.ok ? response.json() : { signups: [] }))
      .then((result) => { if (mounted) setSignups(result.signups || []) })
      .catch(() => {})
    return () => { mounted = false }
  }, [session, profile?.role, tab])

  // Re-runs whenever new .reveal elements can appear: async data mounting a section (e.g.
  // Upcoming events only renders once the events fetch returns), or HomePage remounting
  // after an event/legal page closes. Otherwise they're never observed and stay at opacity 0.
  useEffect(() => {
    if (view !== 'site' || !authReady) return undefined
    const revealItems = document.querySelectorAll('.site-public .reveal:not(.in)')
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        entry.target.classList.add('in')
        observer.unobserve(entry.target)
      })
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' })
    revealItems.forEach((item) => {
      observer.observe(item)
      const rect = item.getBoundingClientRect()
      if (rect.top < window.innerHeight && rect.bottom > 0) item.classList.add('in')
    })
    const onScroll = () => {
      document.querySelectorAll('.site-public [data-parallax]').forEach((item) => {
        const speed = Number(item.dataset.parallax || 0.12)
        item.style.transform = `translateY(${window.scrollY * speed}px)`
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', onScroll)
    }
  }, [view, authReady, siteEvents, sectionLayout, eventPageId, legalPageId, payLinkSlug])

  const conflicts = useMemo(() => {
    const map = {}
    bookings.forEach((booking) => {
      if (!booking.date || !booking.instructorId || booking.status === 'Cancelled') return
      const key = `${booking.date}|${booking.instructorId}`
      map[key] = (map[key] || []).concat(booking.id)
    })
    return new Set(
      Object.values(map)
        .filter((ids) => ids.length > 1)
        .flat(),
    )
  }, [bookings])

  const stats = useMemo(() => {
    // Abandoned checkouts sit at paymentStatus 'pending' ,  they are not real
    // bookings, so keep them out of the dashboard numbers entirely.
    // Superseded ones were covered by a membership, so they bring in nothing either.
    const live = bookings.filter((booking) => booking.status !== 'Cancelled' && !['pending', 'superseded'].includes(booking.paymentStatus))
    const upcomingCount = live.length
    const classRevenue = live.reduce((sum, booking) => sum + Number(booking.price || 0), 0)
    const eventRevenue = ticketOrders
      .filter((order) => order.payment_status === 'paid')
      .reduce((sum, order) => sum + Number(order.total_pence || 0), 0) / 100
    const confirmedRevenue = classRevenue + eventRevenue
    const unpaidInvoices = live.filter((booking) => booking.invoiceStatus !== 'Paid').length
    return { upcomingCount, classRevenue, eventRevenue, confirmedRevenue, unpaidInvoices }
  }, [bookings, ticketOrders])

  const handleQuoteChange = (field, value) => {
    setSchoolRequest((previous) => ({ ...previous, [field]: value }))
  }

  const navigatePublicSection = (event, target) => {
    event.preventDefault()
    setPublicMenuOpen(false)
    if (view !== 'site') {
      pendingPublicSection.current = target
      setView('site')
      return
    }
    document.querySelector(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const openPublicForm = (event, form) => {
    event.preventDefault()
    setPublicForm(form)
    setPublicMenuOpen(false)
  }

  const startClassCheckout = async (event) => {
    event.preventDefault()
    setCheckoutBusy(true)
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
      const response = await fetch('/api/stripe/create-checkout-session', { method: 'POST', headers, body: JSON.stringify(parentBooking) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Checkout could not be started.')
      window.location.assign(result.url)
    } catch (error) {
      setToast(error.message)
      setCheckoutBusy(false)
    }
  }

  // Parent dashboard checkout ,  same endpoint, but the form data comes from the
  // parent portal rather than the public homepage modal.
  const startParentCheckout = async (booking) => {
    setCheckoutBusy(true)
    try {
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }
      const response = await fetch('/api/stripe/create-checkout-session', { method: 'POST', headers, body: JSON.stringify(booking) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Checkout could not be started.')
      window.location.assign(result.url)
    } catch (error) {
      setToast(error.message)
      setCheckoutBusy(false)
    }
  }

  const handleQuoteSubmit = (event) => {
    event.preventDefault()
    if (!session) {
      setView('auth')
      setToast('Sign in or create a school account to request a booking.')
      return
    }
    if (profile?.role === 'instructor') {
      setToast('Instructor accounts cannot request school bookings.')
      return
    }
    const priceData = buildPrice(schoolRequest, sessionTypes)
    const needed = priceData.staffNeeded
    // RLS hides the instructors table from school accounts, so only staff roles
    // can see real availability ,  schools always see 0 available here.
    const canSeeInstructors = profile?.role === 'admin' || profile?.role === 'instructor'
    const available = canSeeInstructors
      ? instructors.filter((instructor) => {
        const assigned = bookings.some(
          (booking) =>
            booking.date === schoolRequest.date &&
            booking.instructorId === instructor.id &&
            booking.status !== 'Cancelled',
        )
        return !assigned
      })
      : []

    const fits = canSeeInstructors ? available.length >= needed : null
    setQuote({
      ...schoolRequest,
      price: priceData.price,
      staffNeeded: needed,
      availableInstructors: canSeeInstructors ? available.length : null,
      statusText: fits === null ? 'Enquiry received' : fits ? 'Ready to book' : 'Callback required',
      canBook: fits !== false,
    })

    // Every enquiry is filed ,  even when staffing needs a callback ,  so the
    // request never vanishes and the admin is always notified.
    const bookingId = `book-${Date.now()}`
    const schoolId = profile?.school_id || `school-${Date.now()}`
    const booking = {
      id: bookingId,
      schoolId,
      contactName: schoolRequest.contactName || 'School contact',
      contactEmail: schoolRequest.email || 'school@example.com',
      date: schoolRequest.date,
      sessionType: schoolRequest.sessionType,
      price: priceData.price,
      studentCount: Number(schoolRequest.studentCount || 0),
      instructorId: canSeeInstructors ? available[0]?.id || '' : '',
      status: 'Enquiry',
      invoiceStatus: 'Not sent',
      invoiceNumber: '',
      notes: `${schoolRequest.notes || 'School enquiry received via website form'}${fits === false ? '. Needs instructor coverage review' : ''}`,
      requestedBy: session.user.id,
    }

    const schoolRecord = {
      id: schoolId,
      name: schoolRequest.schoolName,
      contactName: schoolRequest.contactName,
      email: schoolRequest.email,
      phone: '',
      notes: 'Website enquiry',
    }

    const nextBookings = [booking, ...bookings]
    const nextSchools = schools.some((school) => school.name === schoolRequest.schoolName)
      ? schools
      : [schoolRecord, ...schools]

    setBookings(nextBookings)
    setSchools(nextSchools)
    void saveRows('schools', nextSchools)
    const discountCode = String(schoolRequest.discountCode || '').trim()
    void (async () => {
      if (await saveRows('bookings', nextBookings)) return
      // School bookings are invoiced: the code becomes a discount on this booking's invoice.
      let codeNote = ''
      if (discountCode) {
        const response = await fetch('/api/discount-codes/apply-booking', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId, code: discountCode }) })
        const result = await response.json().catch(() => ({}))
        codeNote = response.ok ? ` Discount code ${result.code} (${result.label}) will be on your invoice.` : ` ${result.error || 'The discount code could not be applied.'}`
      }
      void fetch('/api/notify-admin', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'school-enquiry', detail: { schoolName: schoolRequest.schoolName, contactName: schoolRequest.contactName, email: schoolRequest.email, sessionType: schoolRequest.sessionType, date: schoolRequest.date, studentCount: schoolRequest.studentCount, schoolId, discountCode } }) })
      setToast(`${fits === false ? 'Booking sent. Our team will confirm instructor coverage for this date.' : 'Booking sent to the operations system.'}${codeNote}`)
    })()
  }

  const quotePrice = quote ? quote.price : buildPrice(schoolRequest, sessionTypes).price
  const quoteStaff = quote ? quote.staffNeeded : buildPrice(schoolRequest, sessionTypes).staffNeeded
  const isAdmin = profile?.role === 'admin'
  const isInstructor = profile?.role === 'instructor'
  const isStaff = profile?.role === 'staff'
  // Staff only see the areas an admin granted them in Team & access. Admins pass every check.
  const can = (area) => isAdmin || (isStaff && (profile?.permissions || []).includes(area))
  const toggleOpsGroup = (label) => {
    setOpsOpenGroups((current) => {
      const next = new Set(current)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  const TABLE_LABELS = { bookings: 'Booking', schools: 'School', instructors: 'Instructor', students: 'Student', job_board_jobs: 'Job' }
  const saveRows = async (tableName, rows) => {
    const error = await saveTable(tableName, rows)
    if (error) setToast(`${TABLE_LABELS[tableName] || 'Record'} changes were NOT saved: ${error.message}. Refresh to see what is stored.`)
    return error
  }
  const persistRows = (tableName, rows, setter) => { setter(rows); void saveRows(tableName, rows) }
  const sendInvoice = async (booking) => {
    const school = schools.find((item) => item.id === booking.schoolId)
    setInvoiceSending(true)
    try {
      const invoiceOverrides = invoiceEditPayload(booking)
      const response = await fetch('/api/invoices/send', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ booking: { ...booking, invoiceOverrides }, school }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Invoice could not be sent.')
      const sentBooking = { ...booking, invoiceStatus: 'Sent', invoiceNumber: result.invoiceNumber || booking.invoiceNumber, invoiceOverrides: result.overrides || invoiceOverrides }
      const next = bookings.some((item) => item.id === sentBooking.id) ? bookings.map((item) => item.id === sentBooking.id ? sentBooking : item) : [sentBooking, ...bookings]
      setBookings(next)
      setInvoiceBooking(sentBooking)
      setToast(`Invoice sent to ${result.recipient}.`)
    } catch (error) {
      setToast(error.message)
    } finally {
      setInvoiceSending(false)
    }
  }
  const saveBooking = async (booking) => {
    const previous = bookings.find((item) => item.id === booking.id)
    const next = bookings.some((item) => item.id === booking.id) ? bookings.map((item) => item.id === booking.id ? booking : item) : [booking, ...bookings]
    setBookings(next)
    setBookingModal(null)
    // The row must exist before the invoice endpoint numbers it and marks it sent.
    if (await saveRows('bookings', next)) return
    if (booking.status === 'Confirmed' && booking.invoiceStatus === 'Not sent' && booking.paymentStatus !== 'superseded' && previous?.status !== 'Confirmed' && (schools.find((item) => item.id === booking.schoolId)?.email || booking.contactEmail)) await sendInvoice(booking)
  }
  const saveSchool = (school) => { const next = schools.some((item) => item.id === school.id) ? schools.map((item) => item.id === school.id ? school : item) : [school, ...schools]; persistRows('schools', next, setSchools); setSchoolModal(null); setSchoolRecord(next.find((item) => item.id === school.id) || null) }
  const saveInstructor = (instructor) => { const next = instructors.some((item) => item.id === instructor.id) ? instructors.map((item) => item.id === instructor.id ? instructor : item) : [instructor, ...instructors]; persistRows('instructors', next, setInstructors); setInstructorModal(null) }
  const deleteBooking = async (booking) => {
    if (!window.confirm(`Delete the booking for ${booking.sessionType || 'this session'} on ${booking.date || 'this date'}? This cannot be undone.`)) return
    const previous = bookings
    const next = bookings.filter((item) => item.id !== booking.id)
    setBookings(next)
    setBookingModal(null)
    const { error } = await supabase.from('bookings').delete().eq('id', booking.id)
    if (error) { setBookings(previous); setToast(`Booking could not be deleted: ${error.message}`); return }
    if (typeof window !== 'undefined') window.localStorage.setItem('bookings', JSON.stringify(next))
    setToast('Booking deleted.')
  }
  const authedPost = async (path, body) => {
    const response = await fetch(path, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || 'Something went wrong.')
    return result
  }
  // Job board writes go through the server, which checks the job board permission.
  const publishJob = async ({ bookingId, pay, location }) => {
    try {
      const { job } = await authedPost('/api/jobs/publish', { bookingId, pay, location })
      setJobs((current) => [normalizeJob(job), ...current])
      setBookings((current) => current.map((item) => item.id === bookingId ? { ...item, instructorPay: Number(job.instructor_pay) } : item))
      setToast('Job posted to the job board.')
      return true
    } catch (error) {
      setToast(error.message)
      return false
    }
  }
  // Claims only this job. (Upserting the whole board failed whenever an instructor
  // could see more than one job: RLS only lets them move an open job to pending.)
  const claimJob = async (job) => {
    const claimedAt = new Date().toISOString()
    const { data, error } = await supabase.from('job_board_jobs').update({ status: 'pending', claimed_by: profile.instructor_id, claimed_at: claimedAt, decided_at: null }).eq('id', job.id).eq('status', 'open').select('*')
    if (error || !data?.length) { setToast(error?.message || 'Someone else has just claimed this job.'); return }
    setJobs((current) => current.map((item) => item.id === job.id ? normalizeJob(data[0]) : item))
    setToast(job.sessionDates.length > 1 ? `Claimed all ${job.sessionDates.length} dates. Waiting for KADA to confirm.` : 'Job claimed. Waiting for KADA to confirm.')
    void fetch('/api/notify-admin', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'job-claim', detail: { sessionType: job.sessionType, date: job.sessionDates.length > 1 ? job.sessionDates.map((item) => item.date).join(' + ') : job.date, claimedBy: instructors.find((instructor) => instructor.id === profile.instructor_id)?.name || profile.instructor_id } }) })
  }
  const decideJob = async (job, decision, rejectionReason = '') => {
    try {
      const { job: saved } = await authedPost(`/api/jobs/${encodeURIComponent(job.id)}/decision`, { decision, reason: rejectionReason })
      const updated = normalizeJob(saved)
      setJobs((current) => current.map((item) => item.id === job.id ? updated : item))
      if (decision === 'accepted' || (decision === 'undo' && job.status === 'accepted')) setBookings((current) => current.map((item) => item.id === job.bookingId ? { ...item, instructorId: decision === 'accepted' ? job.claimedBy : '' } : item))
      setToast(decision === 'accepted' ? 'Claim accepted. The instructor is now assigned to the booking.' : decision === 'rejected' ? 'Claim rejected.' : 'Decision undone.')
    } catch (error) {
      setToast(error.message)
    }
  }
  const saveTemplate = async (next) => { setTemplate(next); window.localStorage.setItem('kada-template', JSON.stringify(next)); const { data: current } = await supabase.from('workshop_template').select('id').limit(1).maybeSingle(); const row = { id: current?.id || 'default', max_students_per_staff: Number(next.maxStudentsPerStaff), default_duration: Number(next.defaultDuration), sections: next.sections, notes: next.notes }; const { error } = await supabase.from('workshop_template').upsert(row, { onConflict: 'id' }); setToast(error ? 'Template could not be saved.' : 'Workshop template saved.') }
  const saveEvent = async (event) => {
    const previousEvents = events
    setEvents((current) => current.some((item) => item.id === event.id) ? current.map((item) => item.id === event.id ? event : item) : [event, ...current])
    setEventModal(null)
    const { error } = await supabase.from('events').upsert(toDbEvent(event), { onConflict: 'id' })
    if (error) {
      setEvents(previousEvents) // revert optimistic update so a failed archive/publish doesn't stick
      setToast(`Event could not be saved: ${error.message}`)
    } else {
      setToast(`Event "${event.title || 'Untitled'}" saved.`)
    }
  }
  // Deleting an event with ticket orders would destroy sales history, so the
  // database blocks it (FK RESTRICT). Offer archiving instead; only events with
  // no orders get the hard-delete confirm.
  const deleteEvent = async (event) => {
    const { count } = await supabase.from('event_ticket_orders').select('id', { count: 'exact', head: true }).eq('event_id', event.id)
    if ((count || 0) > 0) {
      if (window.confirm(`"${event.title || 'Untitled'}" has ${count} ticket order${count === 1 ? '' : 's'} on record and can't be deleted without losing sales history. Archive it instead? It disappears from the public site but stays in the Archived tab.`)) {
        await saveEvent({ ...event, status: 'archived', showOnHomepage: false })
      }
      return
    }
    if (!window.confirm(`Delete "${event.title || 'Untitled'}" permanently? This cannot be undone.`)) return
    if (event.flyerPath) await supabase.storage.from('event-flyers').remove([event.flyerPath])
    const { error } = await supabase.from('events').delete().eq('id', event.id)
    if (error) { setToast(`Event could not be deleted: ${error.message}`); return }
    setEvents((current) => current.filter((item) => item.id !== event.id))
    setToast('Event deleted.')
  }
  const uploadEventFlyer = async (eventId, file) => {
    let flyer
    try { flyer = await compressFlyer(file) } catch (error) { setToast(error.message); return '' }
    // Each upload gets a new path, so browsers can cache it for a year.
    const path = `${eventId}/${Date.now()}-${flyerFileName(file.name)}`
    const { error } = await supabase.storage.from('event-flyers').upload(path, flyer.blob, { cacheControl: '31536000', upsert: true, contentType: 'image/jpeg' })
    if (error) { setToast(error.message || 'Flyer could not be uploaded.'); return '' }
    const resized = flyer.width !== flyer.originalWidth ? `, resized from ${flyer.originalWidth}×${flyer.originalHeight}` : ''
    setToast(`Flyer uploaded: ${flyer.width}×${flyer.height} JPEG, ${Math.round(flyer.blob.size / 1024)} KB${resized}.`)
    return path
  }
  const saveSectionLayout = async (next) => {
    setSectionLayout(next)
    const { error } = await supabase.from('site_sections').upsert(next.map((section) => ({ section_key: section.sectionKey, label: section.label, visible: section.visible, sort_order: section.sortOrder, template: section.template || null, mirror: Boolean(section.mirror) })))
    setToast(error ? `Layout could not be saved: ${/template|mirror/.test(error.message) ? 'apply supabase/migrations/20261003_site_block_templates.sql first' : error.message}` : 'Homepage layout updated.')
  }
  // Create or edit a content block; a new one is added to the end of the homepage.
  const saveSiteBlock = async (block) => {
    const isNew = !block.id
    const id = block.id || `blk-${crypto.randomUUID().slice(0, 12)}`
    const row = { id, kind: block.kind, template: block.template, mirror: Boolean(block.mirror), eyebrow: block.eyebrow || '', title: block.title, body: block.body || '', image_url: block.image_url || '', cta_label: block.cta_label || '', cta_action: block.cta_action || 'none', cta_url: block.cta_url || '', event_id: block.event_id || null, items: block.items || [], published: block.published !== false, updated_at: new Date().toISOString() }
    const { error } = await supabase.from('site_blocks').upsert(row, { onConflict: 'id' })
    if (error) { setToast(`Content block could not be saved: ${/site_blocks/.test(error.message) ? 'apply supabase/migrations/20261003_site_block_templates.sql first' : error.message}`); return null }
    const layout = sectionLayout.length ? sectionLayout : DEFAULT_SECTION_ORDER
    const sectionKey = `block:${id}`
    const existing = layout.find((section) => section.sectionKey === sectionKey)
    const section = existing ? { ...existing, label: row.title } : { sectionKey, label: row.title, visible: true, sortOrder: Math.max(0, ...layout.map((item) => item.sortOrder)) + 10, template: '', mirror: false }
    const { error: sectionError } = await supabase.from('site_sections').upsert({ section_key: section.sectionKey, label: section.label, visible: section.visible, sort_order: section.sortOrder, template: null, mirror: false })
    if (sectionError) { setToast(`The block was saved but could not be placed on the homepage: ${sectionError.message}`); return null }
    setSectionLayout([...layout.filter((item) => item.sectionKey !== sectionKey), section])
    const blocks = await loadSiteBlocks()
    if (blocks) setSiteBlocks(blocks)
    setToast(isNew ? `"${row.title}" added to the homepage.` : `"${row.title}" saved.`)
    return id
  }
  const deleteSiteBlock = async (id) => {
    const { error } = await supabase.from('site_blocks').delete().eq('id', id)
    if (error) { setToast(`Content block could not be deleted: ${error.message}`); return }
    const { error: sectionError } = await supabase.from('site_sections').delete().eq('section_key', `block:${id}`)
    if (sectionError) setToast(`The block was deleted, but its homepage slot could not be removed: ${sectionError.message}`)
    setSectionLayout((current) => current.filter((section) => section.sectionKey !== `block:${id}`))
    setSiteBlocks((current) => current.filter((block) => block.id !== id))
    setToast('Content block removed from the homepage.')
  }
  const saveSiteContent = async (key, value) => {
    setSiteContent((current) => ({ ...current, [key]: value }))
    const { error } = await supabase.from('site_content').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    setToast(error ? `Content could not be saved: ${error.message}` : 'Site content updated. Live on the homepage now.')
  }
  const saveClassSession = async (sessionRow, changes) => {
    const payload = { ...changes }
    if (payload.day_of_week !== undefined) payload.day_of_week = Number(payload.day_of_week)
    setClassSessions((current) => current.map((item) => item.id === sessionRow.id ? { ...item, ...payload } : item))
    const { error } = await supabase.from('class_sessions').update(payload).eq('id', sessionRow.id)
    if (error) setToast(`Class session could not be saved: ${error.message}`)
    else setClassSessionsVersion((version) => version + 1)
  }
  const addClassSession = async (draft) => {
    const { error } = await supabase.from('class_sessions').insert({ name: draft.name, day_of_week: Number(draft.day_of_week), start_time: draft.start_time, end_time: draft.end_time || null, description: draft.description || null, active: true })
    setToast(error ? `Class session could not be added: ${error.message}` : `Class "${draft.name}" added to the schedule.`)
    if (!error) setClassSessionsVersion((version) => version + 1)
  }
  const deleteClassSession = async (sessionRow) => {
    const { error } = await supabase.from('class_sessions').delete().eq('id', sessionRow.id)
    setToast(error ? `Class session could not be removed: ${error.message}` : `Class "${sessionRow.name}" removed from the schedule.`)
    if (!error) setClassSessionsVersion((version) => version + 1)
  }
  const saveFamily = async (family, changes) => {
    setFamilies((current) => current.map((item) => item.id === family.id ? { ...item, ...changes } : item))
    const { error } = await supabase.from('parent_families').update({ ...changes, updated_at: new Date().toISOString() }).eq('id', family.id)
    if (error) {
      setFamilies((current) => current.map((item) => item.id === family.id ? family : item))
      setToast(`Family record could not be saved: ${error.message}`)
      return
    }
    // Marking a family cancelled by hand means its children have left too (off the
    // register); marking it active again brings those children back.
    const status = changes.membership_status
    if (status === 'cancelled' || (status === 'active' && family.membership_status === 'cancelled')) {
      const query = supabase.from('students').update({ membership_status: status }).eq('family_id', family.id)
      const { data: changed, error: studentError } = await (status === 'active' ? query.eq('membership_status', 'cancelled') : query).select('id')
      if (studentError) {
        setToast(`The family is marked ${status}, but its children could NOT be: ${/membership_status_check/.test(studentError.message) ? 'apply supabase/migrations/20261003_students_cancelled_status.sql first' : studentError.message}`)
        return
      }
      const ids = new Set((changed || []).map((row) => row.id))
      setStudents((current) => current.map((student) => ids.has(student.id) ? { ...student, membershipStatus: status } : student))
      setToast(`Family marked ${status}${ids.size ? `, with ${ids.size} child${ids.size === 1 ? '' : 'ren'}` : ''}.`)
    }
  }
  // Parent portal > Settings ,  family contact/emergency details plus per-child
  // welfare info. Routed through the server so family ownership is verified.
  const saveParentSettings = async ({ family, students: studentUpdates }) => {
    const response = await fetch('/api/parent/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ family, students: studentUpdates }) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || 'Settings could not be saved.')
    if (result.family) setFamilies((current) => current.map((item) => item.id === result.family.id ? result.family : item))
    if (result.students?.length) {
      const byId = new Map(result.students.map((row) => [row.id, normalizeStudent(row)]))
      setStudents((current) => current.map((item) => byId.get(item.id) || item))
    }
  }
  // After staff create arrears or a subscription request (or open Subscriptions),
  // reload families and bookings so new invoices and finished sign-ups show.
  const refreshBilling = async () => {
    if (!supabaseReady) return
    const [familyResult, bookingResult] = await Promise.all([supabase.from('parent_families').select('*'), supabase.from('bookings').select('*')])
    if (!familyResult.error) setFamilies(familyResult.data || [])
    if (!bookingResult.error) setBookings((bookingResult.data || []).map(normalizeBooking))
  }
  const runSubscriptionAction = async (family, action) => {
    setSubscriptionBusyId(family.id)
    try {
      const response = await fetch(`/api/admin/subscriptions/${encodeURIComponent(family.id)}/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } })
      const result = await response.json()
      // A partial failure can still carry the saved family (e.g. cancelled, children not).
      if (result.family) setFamilies((current) => current.map((item) => item.id === family.id ? result.family : item))
      if (!response.ok) throw new Error(result.error || 'Subscription action failed.')
      if (action === 'cancel') setStudents((current) => current.map((student) => student.familyId === family.id ? { ...student, membershipStatus: 'cancelled' } : student))
      setToast(`Subscription ${action === 'pause' ? 'paused' : action === 'resume' ? 'resumed' : 'cancelled'}.`)
    } catch (error) {
      setToast(error.message)
    } finally {
      setSubscriptionBusyId('')
    }
  }

  const openResetPreview = async () => {
    setResetBusy(true)
    setResetConfirmText('')
    try {
      const response = await fetch('/api/admin/reset-test-data', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: '{}' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'The preview could not be loaded.')
      setResetPreview(result)
    } catch (error) {
      setToast(error.message)
    } finally {
      setResetBusy(false)
    }
  }
  const runResetTestData = async () => {
    if (resetConfirmText.trim().toUpperCase() !== 'DELETE') return
    setResetBusy(true)
    try {
      const response = await fetch('/api/admin/reset-test-data', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE' }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Reset failed.')
      const total = Object.values(result.deleted || {}).reduce((sum, count) => sum + count, 0)
      setResetPreview(null)
      setToast(`Test data reset. ${total} record${total === 1 ? '' : 's'} removed.`)
      window.setTimeout(() => window.location.reload(), 900)
    } catch (error) {
      setToast(error.message)
      setResetBusy(false)
    }
  }

  const parentFamily = families.find((family) => family.owner_user_id === session?.user.id) || families.find((family) => family.guardian_email === session?.user.email)
  const parentBookings = parentFamily ? bookings.filter((booking) => booking.familyId === parentFamily.id) : bookings
  const parentStudents = parentFamily ? students.filter((student) => student.familyId === parentFamily.id) : students
  const parentRequest = (path, body = {}) => fetch(path, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const cancelParentBooking = async (bookingId) => { const response = await parentRequest('/api/parent/cancel-booking', { bookingId }); const result = await response.json().catch(() => ({})); setToast(response.ok ? 'Booking cancelled.' : result.error || 'Booking could not be cancelled.'); if (response.ok) setBookings(bookings.map((booking) => booking.id === bookingId ? { ...booking, status: 'Cancelled' } : booking)) }
  const openBillingPortal = async () => { const response = await parentRequest('/api/parent/billing-portal'); const result = await response.json(); if (response.ok) window.location.assign(result.url); else setToast(result.error) }
  const cancelParentSubscription = async () => {
    if (!window.confirm("Are you sure you want to cancel your Monthly Membership? Payments stop straight away and your children's places in class end. To come back later you'd need to set up a new membership.")) return
    const response = await parentRequest('/api/parent/cancel-subscription')
    const result = await response.json().catch(() => ({}))
    setToast(response.ok ? 'Subscription cancelled.' : result.error || 'Subscription could not be cancelled.')
    if (response.ok || result.familyCancelled) {
      setFamilies((current) => current.map((family) => family.id === parentFamily?.id ? { ...family, membership_status: 'cancelled' } : family))
      setStudents((current) => current.map((student) => student.familyId === parentFamily?.id ? { ...student, membershipStatus: 'cancelled' } : student))
    }
  }
  const markBookingDone = async (bookingId) => { const completedAt = new Date().toISOString(); const response = await fetch('/api/instructor/mark-done', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId }) }); if (response.ok) setBookings(bookings.map((booking) => booking.id === bookingId ? { ...booking, status: 'Delivered', needsAdminAttention: true, completedAt } : booking)); setToast(response.ok ? 'Session marked as done. Admin review is now pending.' : 'Session could not be marked as done.') }
  const instructorRecord = isInstructor ? instructors.find((instructor) => instructor.id === profile?.instructor_id) : null
  const uploadDbs = async (file) => {
    if (!file || !instructorRecord) return
    setDbsUploading(true)
    const path = `${instructorRecord.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`
    try {
      const { error } = await supabase.storage.from('dbs-certificates').upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type })
      if (error) throw error
      const { data, error: updateError } = await supabase.from('instructors').update({ dbs_status: 'Pending', dbs_file_path: path, dbs_uploaded_at: new Date().toISOString(), dbs_decided_at: null, dbs_rejection_reason: null }).eq('id', instructorRecord.id).select().single()
      if (updateError) throw updateError
      const updated = normalizeInstructor(data)
      setInstructors(instructors.map((instructor) => instructor.id === updated.id ? updated : instructor))
      if (session) void fetch('/api/notify-admin', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'dbs-upload', detail: { instructorName: updated.name, instructorId: updated.id } }) })
      setToast('DBS certificate uploaded for admin review.')
    } catch (error) {
      await supabase.storage.from('dbs-certificates').remove([path])
      setToast(error.message || 'DBS certificate could not be uploaded.')
    } finally {
      setDbsUploading(false)
    }
  }
  const openDbsFile = async (instructorId) => { const response = await fetch(`/api/dbs/file/${encodeURIComponent(instructorId)}`, { headers: { Authorization: `Bearer ${session.access_token}` } }); const result = await response.json(); if (response.ok) window.open(result.url, '_blank', 'noopener,noreferrer'); else setToast(result.error || 'DBS certificate could not be opened.') }
  const reviewDbs = async (instructor, decision, rejectionReason = '') => { const response = await fetch('/api/dbs/review', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ instructorId: instructor.id, decision, rejectionReason }) }); if (response.ok) { const updated = { ...instructor, dbsStatus: decision, dbsDecidedAt: new Date().toISOString(), dbsRejectionReason: decision === 'Rejected' ? rejectionReason : '' }; persistRows('instructors', instructors.map((item) => item.id === instructor.id ? updated : item), setInstructors) } setToast(response.ok ? `DBS ${decision.toLowerCase()}.` : 'DBS decision could not be saved.') }
  const downloadInvoice = async (booking) => { const params = invoicePdfParams(booking); const response = await fetch(`/api/invoices/pdf/${encodeURIComponent(booking.id)}?${params}`, { headers: { Authorization: `Bearer ${session.access_token}` } }); if (!response.ok) { setToast('Invoice PDF could not be generated.'); return } const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${booking.invoiceNumber || booking.id}.pdf`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
  const sendMessage = async (draft) => {
    const row = { id: crypto.randomUUID(), sender_kind: draft.senderKind, sender_instructor_id: draft.senderInstructorId || null, sender_school_id: draft.senderSchoolId || null, recipient_kind: draft.recipientKind, recipient_instructor_id: draft.recipientInstructorId || null, recipient_school_id: draft.recipientSchoolId || null, body: draft.body }
    const { data, error } = await supabase.from('messages').insert(row).select().single()
    if (error) { setToast(error.message || 'Message could not be sent.'); return }
    setMessages([...messages, normalizeMessage(data)])
  }
  // Manual payment reminder (friendly wording) ,  same email the arrears page sends.
  const remindInvoice = async (booking) => {
    if (!window.confirm(`Email a payment reminder for ${booking.invoiceNumber || 'this invoice'}?`)) return
    const response = await fetch(`/api/invoices/${encodeURIComponent(booking.id)}/remind`, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ template: 'friendly' }) })
    const result = await response.json().catch(() => ({}))
    setToast(response.ok ? `Reminder sent to ${result.recipient}.` : result.error || 'Reminder could not be sent.')
  }
  // Saves the invoice's figures (incl. a one-off discount) without sending it.
  const saveInvoiceEdits = async (booking) => {
    try {
      const result = await authedPost(`/api/invoices/${encodeURIComponent(booking.id)}/overrides`, { overrides: invoiceEditPayload(booking) })
      setBookings((current) => current.map((item) => item.id === booking.id ? { ...item, invoiceOverrides: result.overrides } : item))
      setInvoiceBooking((current) => current && current.id === booking.id ? { ...current, invoiceOverrides: result.overrides } : current)
      setToast(`Invoice saved. Total due £${(result.amountPence / 100).toFixed(2)}.`)
    } catch (error) {
      setToast(error.message)
    }
  }
  // A family record for a parent who hasn't signed up yet (offline family).
  const createFamily = async ({ name, email }) => {
    const existing = families.find((family) => (family.guardian_email || '').toLowerCase() === email)
    if (existing) return existing.id
    const { data, error } = await supabase.from('parent_families').insert({ id: crypto.randomUUID(), guardian_name: name, guardian_email: email, membership_status: 'pending' }).select('*').single()
    if (error) { setToast(`Family could not be created: ${error.message}`); return '' }
    setFamilies((current) => [data, ...current])
    return data.id
  }
  const addParentChildren = async (children) => {
    const result = await authedPost('/api/parent/children', { children })
    setStudents((current) => [...current, ...(result.students || []).map(normalizeStudent)])
    return result.students || []
  }
  const saveInvoiceSettings = async (settings) => {
    setInvoiceSettingsSaving(true)
    const { error } = await supabase.from('invoice_settings').upsert({ id: 'default', account_name: settings.accountName, sort_code: settings.sortCode, account_number: settings.accountNumber, updated_at: new Date().toISOString(), updated_by: session.user.id }, { onConflict: 'id' })
    setInvoiceSettingsSaving(false)
    setToast(error ? `Invoice settings could not be saved: ${error.message}` : 'Invoice settings saved.')
    if (!error) setInvoiceSettings(settings)
  }
  const markMessageRead = async (message) => {
    const readAt = new Date().toISOString()
    const { error } = await supabase.from('messages').update({ read_at: readAt }).eq('id', message.id).is('read_at', null)
    if (!error) setMessages((current) => current.map((item) => item.id === message.id ? { ...item, readAt } : item))
  }
  const myKind = isAdmin || can('messages') ? 'admin' : isInstructor ? 'instructor' : 'school'
  const myInstructorId = isInstructor ? profile?.instructor_id : ''
  const mySchoolId = profile?.role === 'school' ? profile?.school_id : ''
  const unreadMessages = messages.filter((message) => !message.readAt && (can('messages') ? message.recipientKind === 'admin' : isInstructor ? message.recipientKind === 'instructor' && message.recipientInstructorId === myInstructorId : message.recipientKind === 'school' && message.recipientSchoolId === mySchoolId)).length
  const canIssueInvoices = isAdmin || can('sales') || Boolean(profile?.can_send_invoices)
  // Job board: admins and 'jobs' staff manage it; instructors claim from it.
  const canManageJobs = can('jobs')
  const canSeeJobs = canManageJobs || isInstructor
  // Workshop template: admins and 'template' staff edit it; instructors read it.
  const canEditTemplate = can('template')
  const canSeeTemplate = canEditTemplate || isInstructor
  const canManageMessages = can('messages')
  useEffect(() => {
    if (!invoiceBooking || !session || !canIssueInvoices) {
      return undefined
    }
    let active = true
    let objectUrl = ''
    const params = invoicePdfParams(invoiceBooking)
    fetch(`/api/invoices/pdf/${encodeURIComponent(invoiceBooking.id)}?${params}`, { headers: { Authorization: `Bearer ${session.access_token}` } }).then(async (response) => {
      if (!response.ok) throw new Error('Invoice PDF could not be generated.')
      // The server numbers the invoice on first preview; keep local state in step so the
      // next bookings save doesn't write the old blank number back over it.
      const invoiceNumber = response.headers.get('X-Invoice-Number')
      if (active && invoiceNumber && invoiceNumber !== invoiceBooking.invoiceNumber) {
        setBookings((current) => current.map((item) => item.id === invoiceBooking.id ? { ...item, invoiceNumber } : item))
        setInvoiceBooking((current) => current && current.id === invoiceBooking.id ? { ...current, invoiceNumber } : current)
      }
      const blob = await response.blob()
      objectUrl = URL.createObjectURL(blob)
      if (active) setInvoicePdfUrl(objectUrl)
    }).catch((error) => { if (active) setToast(error.message) })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [invoiceBooking, session, canIssueInvoices])
  const visibleBookings = bookings.filter((booking) => `${booking.date} ${booking.sessionType} ${booking.status} ${booking.contactName}`.toLowerCase().includes(bookingSearch.toLowerCase()))
  const visibleSchools = schools.filter((school) => `${school.name} ${school.contactName} ${school.email}`.toLowerCase().includes(schoolSearch.toLowerCase()))
  const completedByInstructor = (id) => bookings.filter((booking) => booking.instructorId === id && booking.status === 'Delivered').length
  const visibleInstructors = instructors.filter((instructor) => `${instructor.name} ${instructor.email} ${instructor.locationAreas} ${instructor.gender}`.toLowerCase().includes(instructorSearch.toLowerCase())).sort((first, second) => instructorSort === 'completed' ? completedByInstructor(second.id) - completedByInstructor(first.id) : instructorSort === 'location' ? first.locationAreas.localeCompare(second.locationAreas) : instructorSort === 'gender' ? first.gender.localeCompare(second.gender) : first.name.localeCompare(second.name))
  const assignedInstructorLabel = (booking) => isAdmin || isInstructor ? instructors.find((instructor) => instructor.id === booking.instructorId)?.name : publicInstructors.find((instructor) => instructor.id === booking.instructorId)?.firstName

  const opsSidebarItems = [
    { key: 'dashboard', label: 'Dashboard' },
    {
      label: 'Operations',
      children: [
        { key: 'calendar', label: 'Calendar' },
        { key: 'bookings', label: 'Bookings' },
        ...(can('contacts') ? [{ key: 'contacts', label: 'Contacts' }] : []),
        ...(isAdmin || can('schools') ? [{ key: 'schools', label: 'Schools' }] : []),
        ...(isAdmin ? [{ key: 'instructors', label: 'Instructors' }] : []),
        ...(isAdmin || can('students') ? [{ key: 'students', label: 'Students' }, { key: 'class-schedule', label: 'Class schedule' }] : []),
        ...(can('attendance') ? [{ key: 'attendance', label: 'Attendance' }] : []),
        ...(can('homework') ? [{ key: 'homework', label: 'Homework' }] : []),
        ...(can('formations') ? [{ key: 'formations', label: 'Formations' }] : []),
        ...(can('sessions') ? [{ key: 'session-types', label: 'Session types' }] : []),
        ...(canSeeJobs ? [{ key: 'jobs', label: 'Job board' }] : []),
        ...(canSeeTemplate ? [{ key: 'template', label: 'Workshop template' }] : []),
      ],
    },
    ...(can('events') ? [{
      label: 'Events',
      children: [
        { key: 'events-published', label: 'Published' },
        { key: 'events-drafts', label: 'Drafts' },
        { key: 'events-archived', label: 'Archived' },
        { key: 'events-add', label: '+ Add event', action: true },
      ],
    }] : []),
    ...(can('social') ? [{
      label: 'Social Studio',
      children: [
        { key: 'social-posts', label: 'Posts' },
        { key: 'social-calendar', label: 'Calendar' },
        { key: 'social-library', label: 'Media library' },
        { key: 'social-settings', label: 'Drafting rules' },
      ],
    }] : []),
    ...(can('site') ? [{
      label: 'Site',
      children: [
        { key: 'site-layout', label: 'Homepage layout' },
        { key: 'site-content', label: 'Site content' },
      ],
    }] : []),
    ...(can('sales') ? [{
      label: 'Sales',
      children: [
        { key: 'subscriptions', label: 'Subscriptions' },
        { key: 'payment-links', label: 'Payment links' },
        { key: 'arrears', label: 'Arrears' },
        { key: 'invoice-settings', label: 'Invoice settings' },
      ],
    }] : []),
    ...(isAdmin ? [{
      label: 'Administration',
      children: [
        { key: 'team', label: 'Team & access' },
        { key: 'campaigns', label: 'Email campaigns' },
        { key: 'settings', label: 'Settings' },
      ],
    }] : []),
    { key: 'messages', label: `Messages${unreadMessages ? ` (${unreadMessages})` : ''}` },
  ]
  const handleOpsSelect = (key) => {
    if (key === 'events-add') {
      setEventModal(emptyEvent())
      return
    }
    setTab(key)
    // Persist the open tab in the hash so refresh/back keeps you on it.
    window.history.replaceState(null, '', `#ops/${key}`)
  }
  const opsHeading = isAdmin ? 'Operations dashboard' : isStaff ? 'Team dashboard' : isInstructor ? 'Instructor dashboard' : 'School dashboard'

  const routeFallback = <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: sans, background: cream, color: muted }}>Loading…</div>

  if (!authReady) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'sans-serif' }}>Loading...</div>
  if (eventPageId) return <Suspense fallback={routeFallback}><EventTicketPage eventId={eventPageId} onBack={() => { window.history.pushState(null, '', '/'); setEventPageId(null) }} /></Suspense>
  if (legalPageId) return <Suspense fallback={routeFallback}><LegalPage page={legalPageId} onBack={() => { window.history.pushState(null, '', '/'); setLegalPageId(null) }} /></Suspense>
  if (payLinkSlug) return <Suspense fallback={routeFallback}><PaymentLinkPage slug={payLinkSlug} onBack={() => { window.history.pushState(null, '', '/'); setPayLinkSlug(null) }} /></Suspense>
  if (view === 'auth') return <AuthScreen initialMessage={authLinkError} onAuthenticated={() => { setAuthLinkError(''); setView('ops') }} />
  if (view === 'ops' && session && needsPasswordSetup) return <AuthScreen requirePasswordSetup onAuthenticated={() => { window.sessionStorage.removeItem('kada-password-setup-user'); setNeedsPasswordSetup(false); setView('ops') }} />
  if (view === 'ops' && profile?.role === 'parent') return <Suspense fallback={routeFallback}><ParentDashboard initialTab={tab} session={session} family={parentFamily} bookings={parentBookings} students={parentStudents} invoices={parentInvoices} onAddChildren={addParentChildren} classSessions={classSessions} onBookClass={startParentCheckout} checkoutBusy={checkoutBusy} onCancelBooking={cancelParentBooking} onBillingPortal={openBillingPortal} onCancelSubscription={cancelParentSubscription} onSaveSettings={saveParentSettings} onBack={() => setView('site')} onSignOut={() => supabase.auth.signOut()} />{toast && <div className="toast" role="status">{toast}</div>}</Suspense>

  return (
    <div className="app-shell">
      <header ref={headerRef} className="site-header">
        <div className="wrap nav-wrap">
          <div className="brand" aria-label="King's Ark Dance Academy home">
                <img className="brand-logo" src={siteContent.branding?.logoUrl || '/images/logo-mark.png'} alt="King's Ark Dance Academy logo" />
            <div className="brand-text">
              <span className="name">King's Ark</span>
              <span className="sub">Dance Academy</span>
            </div>
          </div>

          <button type="button" className="mobile-menu-toggle" aria-label={publicMenuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={publicMenuOpen} onClick={() => setPublicMenuOpen(!publicMenuOpen)}><span></span><span></span><span></span></button>
          <nav className={`nav-links ${publicMenuOpen ? 'open' : ''}`} aria-label="Main navigation">
            <a href="#about" onClick={(event) => navigatePublicSection(event, '#about')}>About</a>
            <a href="#workshops" onClick={(event) => navigatePublicSection(event, '#workshops')}>School Workshops</a>
            <a href="#classes" onClick={(event) => navigatePublicSection(event, '#classes')}>Classes</a>
            {siteEvents.length > 0 && <a href="#events" onClick={(event) => navigatePublicSection(event, '#events')}>Events</a>}
            <a href="#videos" onClick={(event) => navigatePublicSection(event, '#videos')}>Stories</a>
            <a href="#contact" onClick={(event) => navigatePublicSection(event, '#contact')}>Contact</a>
            <button type="button" className="nav-cta" onClick={() => { setPublicMenuOpen(false); setView(session ? 'ops' : 'auth') }}>{session ? 'Operations' : 'Sign in'}</button>
          </nav>
        </div>
      </header>

      {view === 'site' ? (
        <HomePage
          SectionError={SectionError}
          siteEvents={siteEvents}
          siteBlocks={siteBlocks}
          siteContent={siteContent}
          sectionLayout={sectionLayout}
          navigatePublicSection={navigatePublicSection}
          openPublicForm={openPublicForm}
          publicForm={publicForm}
          setPublicForm={setPublicForm}
          startClassCheckout={startClassCheckout}
          parentBooking={parentBooking}
          setParentBooking={setParentBooking}
          checkoutBusy={checkoutBusy}
          classSessions={classSessions.filter((session) => session.active)}
          handleQuoteSubmit={handleQuoteSubmit}
          schoolRequest={schoolRequest}
          handleQuoteChange={handleQuoteChange}
          sessionTypeOptions={sessionTypeNames(sessionTypes).filter((name) => name !== 'Custom').concat('Custom')}
          quote={quote}
          quotePrice={formatCurrency(quotePrice)}
          quoteStaff={quoteStaff}
          schoolQuotePence={Math.round(buildPrice(schoolRequest, sessionTypes).price * 100)}
          valueItems={valueItems}
          Modal={Modal}
        />
      ) : (
        <main className="ops-shell wrap ops-layout" style={{ display: 'flex', gap: 24, alignItems: 'flex-start', minHeight: 'calc(100vh - 120px)', paddingTop: 18 }}>
          <OpsSidebar caption="Workspace" items={opsSidebarItems} active={tab} onSelect={handleOpsSelect} openGroups={opsOpenGroups} onToggleGroup={toggleOpsGroup} />
          <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ops-header">
            <div>
              <p className="eyebrow dark">Operations</p>
              <h2 className="display">{opsHeading}</h2>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ color: '#767066', fontSize: 12 }}>{profile?.full_name || session?.user.email} · {profile?.role || 'account'}</span>
              <button type="button" className="btn btn-dark-outline small" onClick={() => setView('site')}>Back to site</button>
              <button type="button" className="btn btn-dark-outline small" onClick={() => supabase.auth.signOut()}>Sign out</button>
            </div>
          </div>

          {tab === 'dashboard' && (
            <>
              {isInstructor && <DbsUpload instructor={instructorRecord} onUpload={uploadDbs} uploading={dbsUploading} />}
              <NeedsAttention jobs={jobs} bookings={bookings} instructors={instructors} schools={schools} messages={messages} signups={isAdmin ? signups : []} isAdmin={isAdmin} canManageMessages={canManageMessages} dismissed={dismissedNotifications} onDismiss={(id) => setDismissedNotifications((current) => [...current, id])} onOpenJobs={() => handleOpsSelect('jobs')} onOpenBookings={() => handleOpsSelect('bookings')} onOpenInstructors={() => handleOpsSelect('instructors')} onOpenMessages={() => handleOpsSelect('messages')} onOpenStudents={() => handleOpsSelect('students')} />
              {(isAdmin || can('sales')) && session && <PaymentsPanel session={session} onChanged={() => loadTable('bookings', []).then(setBookings)} />}
              <BirthdayNotice students={students} />
              {isAdmin && session && <SiteAnalytics session={session} />}
              {isAdmin && (
                <div className="panel" style={{ borderColor: '#e0b4a6' }}>
                  <div className="panel-head"><h3>Test data</h3></div>
                  <p style={{ color: muted, fontSize: 13, lineHeight: 1.55, margin: '0 0 12px' }}>Clear test bookings, students, family accounts, and ticket orders so dashboard counts return to zero. You review the exact records before anything is deleted. Stripe refunds are handled separately in the Stripe dashboard.</p>
                  <Button small variant="danger" disabled={resetBusy} onClick={openResetPreview}>{resetBusy && !resetPreview ? 'Loading preview…' : 'Review & reset test data…'}</Button>
                </div>
              )}
            </>
          )}

          {tab === 'dashboard' && (
          <div className="ops-grid">
            <div className="panel stat-panel">
              <div className="panel-label">Upcoming bookings</div>
              <strong>{stats.upcomingCount}</strong>
            </div>
            {isAdmin && (
              <div className="panel stat-panel">
                <div className="panel-label">Total revenue</div>
                <strong>{formatCurrency(stats.confirmedRevenue)}</strong>
                <div style={{ color: muted, fontSize: 12, marginTop: 4 }}>Classes {formatCurrency(stats.classRevenue)} · Events {formatCurrency(stats.eventRevenue)}</div>
              </div>
            )}
            <div className="panel stat-panel">
              <div className="panel-label">Unpaid / pending</div>
              <strong>{stats.unpaidInvoices}</strong>
            </div>
          </div>
          )}

          {tab === 'students' && (isAdmin || can('students')) && <StudentPlansView students={students} canSeeAttendance={can('attendance')} session={session} onStudentChanged={({ id, className, term }) => setStudents((current) => current.map((student) => student.id === id ? { ...student, className, term } : student))} />}
          {tab === 'invoice-settings' && (isAdmin || can('sales')) && <InvoiceSettings settings={invoiceSettings} onSave={saveInvoiceSettings} saving={invoiceSettingsSaving} />}
          {tab === 'contacts' && can('contacts') && <ContactsPage />}
          {tab === 'team' && isAdmin && session && <TeamPage session={session} />}
          {tab === 'campaigns' && isAdmin && session && <CampaignsPage session={session} events={events} seedEventId={promoteEventId} onSeedUsed={() => setPromoteEventId('')} />}
          {tab === 'settings' && isAdmin && <SettingsPage content={siteContent} onSaveContent={saveSiteContent} session={session} />}
          {tab === 'jobs' && canSeeJobs && <JobBoardView jobs={isInstructor ? jobs.filter((job) => job.status === 'open' || job.claimedBy === profile.instructor_id) : jobs} bookings={bookings} schools={schools} instructors={instructors} canManage={canManageJobs} onClaim={claimJob} onDecision={decideJob} onPublish={publishJob} onGoToBookings={() => handleOpsSelect('bookings')} />}

          {tab === 'calendar' && (isAdmin || isInstructor || can('bookings') || can('sessions') || can('jobs')) && <CalendarPage bookings={isInstructor ? bookings.filter((booking) => booking.instructorId === profile?.instructor_id) : bookings} events={events} sessions={sessionEntries} instructors={instructors} onOpenBooking={(booking) => setBookingModal(booking)} onAddEvent={(date) => setEventModal({ ...emptyEvent(), eventDate: date })} />}
          {tab === 'bookings' && <div className="panel">
            <div className="panel-head">
              <h3>Bookings</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className={`pill ${conflicts.size ? 'warn' : 'ok'}`}>{conflicts.size ? `${conflicts.size} conflict(s)` : 'Clear schedule'}</span>
                {isAdmin && <Button small onClick={() => setBookingModal(emptyBooking())}>+ New booking</Button>}
              </div>
            </div>
            <input style={{ ...inputStyle, marginBottom: 12 }} placeholder="Search bookings" value={bookingSearch} onChange={(event) => setBookingSearch(event.target.value)} />
            <BookingsTable
              bookings={visibleBookings}
              schools={schools}
              instructors={instructors}
              jobs={jobs}
              conflicts={conflicts}
              instructorLabel={assignedInstructorLabel}
              isAdmin={isAdmin}
              isInstructor={isInstructor}
              canIssueInvoices={canIssueInvoices}
              expanded={showAllBookings}
              onToggleExpand={() => setShowAllBookings(!showAllBookings)}
              onSaveBooking={saveBooking}
              onOpenSchool={(booking) => setSchoolRecord(schools.find((school) => school.id === booking.schoolId) || null)}
              onEditBooking={(booking) => setBookingModal(booking || emptyBooking())}
              canManageJobs={canManageJobs}
              sessionTypeOptions={sessionTypeNames(sessionTypes)}
              onPublishJob={(booking) => publishJob({ bookingId: booking.id, pay: booking.instructorPay, location: '' })}
              onMarkDone={markBookingDone}
              onInvoice={(booking) => setInvoiceBooking(withSavedInvoiceEdits(booking))}
            />
          </div>}

          {(isAdmin || can('schools')) && tab === 'schools' && <div className="panel"><div className="panel-head"><h3>Schools</h3><Button small onClick={() => setSchoolModal(emptySchool())}>Add school</Button></div><input style={{ ...inputStyle, marginBottom: 12 }} placeholder="Search schools" value={schoolSearch} onChange={(event) => setSchoolSearch(event.target.value)} /><SchoolsTable schools={visibleSchools} bookings={bookings} expanded={showAllSchools} onToggleExpand={() => setShowAllSchools(!showAllSchools)} onSaveSchool={saveSchool} onView={setSchoolRecord} onMessage={(school) => setMessageTarget({ kind: 'school', id: school.id, name: school.name })} /></div>}
          {isAdmin && tab === 'instructors' && <div className="panel"><div className="panel-head"><h3>Instructors and assignments</h3><Button small onClick={() => setInstructorModal({ id: crypto.randomUUID(), name: '', email: '', phone: '', rate: 100, locationAreas: '', gender: '', dbsStatus: 'Missing' })}>Add instructor</Button></div><div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 8, marginBottom: 12 }}><input style={inputStyle} placeholder="Search by name, location, gender" value={instructorSearch} onChange={(event) => setInstructorSearch(event.target.value)} /><select style={inputStyle} value={instructorSort} onChange={(event) => setInstructorSort(event.target.value)}><option value="name">Sort by name</option><option value="location">Sort by location</option><option value="gender">Sort by gender</option><option value="completed">Sort by completed</option></select></div><InstructorsTable instructors={visibleInstructors} expanded={showAllInstructors} onToggleExpand={() => setShowAllInstructors(!showAllInstructors)} completedBy={completedByInstructor} onSaveInstructor={saveInstructor} onMessage={(instructor) => setMessageTarget({ kind: 'instructor', id: instructor.id, name: instructor.name })} onEdit={setInstructorModal} onOpenDbs={openDbsFile} onReviewDbs={reviewDbs} /></div>}
          {can('events') && (tab === 'events-published' || tab === 'events-drafts' || tab === 'events-archived') && <EventsPage view={tab === 'events-published' ? 'published' : tab === 'events-archived' ? 'archived' : 'drafts'} events={events} onSaveEvent={saveEvent} onEditEvent={setEventModal} onDeleteEvent={deleteEvent} onAddEvent={() => setEventModal(emptyEvent())} onPromoteEvent={isAdmin ? (event) => { setPromoteEventId(event.id); handleOpsSelect('campaigns') } : undefined} session={session} />}
          {can('site') && tab === 'site-layout' && <SiteLayoutPage sections={sectionLayout.length ? sectionLayout : DEFAULT_SECTION_ORDER} onSave={saveSectionLayout} blocks={siteBlocks} events={events} onSaveBlock={saveSiteBlock} onDeleteBlock={deleteSiteBlock} />}
          {can('site') && tab === 'site-content' && <SiteContentPage content={siteContent} onSave={saveSiteContent} />}
          {can('sales') && tab === 'payment-links' && <Suspense fallback={<p style={{ color: muted }}>Loading…</p>}><PaymentLinksPage focusLinkId={paymentLinkFocus} onFocusHandled={() => setPaymentLinkFocus('')} /></Suspense>}
          {can('social') && tab.startsWith('social-') && session && <Suspense fallback={<p style={{ color: muted }}>Loading…</p>}><SocialStudioPage session={session} view={tab.replace('social-', '')} /></Suspense>}
          {can('attendance') && tab === 'attendance' && session && <Suspense fallback={<p style={{ color: muted }}>Loading…</p>}><AttendancePage session={session} isAdmin={isAdmin} /></Suspense>}
          {can('homework') && tab === 'homework' && session && <Suspense fallback={<p style={{ color: muted }}>Loading…</p>}><HomeworkPage session={session} /></Suspense>}
          {can('sessions') && tab === 'session-types' && session && <Suspense fallback={<p style={{ color: muted }}>Loading…</p>}><SessionTypesPage session={session} onChanged={() => setSessionsVersion((version) => version + 1)} /></Suspense>}
          {can('formations') && tab === 'formations' && session && <Suspense fallback={<p style={{ color: muted }}>Loading…</p>}><FormationsPage session={session} /></Suspense>}
          {can('sales') && tab === 'arrears' && session && <Suspense fallback={<p style={{ color: muted }}>Loading…</p>}><ArrearsPage session={session} families={families} onBillingChanged={refreshBilling} /></Suspense>}
          {(isAdmin || can('sales')) && tab === 'subscriptions' && session && <SubscriptionsPage session={session} onRefresh={refreshBilling} families={families} busyId={subscriptionBusyId} onAction={runSubscriptionAction} onSaveFamily={saveFamily} />}
          {(isAdmin || can('students')) && tab === 'class-schedule' && <ClassSchedulePage sessions={classSessions} onSave={saveClassSession} onAdd={addClassSession} onDelete={deleteClassSession} />}
          {tab === 'template' && canSeeTemplate && <TemplateView template={template} onSave={saveTemplate} readOnly={!canEditTemplate} />}
          {tab === 'messages' && profile && <MessagesView messages={messages} myKind={myKind} myInstructorId={myInstructorId} mySchoolId={mySchoolId} schools={schools} instructors={instructors} canManage={canManageMessages} onSend={sendMessage} onMarkRead={markMessageRead} />}

          {schoolRecord && <SchoolRecord school={schoolRecord} bookings={bookings} instructorLabel={assignedInstructorLabel} onEdit={setSchoolModal} onBooking={setBookingModal} onMessage={(school) => setMessageTarget({ kind: 'school', id: school.id, name: school.name })} onClose={() => setSchoolRecord(null)} />}
          {bookingModal && <Modal title="Booking" onClose={() => setBookingModal(null)} wide><BookingForm booking={bookingModal} schools={schools} instructors={instructors} families={families} sessionTypes={sessionTypes} onCreateFamily={createFamily} onSave={saveBooking} onDelete={() => deleteBooking(bookingModal)} /></Modal>}
          {schoolModal && <Modal title="School" onClose={() => setSchoolModal(null)}><SchoolForm school={schoolModal} onSave={saveSchool} /></Modal>}
          {instructorModal && <Modal title="Instructor" onClose={() => setInstructorModal(null)}><InstructorForm instructor={instructorModal} onSave={saveInstructor} /></Modal>}
          {eventModal && <Modal title={eventModal.title ? 'Edit event' : 'New event'} onClose={() => setEventModal(null)}><EventForm event={eventModal} onSave={saveEvent} onUploadFlyer={uploadEventFlyer} /></Modal>}
          {invoiceBooking && <InvoicePreview booking={invoiceBooking} onUpdate={(changes) => setInvoiceBooking((current) => ({ ...current, ...changes }))} onSave={(booking) => { saveBooking(booking); setInvoiceBooking(null) }} onSaveEdits={saveInvoiceEdits} onSend={sendInvoice} onDownload={downloadInvoice} onRemind={remindInvoice} sending={invoiceSending} pdfUrl={invoicePdfUrl} onClose={() => { setInvoiceBooking(null); setInvoicePdfUrl('') }} />}
          {resetPreview && <Modal title="Reset test data: review before deleting" onClose={() => setResetPreview(null)} wide><ResetPreview preview={resetPreview.preview} counts={resetPreview.counts} confirmText={resetConfirmText} onConfirmTextChange={setResetConfirmText} onConfirm={runResetTestData} busy={resetBusy} /></Modal>}
          {messageTarget && <Modal title={`Message ${messageTarget.name}`} onClose={() => { setMessageTarget(null); setMessageDraft('') }}><Field label="Message"><textarea style={{ ...inputStyle, minHeight: 90 }} value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} /></Field><Button disabled={!messageDraft.trim()} onClick={() => { sendMessage({ senderKind: 'admin', recipientKind: messageTarget.kind, recipientInstructorId: messageTarget.kind === 'instructor' ? messageTarget.id : null, recipientSchoolId: messageTarget.kind === 'school' ? messageTarget.id : null, body: messageDraft.trim() }); setMessageTarget(null); setMessageDraft(''); setTab('messages') }}>Send message</Button></Modal>}
          </div>
        </main>
      )}

      {classBookingSuccess && (
        <Modal title={classBookingSuccess === 'loading' ? 'Confirming your booking…' : classBookingSuccess === 'pending' ? 'Almost there…' : 'Booking confirmed'} onClose={() => setClassBookingSuccess(null)}>
          {classBookingSuccess === 'loading' && <p style={{ margin: 0, fontFamily: sans, fontSize: 14, color: muted, lineHeight: 1.6 }}>Confirming your payment with Stripe. This takes a moment…</p>}
          {classBookingSuccess === 'pending' && <p style={{ margin: 0, fontFamily: sans, fontSize: 14, color: ink, lineHeight: 1.6 }}>Your payment was received and your booking is being processed. A confirmation email will arrive shortly. Contact bookings@kingsarkdance.com if it doesn't.</p>}
          {classBookingSuccess && classBookingSuccess !== 'loading' && classBookingSuccess !== 'pending' && (
            <div style={{ fontFamily: sans, color: ink, lineHeight: 1.6 }}>
              <p style={{ fontSize: 16, margin: '0 0 10px' }}><strong>You're booked in! 🎉</strong></p>
              <p style={{ margin: '0 0 12px', fontSize: 14 }}>
                <strong>Class:</strong> {classBookingSuccess.className}<br />
                <strong>Date:</strong> {classBookingSuccess.classDate ? new Date(`${classBookingSuccess.classDate}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'To be confirmed'}{classBookingSuccess.startTime ? ` · ${classBookingSuccess.startTime}${classBookingSuccess.endTime ? ` to ${classBookingSuccess.endTime}` : ''}` : ''}<br />
                <strong>Children:</strong> {classBookingSuccess.students.length ? classBookingSuccess.students.join(', ') : 'Not listed'}<br />
                <strong>Plan:</strong> {classBookingSuccess.planType === 'monthly_membership' ? (classBookingSuccess.pricePence === 0 ? 'Monthly Membership' : 'Monthly Membership (per child, monthly)') : 'Day Pass (per child)'}<br />
                <strong>Total paid:</strong> £{(classBookingSuccess.pricePence / 100).toFixed(2)}
              </p>
              <p style={{ margin: '0 0 16px', fontSize: 13.5, color: muted }}>A confirmation email with a calendar file is on its way to <strong>{classBookingSuccess.parentEmail}</strong>.</p>
              <Button onClick={() => setClassBookingSuccess(null)}>Done</Button>
            </div>
          )}
        </Modal>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

export default App
