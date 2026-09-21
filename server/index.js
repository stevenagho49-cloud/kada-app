import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import Stripe from 'stripe'
import { rateLimit } from 'express-rate-limit'
import { createClient } from '@supabase/supabase-js'
import PDFDocument from 'pdfkit'
import fs from 'node:fs'
import path from 'node:path'

const app = express()
// Render (and most hosts) sit behind a single proxy — trust one hop so req.ip
// is the real client IP, which the rate limiters below depend on.
app.set('trust proxy', 1)
const port = Number(process.env.PORT || 4242)
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null

// CORS: in production the same server serves the frontend, so same-origin requests need
// no cross-origin allowance. In dev, Vite (5173) proxies /api so cross-origin rarely fires.
// CLIENT_URLS (comma-separated) can whitelist extra origins if the frontend is hosted separately.
const allowedOrigins = (process.env.CLIENT_URLS || process.env.CLIENT_URL || 'http://localhost:5173').split(',').map((origin) => origin.trim()).filter(Boolean)
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true) // same-origin / server-to-server / whitelisted
    return callback(null, false) // no CORS headers for other origins — cross-origin browser reads are blocked
  },
  credentials: true,
}))

// Security headers — small, standard hardening. Render terminates TLS in front
// of us; HSTS tells browsers to keep using it. frame-ancestors blocks clickjacking.
app.use((_request, response, next) => {
  response.set({
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  })
  next()
})

/* ------------------------------------------------------------------ */
/* Email via Resend — ticket confirmations, reminders, and admin       */
/* notifications. No-ops (returns {sent:false}) when not configured.   */
/* ------------------------------------------------------------------ */
const EMAIL_FROM = process.env.INVOICE_FROM_EMAIL || "King's Ark Dance Academy <onboarding@resend.dev>"
const ADMIN_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL || ''
// APP_URL is the customer-facing domain used inside emails and calendar files.
// CLIENT_URL (default localhost:5173) is the dev server for Stripe redirects during development.
const APP_URL = (process.env.APP_URL || 'https://kingsarkdance.com').replace(/\/$/, '')
const PUBLIC_BASE_URL = APP_URL

async function sendEmail({ to, subject, html, attachments = [] }) {
  if (!process.env.RESEND_API_KEY || !to) return { sent: false, reason: 'email not configured' }
  try {
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        ...(attachments.length ? { attachments } : {}),
      }),
    })
    const result = await resendResponse.json()
    if (!resendResponse.ok) {
      console.error('Resend send failed:', result)
      return { sent: false, reason: result.message || 'resend error' }
    }
    return { sent: true, id: result.id }
  } catch (error) {
    console.error('Resend send error:', error)
    return { sent: false, reason: error.message }
  }
}

function money(pence) {
  return `£${(Number(pence || 0) / 100).toFixed(2)}`
}
/* Parse an email From value — handles 'Name <a@b.com>' and bare addresses. */
function parseSender(raw) {
  const angle = String(raw || '').match(/^(.*?)\s*<([^>]+)>/)
  const bare = String(raw || '').match(/[\w.+-]+@[\w-]+\.[\w.]+/)
  const email = (angle ? angle[2] : bare?.[0] || '').toLowerCase().trim()
  const name = angle ? angle[1].replace(/^["']|["']$/g, '').trim() : ''
  return { email, name }
}
function formatDateGB(value) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : ''
}
function toIcsDate(date, time) {
  const [h = '0', m = '0'] = (time || '00:00').split(':')
  const d = new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`)
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}
function buildIcs({ title, date, startTime, endTime, location, description, url }) {
  const dtStart = toIcsDate(date, startTime)
  const dtEnd = endTime ? toIcsDate(date, endTime) : toIcsDate(date, startTime)
  const stamp = toIcsDate(new Date().toISOString().slice(0, 10), new Date().toISOString().slice(11, 16))
  const esc = (text) => String(text || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//KADA//Events//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@kingsarkdance.com`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${esc(title)}`,
    location ? `LOCATION:${esc(location)}` : '',
    description ? `DESCRIPTION:${esc(description)}` : '',
    url ? `URL:${url}` : '',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n')
}

/* Notification routing is editable from Operations > Administration >       */
/* Settings (app_settings 'notifications') — the server re-reads it at most   */
/* once a minute. Settings can retarget the alert inbox and switch off        */
/* individual alert types; environment variables remain the fallback.         */
let notificationSettingsCache = { at: 0, value: null }
async function notificationSettings() {
  if (!supabase) return null
  if (notificationSettingsCache.value && Date.now() - notificationSettingsCache.at < 60000) return notificationSettingsCache.value
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'notifications').maybeSingle()
  if (data?.value) notificationSettingsCache = { at: Date.now(), value: data.value }
  return notificationSettingsCache.value
}

async function notifyAdmin(subject, html, type = '') {
  const settings = await notificationSettings()
  const toggleKey = { 'new-booking': 'newBooking', contact: 'newContact', jobs: 'jobAlerts' }[type]
  if (settings && toggleKey && settings[toggleKey] === false) return { sent: false, reason: `${toggleKey} alerts disabled in Settings` }
  const to = settings?.notifyEmail || ADMIN_EMAIL
  if (!to) return { sent: false, reason: 'ADMIN_NOTIFICATION_EMAIL not set' }
  return sendEmail({ to, subject: `[KADA] ${subject}`, html })
}

// A prominent button linking into the relevant Operations dashboard tab (deep link
// via #ops/<tab>, which signs the admin in and lands on that page). Pass recordId to
// open that exact record's modal: #ops/<tab>/<recordId>.
function dashboardButton(tab, label, recordId) {
  const href = `${APP_URL}#ops/${tab}${recordId ? `/${recordId}` : ''}`
  return `<p style="margin:18px 0 4px"><a href="${href}" style="background:#0b3d2e;color:#fffdf8;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">${label || 'Open in dashboard'} →</a></p>`
}

async function authenticatedUser(request) {
  if (!supabase) return null
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data } = await supabase.auth.getUser(token)
  return data.user || null
}

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (request, response) => {
  if (!stripe || !supabase || !process.env.STRIPE_WEBHOOK_SECRET) return response.sendStatus(503)

  let event
  try {
    event = stripe.webhooks.constructEvent(request.body, request.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)
  } catch (error) {
    return response.status(400).send(`Webhook Error: ${error.message}`)
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const metadata = session.metadata || {}

    // Ticketed event purchases take a separate path from class bookings.
    // The Day Pass/Membership booking logic below is unchanged.
    if (metadata.kind === 'event_ticket') {
      const orderId = `ticket-${session.id}`
      const { error: ticketError } = await supabase.from('event_ticket_orders').upsert({
        id: orderId,
        event_id: metadata.event_id,
        buyer_name: metadata.buyer_name || session.customer_details?.name || 'Guest',
        buyer_email: session.customer_details?.email || metadata.buyer_email || '',
        tier_id: metadata.tier_id,
        tier_name: metadata.tier_name,
        tickets: Number(metadata.tickets || 1),
        total_pence: Number(metadata.total_pence || session.amount_total || 0),
        stripe_checkout_session_id: session.id,
        payment_status: 'paid',
      }, { onConflict: 'stripe_checkout_session_id' })
      if (ticketError) console.error('Ticket order creation failed:', ticketError)

      // Send confirmation email exactly once per order. Stripe redelivers webhook
      // events, so we atomically claim the order by setting confirmation_sent_at
      // only where it is still null — a redelivery finds it already set and skips.
      const { data: claimed } = await supabase
        .from('event_ticket_orders')
        .update({ confirmation_sent_at: new Date().toISOString() })
        .eq('stripe_checkout_session_id', session.id)
        .is('confirmation_sent_at', null)
        .select('id')
      const shouldSend = !ticketError && (claimed || []).length > 0
      if (shouldSend) {
        const { data: orderEvent } = await supabase.from('events').select('*').eq('id', metadata.event_id).maybeSingle()
        const buyerEmail = session.customer_details?.email || metadata.buyer_email
        const eventPageUrl = `${PUBLIC_BASE_URL}#event/${metadata.event_id}`
        const calendarUrl = `${PUBLIC_BASE_URL}/api/stripe/event-order/${session.id}/calendar.ics`
        const emailResult = await sendEmail({
          to: buyerEmail,
          subject: `Your tickets: ${orderEvent?.title || 'Event'}`,
          html: `<div style="font-family:Arial,sans-serif;color:#232323;line-height:1.6"><h1 style="color:#0b3d2e">King's Ark Dance Academy</h1><h2>You're booked in! 🎟</h2><p>Hi ${(metadata.buyer_name || 'there').split(' ')[0]},</p><p>Thank you for your purchase. Here are your ticket details:</p><p><strong>Event:</strong> ${orderEvent?.title || 'Event'}<br><strong>Date:</strong> ${formatDateGB(orderEvent?.event_date)}${orderEvent?.event_time ? ` · ${orderEvent.event_time.slice(0, 5)}` : ''}<br><strong>Venue:</strong> ${orderEvent?.location || 'To be confirmed'}<br><strong>Ticket type:</strong> ${metadata.tier_name}<br><strong>Tickets:</strong> ${metadata.tickets}<br><strong>Total paid:</strong> ${money(metadata.total_pence)}</p><p><a href="${calendarUrl}" style="background:#c9a227;color:#0b3d2e;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">Add to calendar</a>&nbsp;&nbsp;<a href="${eventPageUrl}" style="color:#0b3d2e">View event page</a></p><p>We can't wait to see you there.</p></div>`,
          attachments: orderEvent?.event_date ? [{ filename: 'event.ics', content: Buffer.from(buildIcs({ title: orderEvent.title, date: orderEvent.event_date, startTime: orderEvent.event_time, endTime: orderEvent.event_end_time, location: orderEvent.location, description: orderEvent.description, url: eventPageUrl })).toString('base64') }] : [],
        })
        // If the send failed (e.g. Resend not configured), release the claim so a retry can send it.
        if (!emailResult.sent) {
          await supabase.from('event_ticket_orders').update({ confirmation_sent_at: null }).eq('stripe_checkout_session_id', session.id)
          console.error('Confirmation email failed:', emailResult.reason)
        }
      }
      return response.json({ received: true })
    }

    const planType = metadata.plan_type || 'day_pass'
    const { data: existingStudents } = await supabase.from('students').select('*').eq('booking_id', metadata.booking_id)
    const studentList = existingStudents || []
    const { error: familyError } = await supabase.from('parent_families').upsert({
      id: metadata.family_id,
      guardian_name: metadata.parent_name,
      guardian_email: session.customer_details?.email || metadata.parent_email,
      plan_type: planType,
      membership_status: 'active',
      stripe_customer_id: session.customer || null,
      stripe_subscription_id: session.subscription || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
    if (familyError) console.error('Family creation failed:', familyError)
    const { error } = await supabase.from('bookings').upsert({
      id: metadata.booking_id,
      family_id: metadata.family_id,
      school_id: metadata.school_id || null,
      contact_name: metadata.parent_name,
      contact_email: session.customer_details?.email || metadata.parent_email,
      date: metadata.class_date,
      session_type: `${metadata.class_name} (${planType})`,
      price: Number(metadata.amount_pence || 0) / 100,
      student_count: studentList.length,
      status: 'Confirmed',
      invoice_status: 'Paid',
      invoice_number: '',
      notes: `Stripe test payment ${session.payment_intent || session.id}`,
      stripe_checkout_session_id: session.id,
      payment_status: 'paid',
      requested_by: null,
    }, { onConflict: 'id' })
    if (error) console.error('Booking creation failed:', error)
    if (!error && !familyError && studentList.length) {
      const { error: studentError } = await supabase.from('students').update({ membership_status: 'active' }).eq('booking_id', metadata.booking_id)
      if (studentError) console.error('Student creation failed:', studentError)
    }
    if (!error) {
      await notifyAdmin('New paid class booking', `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>New paid class booking</h2><p><strong>Parent:</strong> ${metadata.parent_name} (${session.customer_details?.email || metadata.parent_email})<br><strong>Class:</strong> ${metadata.class_name} (${planType})<br><strong>Date:</strong> ${metadata.class_date}<br><strong>Amount:</strong> ${money(metadata.amount_pence)}<br><strong>Children:</strong> ${studentList.length}</p>${dashboardButton('bookings', 'View booking', metadata.booking_id)}</div>`, 'new-booking')

      // Parent confirmation email, exactly once per booking — same idempotency
      // pattern as event tickets: atomically claim the booking by setting
      // confirmation_sent_at only where still null; a redelivery skips.
      const { data: claimed } = await supabase
        .from('bookings')
        .update({ confirmation_sent_at: new Date().toISOString() })
        .eq('id', metadata.booking_id)
        .is('confirmation_sent_at', null)
        .select('id')
      if ((claimed || []).length > 0) {
        const parentEmailTo = session.customer_details?.email || metadata.parent_email
        const [{ data: classSession }, { data: bookingStudents }] = await Promise.all([
          supabase.from('class_sessions').select('start_time,end_time,description').eq('name', metadata.class_name).eq('active', true).maybeSingle(),
          supabase.from('students').select('name').eq('booking_id', metadata.booking_id),
        ])
        const studentNames = (bookingStudents || []).map((student) => student.name).filter(Boolean)
        const planLabel = planType === 'monthly_membership' ? 'Monthly Membership (£25/month)' : 'Day Pass (£10)'
        const classTime = classSession?.start_time ? ` · ${String(classSession.start_time).slice(0, 5)}${classSession.end_time ? `–${String(classSession.end_time).slice(0, 5)}` : ''}` : ''
        const classesUrl = `${PUBLIC_BASE_URL}#classes`
        const ics = metadata.class_date ? buildIcs({ title: `${metadata.class_name} at King's Ark Dance Academy`, date: metadata.class_date, startTime: classSession?.start_time || '10:00', endTime: classSession?.end_time || classSession?.start_time || '11:00', location: "King's Ark Dance Academy, 395 College Rd, Birmingham B44 0HF", description: classSession?.description || '', url: classesUrl }) : ''
        const emailResult = await sendEmail({
          to: parentEmailTo,
          subject: `Booking confirmed: ${metadata.class_name}`,
          html: `<div style="font-family:Arial,sans-serif;color:#232323;line-height:1.6"><h1 style="color:#0b3d2e">King's Ark Dance Academy</h1><h2>You're booked in! 🎉</h2><p>Hi ${(metadata.parent_name || 'there').split(' ')[0]},</p><p>Thank you. Your payment was successful and your child's place is confirmed:</p><p><strong>Class:</strong> ${metadata.class_name}<br><strong>Date:</strong> ${formatDateGB(metadata.class_date)}${classTime}<br><strong>Children:</strong> ${studentNames.join(', ') || studentList.length}<br><strong>Plan:</strong> ${planLabel}<br><strong>Total paid:</strong> ${money(metadata.amount_pence)}</p><p><a href="${classesUrl}" style="background:#c9a227;color:#0b3d2e;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">View classes</a></p><p>A calendar file is attached. Tap it to add the class to your phone's calendar. We can't wait to see you there.</p></div>`,
          attachments: ics ? [{ filename: 'class.ics', content: Buffer.from(ics).toString('base64') }] : [],
        })
        // If the send failed, release the claim so a webhook retry can send it.
        if (!emailResult.sent) {
          await supabase.from('bookings').update({ confirmation_sent_at: null }).eq('id', metadata.booking_id)
          console.error('Class booking confirmation email failed:', emailResult.reason)
        }
      }
    }
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object
    const membershipStatus = event.type.endsWith('deleted') ? 'cancelled' : ['active', 'trialing'].includes(subscription.status) ? 'active' : 'inactive'
    await supabase.from('parent_families').update({ membership_status: membershipStatus, updated_at: new Date().toISOString() }).eq('stripe_subscription_id', subscription.id)
    // Keep the children's roster status in step with the subscription — a cancelled
    // membership must not leave students showing as active in Operations.
    if (event.type === 'customer.subscription.deleted') {
      const { data: cancelledFamilies } = await supabase.from('parent_families').select('id').eq('stripe_subscription_id', subscription.id)
      const familyIds = (cancelledFamilies || []).map((family) => family.id)
      if (familyIds.length) await supabase.from('students').update({ membership_status: 'cancelled' }).in('family_id', familyIds)
    }
  }

  response.json({ received: true })
})

app.use(express.json())

// Basic abuse protection on the unauthenticated endpoints: the two public
// checkout creators and the post-payment lookups (which anyone can poll).
// Authenticated admin/parent endpoints sit behind Supabase JWT verification.
const tooMany = { error: 'Too many attempts. Please wait a few minutes, then try again.' }
const checkoutLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: tooMany })
const lookupLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false, message: tooMany })
const contactLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false, message: tooMany })
app.use(['/api/stripe/create-checkout-session', '/api/stripe/create-event-checkout'], checkoutLimiter)
app.use(['/api/stripe/event-order', '/api/stripe/class-booking'], lookupLimiter)
app.use('/api/public/contact', contactLimiter)

// Health check for Render's uptime monitor — confirms the server is up and can
// reach Supabase (the critical dependency for auth, data, and ticketing).
app.get('/api/health', async (_request, response) => {
  const status = { ok: true, service: 'kada-app', timestamp: new Date().toISOString(), checks: {} }
  status.checks.stripe = stripe ? 'configured' : 'not configured'
  status.checks.email = process.env.RESEND_API_KEY ? 'configured' : 'not configured'
  if (!supabase) {
    status.ok = false
    status.checks.supabase = 'not configured'
    return response.status(503).json(status)
  }
  try {
    const { error } = await supabase.from('events').select('id', { count: 'exact', head: true })
    status.checks.supabase = error ? `error: ${error.message}` : 'reachable'
    if (error) status.ok = false
  } catch (error) {
    status.ok = false
    status.checks.supabase = `error: ${error.message}`
  }
  response.status(status.ok ? 200 : 503).json(status)
})

// Admin notification relay — the dashboard calls this after client-side actions that
// need an admin email (job claim pending review, DBS uploaded, school enquiry received).
// Public contact form — no account needed. Validates + relays to the admin inbox.
// Rate limited (5/hour/IP) since it is unauthenticated.
app.post('/api/public/contact', async (request, response) => {
  const { name, email, topic, message } = request.body || {}
  const cleanName = String(name || '').trim().slice(0, 120)
  const cleanEmail = String(email || '').trim().slice(0, 200)
  const cleanTopic = ['parent', 'school', 'partnership', 'other'].includes(topic) ? topic : 'other'
  const cleanMessage = String(message || '').trim().slice(0, 3000)
  if (!cleanName || !/.+@.+\..+/.test(cleanEmail) || cleanMessage.length < 10) {
    return response.status(400).json({ error: 'Please add your name, a valid email, and a message of at least 10 characters.' })
  }
  const topicLabel = { parent: 'Parent', school: 'School', partnership: 'Partnership', other: 'General' }[cleanTopic]
  const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const result = await notifyAdmin(
    `Website contact: ${topicLabel}`,
    `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>New website message</h2><p><strong>From:</strong> ${esc(cleanName)} &lt;${esc(cleanEmail)}&gt;<br><strong>Topic:</strong> ${topicLabel}</p><p style="white-space:pre-wrap">${esc(cleanMessage)}</p><p style="color:#767066;font-size:12px">Reply directly to this email to respond to the sender.</p></div>`,
    'contact',
  )
  // File the sender in the CRM — matched by email, never duplicated. Filing
  // must never break the contact form, so failures are swallowed.
  if (supabase) {
    const note = `Website message (${topicLabel}): ${cleanMessage.slice(0, 200)}`
    const kind = { school: 'school', parent: 'parent', partnership: 'partner', other: 'other' }[cleanTopic]
    const now = new Date().toISOString()
    void supabase.from('contacts').select('id,notes').eq('email', cleanEmail.toLowerCase()).maybeSingle()
      .then(({ data: existing }) => existing
        ? supabase.from('contacts').update({ notes: `${existing.notes ? `${existing.notes}\n` : ''}${note}`.slice(-4000), last_contacted_at: now, updated_at: now }).eq('id', existing.id)
        : supabase.from('contacts').insert({ kind, name: cleanName, email: cleanEmail.toLowerCase(), source: 'website', notes: note, last_contacted_at: now }))
      .catch((error) => console.error('Contact filing failed:', error))
  }
  if (!result.sent) return response.status(503).json({ error: 'Messages cannot be sent right now. Please email bookings@kingsarkdance.com directly.' })
  response.json({ sent: true })
})

app.post('/api/notify-admin', async (request, response) => {
  const user = await authenticatedUser(request)
  if (!user || !supabase) return response.status(401).json({ error: 'Authentication is required.' })
  const { type, detail = {} } = request.body || {}
  const templates = {
    'job-claim': () => ['Job claim needs review', `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>Job claim pending review</h2><p><strong>Job:</strong> ${detail.sessionType || ''} on ${detail.date || ''}<br><strong>Claimed by:</strong> ${detail.claimedBy || ''}</p>${dashboardButton('jobs', 'Review job claim')}</div>`],
    'dbs-upload': () => ['New DBS certificate uploaded', `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>DBS certificate uploaded</h2><p><strong>Instructor:</strong> ${detail.instructorName || ''}</p>${dashboardButton('instructors', 'Review certificate', detail.instructorId)}</div>`],
    'school-enquiry': () => ['New school enquiry', `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>New school booking enquiry</h2><p><strong>School:</strong> ${detail.schoolName || ''}<br><strong>Contact:</strong> ${detail.contactName || ''} (${detail.email || ''})<br><strong>Session:</strong> ${detail.sessionType || ''} on ${detail.date || ''}<br><strong>Students:</strong> ${detail.studentCount || ''}</p>${dashboardButton('schools', 'View school', detail.schoolId)}</div>`],
  }
  const template = templates[type]
  if (!template) return response.status(400).json({ error: 'Unknown notification type.' })
  const [subject, html] = template()
  const result = await notifyAdmin(subject, html, type === 'school-enquiry' ? 'new-booking' : 'jobs')
  response.json(result)
})

app.get('/api/parent/dashboard', async (request, response) => {
  const user = await authenticatedUser(request)
  if (!user || !supabase) return response.status(401).json({ error: 'Authentication is required.' })
  const { data: families, error: familyError } = await supabase.from('parent_families').select('*').or(`owner_user_id.eq.${user.id},guardian_email.eq.${user.email}`)
  if (familyError) return response.status(500).json({ error: 'Family data could not be loaded.' })
  // Prefer the family that owns this login; legacy guest-checkout families match by email only.
  const family = (families || []).find((item) => item.owner_user_id === user.id) || families?.[0] || null
  if (!family) return response.json({ family: null, bookings: [], students: [] })
  const [{ data: bookings, error: bookingError }, { data: students, error: studentError }] = await Promise.all([
    supabase.from('bookings').select('*').eq('family_id', family.id).order('date'),
    supabase.from('students').select('*').eq('family_id', family.id).order('name'),
  ])
  if (bookingError || studentError) return response.status(500).json({ error: 'Parent records could not be loaded.' })
  response.json({ family, bookings, students })
})

app.post('/api/instructor/mark-done', async (request, response) => {
  const user = await authenticatedUser(request)
  if (!user || !supabase) return response.status(401).json({ error: 'Authentication is required.' })
  const { data: profile } = await supabase.from('profiles').select('role,instructor_id').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'instructor' || !profile.instructor_id) return response.status(403).json({ error: 'Only linked instructors can mark sessions done.' })
  const { bookingId } = request.body || {}
  const { data: booking } = await supabase.from('bookings').select('id').eq('id', bookingId).eq('instructor_id', profile.instructor_id).maybeSingle()
  if (!booking) return response.status(404).json({ error: 'Assigned booking not found.' })
  const { error } = await supabase.from('bookings').update({ status: 'Delivered', needs_admin_attention: true, completed_at: new Date().toISOString() }).eq('id', bookingId)
  if (error) return response.status(500).json({ error: 'Session could not be marked done.' })
  const { data: doneBooking } = await supabase.from('bookings').select('date, session_type, schools(name)').eq('id', bookingId).maybeSingle()
  const { data: instructor } = await supabase.from('instructors').select('name').eq('id', profile.instructor_id).maybeSingle()
  await notifyAdmin('Session marked done — payment review needed', `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>Session awaiting payment review</h2><p><strong>Instructor:</strong> ${instructor?.name || profile.instructor_id}<br><strong>Session:</strong> ${doneBooking?.session_type || ''}<br><strong>School:</strong> ${doneBooking?.schools?.name || '—'}<br><strong>Date:</strong> ${doneBooking?.date || ''}</p>${dashboardButton('bookings', 'Review session', bookingId)}</div>`, 'jobs')
  response.json({ completed: true })
})

app.get('/api/dbs/file/:instructorId', async (request, response) => {
  const user = await authenticatedUser(request)
  if (!user || !supabase) return response.status(401).json({ error: 'Authentication is required.' })
  const { data: profile } = await supabase.from('profiles').select('role,instructor_id').eq('id', user.id).maybeSingle()
  const isAdmin = profile?.role === 'admin'
  const isOwner = profile?.role === 'instructor' && profile.instructor_id === request.params.instructorId
  if (!isAdmin && !isOwner) return response.status(403).json({ error: 'You do not have access to this DBS certificate.' })
  const { data: instructor, error: instructorError } = await supabase.from('instructors').select('dbs_file_path').eq('id', request.params.instructorId).maybeSingle()
  if (instructorError || !instructor?.dbs_file_path) return response.status(404).json({ error: 'No DBS certificate has been uploaded.' })
  const { data, error } = await supabase.storage.from('dbs-certificates').createSignedUrl(instructor.dbs_file_path, 60 * 5)
  if (error) return response.status(500).json({ error: 'Certificate file could not be opened.' })
  response.json({ url: data.signedUrl })
})

app.post('/api/dbs/review', async (request, response) => {
  const user = await authenticatedUser(request)
  if (!user || !supabase) return response.status(401).json({ error: 'Authentication is required.' })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return response.status(403).json({ error: 'Only admins can review DBS certificates.' })
  const { instructorId, decision, rejectionReason = '' } = request.body || {}
  if (!instructorId || !['Approved', 'Rejected'].includes(decision)) return response.status(400).json({ error: 'An instructor and valid DBS decision are required.' })
  const update = { dbs_status: decision, dbs_decided_at: new Date().toISOString(), dbs_rejection_reason: decision === 'Rejected' ? rejectionReason : null }
  const { error } = await supabase.from('instructors').update(update).eq('id', instructorId)
  if (error) return response.status(500).json({ error: 'DBS decision could not be saved.' })
  response.json({ saved: true })
})

app.get('/api/admin/invoice-permissions', async (request, response) => {
  const user = await authenticatedUser(request)
  if (!user || !supabase) return response.status(401).json({ error: 'Authentication is required.' })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return response.status(403).json({ error: 'Only admins can manage invoice permissions.' })
  const { data: profiles, error } = await supabase.from('profiles').select('id,can_send_invoices,full_name').eq('can_send_invoices', true)
  if (error) return response.status(500).json({ error: 'Invoice permissions could not be loaded.' })
  const users = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const emailById = new Map((users.data?.users || []).map((item) => [item.id, item.email]))
  response.json({ users: (profiles || []).map((item) => ({ id: item.id, name: item.full_name, email: emailById.get(item.id) || '' })) })
})

app.post('/api/admin/invoice-permissions', async (request, response) => {
  const user = await authenticatedUser(request)
  if (!user || !supabase) return response.status(401).json({ error: 'Authentication is required.' })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return response.status(403).json({ error: 'Only admins can manage invoice permissions.' })
  const { instructorId, enabled } = request.body || {}
  const { data: instructor } = await supabase.from('instructors').select('email').eq('id', instructorId).maybeSingle()
  if (!instructor?.email) return response.status(404).json({ error: 'Instructor email not found.' })
  const users = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const target = (users.data?.users || []).find((item) => item.email?.toLowerCase() === instructor.email.toLowerCase())
  if (!target) return response.status(404).json({ error: 'No auth user is linked to this instructor email.' })
  const { error } = await supabase.from('profiles').update({ can_send_invoices: Boolean(enabled) }).eq('id', target.id)
  if (error) return response.status(500).json({ error: 'Invoice permission could not be saved.' })
  response.json({ saved: true, enabled: Boolean(enabled) })
})

/* ------------------------------------------------------------------ */
/* Team management — admins list, invite, update and remove staff      */
/* accounts. Roles/permissions/job titles live on profiles; emails     */
/* come from auth.users (service role only).                           */
/* ------------------------------------------------------------------ */
const TEAM_PERMISSIONS = ['bookings', 'contacts', 'students', 'events', 'messages', 'site', 'sales']
const cleanPermissions = (value) => (Array.isArray(value) ? value.filter((item) => TEAM_PERMISSIONS.includes(item)) : [])

async function requireAdmin(request, response) {
  const user = await authenticatedUser(request)
  if (!user || !supabase) { response.status(401).json({ error: 'Authentication is required.' }); return null }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') { response.status(403).json({ error: 'Only admins can manage the team.' }); return null }
  return user
}

app.get('/api/admin/team', async (request, response) => {
  const user = await requireAdmin(request, response)
  if (!user) return
  const { data: profiles, error } = await supabase.from('profiles').select('id,role,full_name,job_title,permissions').in('role', ['admin', 'staff']).order('full_name')
  if (error) return response.status(500).json({ error: 'Team could not be loaded.' })
  const users = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const emailById = new Map((users.data?.users || []).map((item) => [item.id, item.email]))
  response.json({ members: (profiles || []).map((item) => ({ id: item.id, name: item.full_name || '', email: emailById.get(item.id) || '', role: item.role, jobTitle: item.job_title || '', permissions: item.permissions || [] })) })
})

app.post('/api/admin/team/invite', async (request, response) => {
  const user = await requireAdmin(request, response)
  if (!user) return
  const { name = '', email = '', jobTitle = '', permissions = [] } = request.body || {}
  const cleanName = String(name).trim().slice(0, 120)
  const cleanEmail = String(email).trim().toLowerCase().slice(0, 200)
  if (!cleanName || !/.+@.+\..+/.test(cleanEmail)) return response.status(400).json({ error: 'A name and a valid email are required.' })
  // The invite email lets the new staff member set their own password. The
  // handle_new_user trigger creates their staff profile from this metadata.
  const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(cleanEmail, { data: { role: 'staff', full_name: cleanName }, redirectTo: `${APP_URL}/` })
  const alreadyRegistered = inviteError && /already|registered|exists/i.test(inviteError.message)
  if (inviteError && !alreadyRegistered) return response.status(500).json({ error: `Invite could not be sent: ${inviteError.message}` })
  const users = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const target = (users.data?.users || []).find((item) => item.email?.toLowerCase() === cleanEmail)
  if (!target) return response.status(502).json({ error: 'The invite was sent but the new profile is not visible yet — try again in a moment.' })
  const { error } = await supabase.from('profiles').update({ role: 'staff', full_name: cleanName, job_title: String(jobTitle).trim().slice(0, 80), permissions: cleanPermissions(permissions) }).eq('id', target.id)
  if (error) return response.status(500).json({ error: 'Profile could not be updated.' })
  response.json({ invited: true, alreadyRegistered })
})

app.post('/api/admin/team/:userId', async (request, response) => {
  const user = await requireAdmin(request, response)
  if (!user) return
  const { userId } = request.params
  const { role = 'staff', jobTitle = '', permissions = [] } = request.body || {}
  if (!['admin', 'staff'].includes(role)) return response.status(400).json({ error: 'Role must be admin or staff.' })
  if (userId === user.id && role !== 'admin') return response.status(400).json({ error: 'You cannot remove your own admin role.' })
  const { error } = await supabase.from('profiles').update({ role, job_title: String(jobTitle).trim().slice(0, 80), permissions: cleanPermissions(permissions) }).eq('id', userId)
  if (error) return response.status(500).json({ error: 'Team member could not be saved.' })
  response.json({ saved: true })
})

app.post('/api/admin/team/:userId/remove', async (request, response) => {
  const user = await requireAdmin(request, response)
  if (!user) return
  const { userId } = request.params
  if (userId === user.id) return response.status(400).json({ error: 'You cannot remove your own access.' })
  const { data: target } = await supabase.from('profiles').select('role').eq('id', userId).maybeSingle()
  if (!target || !['admin', 'staff'].includes(target.role)) return response.status(404).json({ error: 'Team member not found.' })
  await supabase.from('profiles').delete().eq('id', userId)
  const { error } = await supabase.auth.admin.deleteUser(userId)
  if (error) return response.status(500).json({ error: 'Sign-in could not be removed.' })
  response.json({ removed: true })
})

/* ------------------------------------------------------------------ */
/* Inbound email → Contacts. Point an email automation at this URL     */
/* (Power Automate / Zapier / Make HTTP POST, or Mailgun Routes form   */
/* post) with the shared secret; the sender is filed/updated in the    */
/* CRM, matched by email so repeats never duplicate.                   */
/* ------------------------------------------------------------------ */
app.post('/api/inbound-email', express.urlencoded({ extended: true }), async (request, response) => {
  const secret = process.env.INBOUND_EMAIL_SECRET
  if (!secret || request.query.token !== secret) return response.status(401).json({ error: 'Invalid or missing token.' })
  if (!supabase) return response.status(503).json({ error: 'Database is not configured.' })
  const body = request.body || {}
  const rawFrom = body.from || body.From || body.sender || ''
  const subject = String(body.subject || body.Subject || '').trim().slice(0, 200)
  const snippet = String(body.text || body['body-plain'] || body.body || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  const sender = parseSender(rawFrom)
  if (!sender.email) return response.status(400).json({ error: 'No sender email address found in the payload.' })
  const name = (sender.name || sender.email.split('@')[0].replace(/[._-]+/g, ' ')).slice(0, 120)
  const note = [`Email: ${subject || '(no subject)'}`, snippet].filter(Boolean).join(' — ')
  const now = new Date().toISOString()
  const { data: existing } = await supabase.from('contacts').select('id,notes').eq('email', sender.email).maybeSingle()
  if (existing) {
    await supabase.from('contacts').update({ notes: `${existing.notes ? `${existing.notes}\n` : ''}${note}`.slice(-4000), last_contacted_at: now, updated_at: now }).eq('id', existing.id)
    return response.json({ filed: true, created: false })
  }
  const { error } = await supabase.from('contacts').insert({ kind: 'other', name, email: sender.email, source: 'email', notes: note, last_contacted_at: now })
  if (error) return response.status(500).json({ error: 'Contact could not be filed.' })
  response.json({ filed: true, created: true })
})

/* ------------------------------------------------------------------ */
/* Parent portal settings — parents update their own family details    */
/* and their children's welfare notes. Ownership verified server-side. */
/* ------------------------------------------------------------------ */
app.post('/api/parent/settings', async (request, response) => {
  const user = await authenticatedUser(request)
  if (!user || !supabase) return response.status(401).json({ error: 'Authentication is required.' })
  const { data: families, error: familyError } = await supabase.from('parent_families').select('*').or(`owner_user_id.eq.${user.id},guardian_email.eq.${user.email}`)
  if (familyError) return response.status(500).json({ error: 'Family data could not be loaded.' })
  const family = (families || []).find((item) => item.owner_user_id === user.id) || families?.[0]
  if (!family) return response.status(404).json({ error: 'No family record found — complete a booking first.' })
  const { family: familyUpdates = {}, students: studentUpdates = [] } = request.body || {}
  const cleanText = (value, max) => (value === undefined ? undefined : String(value || '').trim().slice(0, max))
  const update = {}
  ;['guardian_name', 'guardian_phone', 'address', 'emergency_contact_name', 'emergency_contact_phone'].forEach((key) => {
    const value = cleanText(familyUpdates[key], key === 'address' ? 300 : 120)
    if (value !== undefined) update[key] = value
  })
  if (familyUpdates.comms && typeof familyUpdates.comms === 'object') update.comms = { reminders: Boolean(familyUpdates.comms.reminders), marketing: Boolean(familyUpdates.comms.marketing) }
  let savedFamily = family
  if (Object.keys(update).length) {
    const { data: saved, error } = await supabase.from('parent_families').update({ ...update, updated_at: new Date().toISOString() }).eq('id', family.id).select().maybeSingle()
    if (error) return response.status(500).json({ error: 'Family settings could not be saved.' })
    savedFamily = saved || family
  }
  const savedStudents = []
  for (const studentUpdate of (Array.isArray(studentUpdates) ? studentUpdates : []).slice(0, 20)) {
    if (!studentUpdate?.id) continue
    const payload = {
      dietary_requirements: cleanText(studentUpdate.dietary_requirements, 500),
      medical_notes: cleanText(studentUpdate.medical_notes, 500),
      photo_consent: typeof studentUpdate.photo_consent === 'boolean' ? studentUpdate.photo_consent : null,
    }
    // eslint-disable-next-line no-await-in-loop
    const { data: savedStudent } = await supabase.from('students').update(payload).eq('id', studentUpdate.id).eq('family_id', family.id).select().maybeSingle()
    if (savedStudent) savedStudents.push(savedStudent)
  }
  response.json({ family: savedFamily, students: savedStudents })
})

function invoiceOverrides(booking, overrides = {}) {
  const invoiceDescription = typeof overrides.description === 'string' ? overrides.description : overrides.invoiceDescription
  const invoiceRate = overrides.rate ?? overrides.invoiceRate
  const invoiceAmount = overrides.amount ?? overrides.invoiceAmount
  const discountPercent = overrides.discountPercent
  return {
    ...booking,
    ...(invoiceDescription !== undefined ? { invoiceDescription } : {}),
    ...(invoiceRate !== undefined && Number.isFinite(Number(invoiceRate)) ? { invoiceRate: Number(invoiceRate) } : {}),
    ...(invoiceAmount !== undefined && Number.isFinite(Number(invoiceAmount)) ? { invoiceAmount: Number(invoiceAmount) } : {}),
    ...(discountPercent !== undefined && Number.isFinite(Number(discountPercent)) ? { discountPercent: Number(discountPercent) } : {}),
  }
}

app.get('/api/invoices/pdf/:bookingId', async (request, response) => {
  const user = await authenticatedUser(request)
  if (!user || !supabase) return response.status(401).json({ error: 'Authentication is required.' })
  const { data: profile } = await supabase.from('profiles').select('role,can_send_invoices,full_name').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin' && !profile?.can_send_invoices) return response.status(403).json({ error: 'You do not have permission to generate invoices.' })
  const { data: booking, error: bookingError } = await supabase.from('bookings').select('*').eq('id', request.params.bookingId).single()
  if (bookingError || !booking) return response.status(404).json({ error: 'Booking not found.' })
  const { data: school } = booking.school_id ? await supabase.from('schools').select('*').eq('id', booking.school_id).maybeSingle() : { data: null }
  const { data: settings, error: settingsError } = await supabase.from('invoice_settings').select('account_name,sort_code,account_number').eq('id', 'default').single()
  if (settingsError) return response.status(500).json({ error: 'Invoice payment details could not be loaded.' })
  const invoiceBooking = invoiceOverrides({ ...booking, studentCount: booking.student_count, sessionType: booking.session_type, contactName: booking.contact_name, contactEmail: booking.contact_email, invoiceNumber: booking.invoice_number, price: booking.price }, request.query)
  const pdf = await generateInvoicePdf({ booking: invoiceBooking, school: school ? { name: school.name, contactName: school.contact_name, email: school.email } : null, settings, preparedBy: profile.full_name || user.email })
  response.type('application/pdf').set('Content-Disposition', `attachment; filename="${booking.invoice_number || booking.id}.pdf"`).send(pdf)
})

function invoiceHtml({ booking, school }) {
  return `<div style="font-family:Arial,sans-serif;color:#232323;line-height:1.6"><h1 style="color:#0b3d2e">King's Ark Dance Academy</h1><p><strong>Invoice:</strong> ${booking.invoiceNumber || 'To be assigned'}<br><strong>Workshop date:</strong> ${booking.date || 'To be confirmed'}<br><strong>Description:</strong> ${booking.sessionType || 'Dance workshop'}<br><strong>Amount due:</strong> £${Number(booking.price || 0).toLocaleString()}</p><p>Dear ${school?.contact_name || booking.contactName || 'School contact'},</p><p>Please find your invoice details above. Payment is due within 14 days.</p><p>Thank you for booking King's Ark Dance Academy.</p></div>`
}

app.post('/api/invoices/send', async (request, response) => {
  if (!process.env.RESEND_API_KEY) return response.status(503).json({ error: 'Resend is not configured on the server.' })
  if (!supabase) return response.status(503).json({ error: 'Supabase server authentication is not configured.' })

  const accessToken = request.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!accessToken) return response.status(401).json({ error: 'Authentication is required.' })
  const { data: userData } = await supabase.auth.getUser(accessToken)
  if (!userData.user) return response.status(401).json({ error: 'Your session is not valid.' })
  const { data: profile } = await supabase.from('profiles').select('role,can_send_invoices,full_name').eq('id', userData.user.id).maybeSingle()
  if (profile?.role !== 'admin' && !profile?.can_send_invoices) return response.status(403).json({ error: 'You do not have permission to send invoices.' })

  const { booking, school } = request.body || {}
  const recipient = school?.email || booking?.contactEmail
  if (!booking?.id || !recipient || booking.status !== 'Confirmed') {
    return response.status(400).json({ error: 'A confirmed booking and school contact email are required.' })
  }

  const { data: settings, error: settingsError } = await supabase.from('invoice_settings').select('account_name,sort_code,account_number').eq('id', 'default').single()
  if (settingsError) return response.status(500).json({ error: 'Invoice payment details could not be loaded.' })

  const pdf = await generateInvoicePdf({ booking: invoiceOverrides(booking, booking.invoiceOverrides), school, settings, preparedBy: profile.full_name || userData.user.email })
  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.INVOICE_FROM_EMAIL || 'KADA Invoices <onboarding@resend.dev>',
      to: [recipient],
      ...(process.env.ADMIN_NOTIFICATION_EMAIL ? { bcc: [process.env.ADMIN_NOTIFICATION_EMAIL] } : {}),
      subject: `Invoice ${booking.invoiceNumber || ''} - King's Ark Dance Academy`.replace('  ', ' '),
      html: invoiceHtml({ booking, school }),
      attachments: [{ filename: `${booking.invoiceNumber || booking.id}.pdf`, content: pdf.toString('base64') }],
    }),
  })
  const result = await resendResponse.json()
  if (!resendResponse.ok) return response.status(502).json({ error: result.message || 'Resend could not send the invoice.' })

  const { error: bookingUpdateError } = await supabase.from('bookings').update({ invoice_status: 'Sent' }).eq('id', booking.id)
  if (bookingUpdateError) return response.status(500).json({ error: 'Invoice was sent, but booking status could not be updated.' })

  response.json({ id: result.id, recipient })
})

async function generateInvoicePdf({ booking, school, settings, preparedBy }) {
  const document = new PDFDocument({ size: 'A4', margin: 0 })
  const chunks = []
  document.on('data', (chunk) => chunks.push(chunk))
  const done = new Promise((resolve) => document.on('end', resolve))
  const pageWidth = 595.28
  const pageHeight = 841.89
  const margin = 56.69
  const emerald = '#0d3b2e'
  const gold = '#a97e2b'
  const ink = '#1a1812'
  const muted = '#6b6558'
  const ivory = '#faf6ec'
  const rule = '#ddd0aa'
  const money = (value) => `£${Number(value || 0).toFixed(2)}`
  const subtotal = Number(booking.invoiceAmount ?? booking.price ?? 0)
  const discountPercent = Math.min(100, Math.max(0, Number(booking.discountPercent || 0)))
  const discount = subtotal * discountPercent / 100
  const totalDue = Math.max(0, subtotal - discount)
  const formatDate = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'To be confirmed'

  document.rect(0, 0, pageWidth, 130.39).fill(emerald)
  document.rect(0, 130.39, pageWidth, 3.4).fill(gold)
  document.circle(margin + 28.35, 65.2, 31.75).fill(ivory)
  const logoPath = ['public/images/logo-mark.png', 'dist/images/logo-mark.png'].map((candidate) => path.resolve(process.cwd(), candidate)).find((candidate) => fs.existsSync(candidate))
  if (logoPath) document.image(logoPath, margin + 5.67, 42.52, { fit: [45.36, 45.36], align: 'center', valign: 'center' })
  document.font('Times-Bold').fontSize(17).fillColor(ivory).text("King's Ark Dance Academy", margin + 68.03, 56.69)
  document.font('Helvetica').fontSize(8.5).fillColor(gold).text('GOSPEL AFROBEATS  ·  BIRMINGHAM', margin + 68.03, 72.28)
  document.font('Times-BoldItalic').fontSize(22).fillColor(ivory).text('Invoice', pageWidth - margin - 100, 56.69, { width: 100, align: 'right' })
  document.font('Helvetica').fontSize(9).fillColor(gold).text(booking.invoiceNumber || 'Invoice', pageWidth - margin - 140, 72.28, { width: 140, align: 'right' })

  let y = 164.41
  document.font('Helvetica-Bold').fontSize(8.5).fillColor(muted).text('BILL TO', margin, y)
  document.text('INVOICE DETAILS', pageWidth / 2 + 14.17, y)
  y += 17.01
  document.font('Times-Bold').fontSize(12).fillColor(ink).text(school?.name || 'School contact', margin, y)
  let detailY = y
  for (const [label, value] of [['Invoice date', formatDate(new Date().toISOString().slice(0, 10))], ['Due date', formatDate(new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10))], ['Workshop date', formatDate(booking.date)]]) {
    document.font('Helvetica').fontSize(8.5).fillColor(muted).text(label, pageWidth / 2 + 14.17, detailY)
    document.font('Helvetica-Bold').fillColor(ink).text(value, pageWidth - margin - 120, detailY, { width: 120, align: 'right' })
    detailY += 15.59
  }
  y += 17.01
  document.font('Helvetica').fontSize(9).fillColor(muted)
  if (school?.contactName || booking.contactName) { document.text(school?.contactName || booking.contactName, margin, y); y += 14.17 }
  if (school?.email || booking.contactEmail) { document.text(school?.email || booking.contactEmail, margin, y); y += 14.17 }
  y = Math.max(y, detailY) + 28.35

  const tableTop = y
  document.rect(margin, tableTop, pageWidth - margin * 2, 25.51).fill(emerald)
  document.font('Helvetica-Bold').fontSize(8.5).fillColor(ivory).text('DESCRIPTION', margin + 11.34, tableTop + 8)
  document.text('STUDENTS', pageWidth - margin - 180, tableTop + 8, { width: 70, align: 'right' })
  document.text('RATE', pageWidth - margin - 120, tableTop + 8, { width: 55, align: 'right' })
  document.text('AMOUNT', pageWidth - margin - 55, tableTop + 8, { width: 50, align: 'right' })
  const rowY = tableTop + 25.51
  if (Number(booking.studentCount) % 2 === 0) document.rect(margin, rowY, pageWidth - margin * 2, 39.69).fill(ivory)
  document.font('Helvetica-Bold').fontSize(9.5).fillColor(ink).text(booking.invoiceDescription || booking.sessionType || 'Dance workshop', margin + 11.34, rowY + 8)
  document.font('Helvetica').fontSize(8).fillColor(muted).text('Workshop session', margin + 11.34, rowY + 22)
  document.font('Helvetica').fontSize(9).fillColor(ink).text(String(booking.studentCount || 0), pageWidth - margin - 180, rowY + 16, { width: 70, align: 'right' })
  document.text(money(booking.invoiceRate ?? booking.price), pageWidth - margin - 120, rowY + 16, { width: 55, align: 'right' })
  document.font('Helvetica-Bold').fontSize(9.5).text(money(subtotal), pageWidth - margin - 55, rowY + 16, { width: 50, align: 'right' })
  document.moveTo(margin, rowY + 39.69).lineTo(pageWidth - margin, rowY + 39.69).strokeColor(rule).lineWidth(0.6).stroke()

  let totalsY = rowY + 68.04
  const labelX = pageWidth - margin - 170
  const valueX = pageWidth - margin - 4
  document.font('Helvetica').fontSize(9.5).fillColor(muted).text('Subtotal', labelX, totalsY)
  document.fillColor(ink).text(money(subtotal), valueX - 90, totalsY, { width: 90, align: 'right' })
  totalsY += 17.01
  if (discountPercent > 0) {
    document.fillColor(muted).text(`Discount (${discountPercent.toFixed(2).replace(/\.00$/, '')}%)`, labelX, totalsY)
    document.fillColor(ink).text(`-${money(discount)}`, valueX - 90, totalsY, { width: 90, align: 'right' })
    totalsY += 17.01
  }
  document.moveTo(labelX, totalsY - 5.67).lineTo(valueX, totalsY - 5.67).strokeColor(rule).stroke()
  totalsY += 17.01
  document.font('Times-Bold').fontSize(13).fillColor(emerald).text('Total due', labelX, totalsY)
  document.text(money(totalDue), valueX - 100, totalsY, { width: 100, align: 'right' })

  const boxY = totalsY + 30
  document.roundedRect(margin, boxY, pageWidth - margin * 2, 56.69, 5.67).fillAndStroke(ivory, rule)
  document.font('Helvetica-Bold').fontSize(8.5).fillColor(gold).text('PAYMENT DETAILS', margin + 14.17, boxY + 10)
  document.font('Helvetica').fontSize(9).fillColor(ink).text(`Account name: ${settings.account_name || 'Not configured'}`, margin + 14.17, boxY + 26)
  document.text(`Sort code: ${settings.sort_code || 'Not configured'}   Account number: ${settings.account_number || 'Not configured'}`, margin + 14.17, boxY + 41)
  document.text(`Reference: ${booking.invoiceNumber || booking.id}`, pageWidth - margin - 160, boxY + 26, { width: 145, align: 'right' })

  const footY = pageHeight - margin - 39.69
  document.moveTo(margin, footY).lineTo(pageWidth - margin, footY).strokeColor(rule).stroke()
  document.font('Helvetica').fontSize(8).fillColor(muted).text("King's Ark Dance Academy  ·  395 College Rd, Birmingham B44 0HF", margin, footY + 14, { width: pageWidth - margin * 2, align: 'center' })
  document.text('bookings@kingsarkdance.com  ·  +44 7535 897732  ·  kingsarkdance.com', margin, footY + 25, { width: pageWidth - margin * 2, align: 'center' })
  document.font('Helvetica-Oblique').fontSize(7.5).text(`Thank you for booking King's Ark Dance Academy. Payment is due within 14 days of this invoice.  ·  Prepared by ${preparedBy}`, margin, footY + 36, { width: pageWidth - margin * 2, align: 'center' })
  document.end()
  await done
  return Buffer.concat(chunks)
}

// Current date and wall-clock minutes in Europe/London — class times are UK local.
function londonNow() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
  const get = (type) => parts.find((part) => part.type === type)?.value || ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) }
}

app.post('/api/stripe/create-checkout-session', async (request, response) => {
  if (!stripe) return response.status(503).json({ error: 'Stripe is not configured on the server.' })

  const { planType, className, classDate, parentName, parentEmail, students } = request.body || {}
  const priceId = planType === 'monthly_membership' ? process.env.STRIPE_MONTHLY_PRICE_ID : process.env.STRIPE_DAY_PASS_PRICE_ID
  if (!priceId || !['monthly_membership', 'day_pass'].includes(planType) || !className || !classDate || !parentName || !parentEmail || !Array.isArray(students) || !students.length || students.some((student) => !student?.name || !student?.dateOfBirth)) {
    return response.status(400).json({ error: 'Plan, class, date, parent details, and at least one complete student record are required.' })
  }

  const bookingId = `parent-${crypto.randomUUID()}`
  if (!supabase) return response.status(503).json({ error: 'Supabase server storage is not configured.' })

  // The chosen date must be a real scheduled session for the chosen class: matching
  // day of week, not in the past, and within the booking window the form offers.
  const { data: classSession } = await supabase.from('class_sessions').select('id,day_of_week,start_time,end_time').eq('name', className).eq('active', true).maybeSingle()
  if (!classSession) return response.status(400).json({ error: 'That class is not currently scheduled. Please pick an available class and date.' })
  const requestedDate = new Date(`${classDate}T00:00:00Z`)
  const todayUtc = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  const daysAhead = (requestedDate - todayUtc) / 86400000
  if (Number.isNaN(requestedDate.getTime()) || requestedDate.getUTCDay() !== Number(classSession.day_of_week) || daysAhead < 0 || daysAhead > 180) {
    return response.status(400).json({ error: 'That date is not available for this class. Please pick a highlighted class date.' })
  }
  // Same-day bookings close once the class has finished (UK local time).
  if (classDate === londonNow().date) {
    const endTime = classSession.end_time || classSession.start_time
    if (endTime) {
      const [endHour, endMinute] = String(endTime).split(':').map(Number)
      if (londonNow().minutes >= (endHour || 0) * 60 + (endMinute || 0)) {
        return response.status(400).json({ error: "Today's class has already finished — please pick a future class date." })
      }
    }
  }

  const user = await authenticatedUser(request)

  // Reuse the parent's existing family when we can find one (signed-in owner, or
  // a previous booking under the same email) so repeat bookings land in one place
  // instead of a duplicate family the parent dashboard can no longer resolve.
  const familyMatch = [`guardian_email.eq.${parentEmail}`]
  if (user?.id) familyMatch.push(`owner_user_id.eq.${user.id}`)
  const { data: existingFamilies } = await supabase.from('parent_families').select('id,owner_user_id').or(familyMatch.join(',')).limit(1)
  let familyId = existingFamilies?.[0]?.id || ''
  if (familyId) {
    if (user?.id && !existingFamilies[0].owner_user_id) {
      await supabase.from('parent_families').update({ owner_user_id: user.id }).eq('id', familyId)
    }
  } else {
    familyId = `family-${crypto.randomUUID()}`
    const { error: familyError } = await supabase.from('parent_families').insert({ id: familyId, owner_user_id: user?.id || null, guardian_name: parentName, guardian_email: parentEmail, plan_type: planType, membership_status: 'pending' })
    if (familyError) return response.status(500).json({ error: 'Family record could not be created.' })
  }
  const { error: bookingError } = await supabase.from('bookings').insert({ id: bookingId, family_id: familyId, contact_name: parentName, contact_email: parentEmail, date: classDate, session_type: className, price: planType === 'monthly_membership' ? 25 : 10, student_count: students.length, status: 'Enquiry', invoice_status: 'Not sent', payment_status: 'pending' })
  if (bookingError) return response.status(500).json({ error: 'Booking record could not be created.' })
  const { error: studentsError } = await supabase.from('students').insert(students.map((student, index) => ({ id: `student-${bookingId}-${index + 1}`, booking_id: bookingId, family_id: familyId, parent_name: parentName, parent_email: parentEmail, name: student.name, date_of_birth: student.dateOfBirth, class_name: className, term: classDate, membership_status: 'inactive' })))
  if (studentsError) return response.status(500).json({ error: 'Student records could not be created.' })
  // Return to the host the parent actually used (same pattern as event checkout) —
  // so dev/localhost sessions redirect back to dev, not to the live site.
  const requestOrigin = request.headers.origin || request.headers.referer?.replace(/\/[^/]*$/, '') || ''
  const clientUrl = requestOrigin.startsWith('http') ? requestOrigin : (process.env.CLIENT_URL || 'http://localhost:5173')
  const session = await stripe.checkout.sessions.create({
    mode: planType === 'monthly_membership' ? 'subscription' : 'payment',
    customer_email: parentEmail,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { booking_id: bookingId, family_id: familyId, plan_type: planType, class_name: className, class_date: classDate, amount_pence: planType === 'monthly_membership' ? '2500' : '1000', parent_name: parentName, parent_email: parentEmail },
    success_url: `${clientUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}#classes`,
    cancel_url: `${clientUrl}#classes`,
  })

  response.json({ url: session.url })
})

// ------------------------------------------------------------------
// Ticketed events — separate from the Day Pass/Membership flow above.
// Line items are built ad-hoc per ticket tier (price_data); the existing
// Stripe products/prices are never touched.
// ------------------------------------------------------------------
app.post('/api/stripe/create-event-checkout', async (request, response) => {
  if (!stripe || !supabase) return response.status(503).json({ error: 'Ticketing is not configured on the server.' })
  const { eventId, tierId, quantity, buyerName, buyerEmail } = request.body || {}
  const qty = Math.floor(Number(quantity))
  if (!eventId || !tierId || !Number.isInteger(qty) || qty < 1 || qty > 20 || !buyerName?.trim() || !/.+@.+\..+/.test(buyerEmail || '')) {
    return response.status(400).json({ error: 'Event, ticket tier, quantity (1-20), and your name and email are required.' })
  }
  const { data: event, error: eventError } = await supabase.from('events').select('*').eq('id', eventId).maybeSingle()
  if (eventError || !event) return response.status(404).json({ error: 'Event not found.' })
  if (event.status !== 'published' || !event.ticketing_enabled) return response.status(400).json({ error: 'Tickets are not on sale for this event.' })
  const tier = (event.ticket_tiers || []).find((item) => item.id === tierId)
  if (!tier) return response.status(400).json({ error: 'That ticket tier is not available for this event.' })
  const unitAmount = Math.round(Number(tier.pricePence))
  const bundleSize = Math.max(1, Math.floor(Number(tier.bundleSize) || 1))
  if (!Number.isInteger(unitAmount) || unitAmount < 30) return response.status(400).json({ error: 'This ticket tier is not priced correctly yet.' })

  const tierDescription = [bundleSize > 1 ? `${bundleSize} tickets per purchase` : '', event.event_date ? `Event date: ${event.event_date}` : ''].filter(Boolean).join(' · ')
  // Return to the host the buyer actually used (works through the Codespaces forwarded
  // URL, where plain localhost isn't reachable from the browser).
  const requestOrigin = request.headers.origin || request.headers.referer?.replace(/\/[^/]*$/, '') || ''
  const clientUrl = requestOrigin.startsWith('http') ? requestOrigin : (process.env.CLIENT_URL || 'http://localhost:5173')
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: buyerEmail.trim(),
    line_items: [{
      quantity: qty,
      price_data: {
        currency: 'gbp',
        unit_amount: unitAmount,
        product_data: {
          name: `${event.title} - ${tier.name}`,
          ...(tierDescription ? { description: tierDescription } : {}),
        },
      },
    }],
    metadata: {
      kind: 'event_ticket',
      event_id: event.id,
      tier_id: tier.id,
      tier_name: tier.name,
      quantity: String(qty),
      bundle_size: String(bundleSize),
      tickets: String(qty * bundleSize),
      total_pence: String(unitAmount * qty),
      buyer_name: buyerName.trim(),
      buyer_email: buyerEmail.trim(),
    },
    success_url: `${clientUrl}?ticket=success&session_id={CHECKOUT_SESSION_ID}#event/${event.id}`,
    cancel_url: `${clientUrl}#event/${event.id}`,
  })
  response.json({ url: session.url })
})

// Public order lookup for the post-payment success page. The Stripe session id acts as the secret.
app.get('/api/stripe/event-order/:sessionId', async (request, response) => {
  if (!supabase) return response.status(503).json({ error: 'Supabase server storage is not configured.' })
  const { data: order, error } = await supabase.from('event_ticket_orders').select('*').eq('stripe_checkout_session_id', request.params.sessionId).maybeSingle()
  if (error) return response.status(500).json({ error: 'Order could not be loaded.' })
  if (!order) return response.status(404).json({ status: 'pending' })
  const { data: orderEvent } = await supabase.from('events').select('title,event_date,location').eq('id', order.event_id).maybeSingle()
  response.json({
    status: order.payment_status,
    order: {
      eventTitle: orderEvent?.title || 'Event',
      eventDate: orderEvent?.event_date || '',
      location: orderEvent?.location || '',
      tierName: order.tier_name,
      tickets: order.tickets,
      totalPence: order.total_pence,
      buyerName: order.buyer_name,
      buyerEmail: order.buyer_email,
    },
  })
})

// Downloadable .ics calendar file for a ticket order (linked from the confirmation email).
app.get('/api/stripe/event-order/:sessionId/calendar.ics', async (request, response) => {
  if (!supabase) return response.status(503).json({ error: 'Supabase server storage is not configured.' })
  const { data: order } = await supabase.from('event_ticket_orders').select('*').eq('stripe_checkout_session_id', request.params.sessionId).maybeSingle()
  if (!order) return response.status(404).json({ error: 'Order not found.' })
  const { data: orderEvent } = await supabase.from('events').select('*').eq('id', order.event_id).maybeSingle()
  if (!orderEvent?.event_date) return response.status(400).json({ error: 'Event date is not set.' })
  const ics = buildIcs({ title: orderEvent.title, date: orderEvent.event_date, startTime: orderEvent.event_time, endTime: orderEvent.event_end_time, location: orderEvent.location, description: orderEvent.description, url: `${PUBLIC_BASE_URL}#event/${order.event_id}` })
  response.type('text/calendar').set('Content-Disposition', 'attachment; filename="event.ics"').send(ics)
})

// Public booking lookup for the post-payment class success screen. The Stripe
// session id acts as the secret (same pattern as the event-order lookup).
app.get('/api/stripe/class-booking/:sessionId', async (request, response) => {
  if (!supabase) return response.status(503).json({ error: 'Supabase server storage is not configured.' })
  const { data: booking, error } = await supabase.from('bookings').select('*').eq('stripe_checkout_session_id', request.params.sessionId).maybeSingle()
  if (error) return response.status(500).json({ error: 'Booking could not be loaded.' })
  if (!booking) return response.status(404).json({ status: 'pending' })
  // session_type is stored as "Class name (plan_type)" by the webhook.
  const className = (booking.session_type || '').replace(/ \((monthly_membership|day_pass)\)$/, '')
  const [{ data: bookingStudents }, { data: family }, { data: classSession }] = await Promise.all([
    supabase.from('students').select('name').eq('booking_id', booking.id),
    booking.family_id ? supabase.from('parent_families').select('plan_type').eq('id', booking.family_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('class_sessions').select('start_time,end_time').eq('name', className).eq('active', true).maybeSingle(),
  ])
  response.json({
    status: booking.payment_status,
    booking: {
      className,
      classDate: booking.date,
      startTime: classSession?.start_time ? String(classSession.start_time).slice(0, 5) : '',
      endTime: classSession?.end_time ? String(classSession.end_time).slice(0, 5) : '',
      planType: family?.plan_type || '',
      parentName: booking.contact_name,
      parentEmail: booking.contact_email,
      pricePence: Math.round(Number(booking.price || 0) * 100),
      students: (bookingStudents || []).map((student) => student.name).filter(Boolean),
    },
  })
})

app.post('/api/parent/billing-portal', async (request, response) => {
  if (!stripe || !supabase) return response.status(503).json({ error: 'Billing is not configured on the server.' })
  const user = await authenticatedUser(request)
  if (!user) return response.status(401).json({ error: 'Authentication is required.' })
  const { data: family } = await supabase.from('parent_families').select('stripe_customer_id').eq('owner_user_id', user.id).maybeSingle()
  if (!family?.stripe_customer_id) return response.status(400).json({ error: 'No paid family subscription or customer record was found.' })
  const portal = await stripe.billingPortal.sessions.create({ customer: family.stripe_customer_id, return_url: `${APP_URL}#parent-dashboard` })
  response.json({ url: portal.url })
})

app.post('/api/parent/cancel-subscription', async (request, response) => {
  if (!stripe || !supabase) return response.status(503).json({ error: 'Billing is not configured on the server.' })
  const user = await authenticatedUser(request)
  if (!user) return response.status(401).json({ error: 'Authentication is required.' })
  const { data: family } = await supabase.from('parent_families').select('id,stripe_subscription_id').eq('owner_user_id', user.id).maybeSingle()
  if (!family?.stripe_subscription_id) return response.status(400).json({ error: 'No active subscription was found.' })
  await stripe.subscriptions.cancel(family.stripe_subscription_id)
  await supabase.from('parent_families').update({ membership_status: 'cancelled', updated_at: new Date().toISOString() }).eq('owner_user_id', user.id)
  await supabase.from('students').update({ membership_status: 'cancelled' }).eq('family_id', family.id)
  response.json({ cancelled: true })
})

// Admin subscription management from the Operations > Sales > Subscriptions table.
// Actions: pause (void collection), resume, cancel — all applied to the real Stripe
// subscription first, then mirrored onto parent_families.
app.post('/api/admin/subscriptions/:familyId/:action', async (request, response) => {
  if (!stripe || !supabase) return response.status(503).json({ error: 'Billing is not configured on the server.' })
  const { action, familyId } = request.params
  if (!['pause', 'resume', 'cancel'].includes(action)) return response.status(400).json({ error: 'Unknown subscription action.' })
  const user = await authenticatedUser(request)
  if (!user) return response.status(401).json({ error: 'Authentication is required.' })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return response.status(403).json({ error: 'Only admins can manage subscriptions.' })
  const { data: family } = await supabase.from('parent_families').select('*').eq('id', familyId).maybeSingle()
  if (!family) return response.status(404).json({ error: 'Family not found.' })
  if (!family.stripe_subscription_id) return response.status(400).json({ error: 'This family has no Stripe subscription. Use the status menu to update it manually.' })

  try {
    const update = { updated_at: new Date().toISOString() }
    if (action === 'pause') {
      await stripe.subscriptions.update(family.stripe_subscription_id, { pause_collection: { behavior: 'void' } })
      update.paused_at = new Date().toISOString()
    } else if (action === 'resume') {
      await stripe.subscriptions.update(family.stripe_subscription_id, { pause_collection: '' })
      update.paused_at = null
    } else {
      await stripe.subscriptions.cancel(family.stripe_subscription_id)
      update.membership_status = 'cancelled'
      update.paused_at = null
    }
    const { data, error } = await supabase.from('parent_families').update(update).eq('id', familyId).select().single()
    if (error) return response.status(500).json({ error: 'Stripe was updated, but the family record could not be saved.' })
    if (action === 'cancel') await supabase.from('students').update({ membership_status: 'cancelled' }).eq('family_id', familyId)
    response.json({ family: data })
  } catch (error) {
    response.status(502).json({ error: error.message || 'Stripe could not apply the subscription action.' })
  }
})

// Admin "reset test data" — deliberately two-step. POST {} returns a preview of
// exactly which records would be deleted; only POST { confirm: 'DELETE' } actually
// deletes. Clears class bookings, students, parent families, and event ticket
// orders. Site content (events, schools, instructors, class schedule, messages)
// is untouched, and no Stripe objects are modified — refunds are handled
// separately in the Stripe dashboard.
app.post('/api/admin/reset-test-data', async (request, response) => {
  // This endpoint deletes real customer records (bookings, students, families,
  // ticket orders) — it must be explicitly enabled per environment.
  if (process.env.ALLOW_TEST_DATA_RESET !== 'true') return response.status(403).json({ error: 'Test data reset is disabled on this server. Set ALLOW_TEST_DATA_RESET=true to enable it temporarily.' })
  if (!supabase) return response.status(503).json({ error: 'Supabase server storage is not configured.' })
  const user = await authenticatedUser(request)
  if (!user) return response.status(401).json({ error: 'Authentication is required.' })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return response.status(403).json({ error: 'Only admins can reset test data.' })

  const [students, bookings, families, ticketOrders] = await Promise.all([
    supabase.from('students').select('id,name,parent_email,class_name,membership_status'),
    supabase.from('bookings').select('id,contact_name,contact_email,date,session_type,price,status,payment_status,stripe_checkout_session_id'),
    supabase.from('parent_families').select('id,guardian_name,guardian_email,plan_type,membership_status,stripe_subscription_id'),
    supabase.from('event_ticket_orders').select('id,buyer_name,buyer_email,tier_name,tickets,total_pence,payment_status'),
  ])
  const firstError = [students, bookings, families, ticketOrders].find((result) => result.error)
  if (firstError) return response.status(500).json({ error: `Records could not be listed: ${firstError.error.message}` })

  const preview = {
    students: students.data || [],
    bookings: bookings.data || [],
    parentFamilies: families.data || [],
    eventTicketOrders: ticketOrders.data || [],
  }
  const counts = Object.fromEntries(Object.entries(preview).map(([key, rows]) => [key, rows.length]))

  // Default pass is a dry run — nothing is deleted without explicit confirmation.
  if (request.body?.confirm !== 'DELETE') return response.json({ dryRun: true, counts, preview })

  // FK-safe order: students first (their family_id is plain text), then bookings
  // (cascades booking-linked students + job_board_jobs), then the standalone tables.
  const deletions = [
    ['students', await supabase.from('students').delete().neq('id', '')],
    ['bookings', await supabase.from('bookings').delete().neq('id', '')],
    ['parent_families', await supabase.from('parent_families').delete().neq('id', '')],
    ['event_ticket_orders', await supabase.from('event_ticket_orders').delete().neq('id', '')],
  ]
  const failed = deletions.find(([, result]) => result.error)
  if (failed) return response.status(500).json({ error: `Reset failed while deleting ${failed[0]}: ${failed[1].error.message}` })
  response.json({ dryRun: false, deleted: counts })
})

app.post('/api/parent/cancel-booking', async (request, response) => {
  const user = await authenticatedUser(request)
  if (!user || !supabase) return response.status(401).json({ error: 'Authentication is required.' })
  const { bookingId } = request.body || {}
  // Legacy guest-checkout families have no owner_user_id — match by guardian email
  // too, mirroring /api/parent/dashboard, so parents can cancel what they can see.
  const { data: ownedFamilies } = await supabase.from('parent_families').select('id').or(`owner_user_id.eq.${user.id},guardian_email.eq.${user.email}`)
  const familyIds = (ownedFamilies || []).map((family) => family.id)
  if (!familyIds.length) return response.status(404).json({ error: 'Booking not found for this parent.' })
  const { data: booking } = await supabase.from('bookings').select('id').eq('id', bookingId).in('family_id', familyIds).maybeSingle()
  if (!booking) return response.status(404).json({ error: 'Booking not found for this parent.' })
  const { error } = await supabase.from('bookings').update({ status: 'Cancelled' }).eq('id', bookingId)
  if (error) return response.status(500).json({ error: 'Booking could not be cancelled.' })
  response.json({ cancelled: true })
})

/* ------------------------------------------------------------------ */
/* Reminder scheduler — emails buyers 24h before their event with an   */
/* .ics calendar attachment. Runs while the server is up.              */
/* ------------------------------------------------------------------ */
async function sendDueReminders() {
  if (!supabase) return { checked: 0, sent: 0 }
  const now = Date.now()
  const { data: orders, error } = await supabase
    .from('event_ticket_orders')
    .select('*, events(*)')
    .eq('payment_status', 'paid')
    .is('reminder_sent_at', null)
  if (error) { console.error('Reminder query failed:', error); return { checked: 0, sent: 0, error: error.message } }

  let sent = 0
  for (const order of orders || []) {
    const eventRow = order.events
    if (!eventRow?.event_date) continue
    const eventStart = new Date(`${eventRow.event_date}T${(eventRow.event_time || '00:00').slice(0, 5)}:00`).getTime()
    const hoursUntil = (eventStart - now) / 3600000
    // Send when within the 24h window (and the event hasn't already started/passed by >2h).
    if (hoursUntil > 24 || hoursUntil < -2) continue
    const result = await sendEmail({
      to: order.buyer_email,
      subject: `Reminder: ${eventRow.title} is tomorrow`,
          html: `<div style="font-family:Arial,sans-serif;color:#232323;line-height:1.6"><h1 style="color:#0b3d2e">King's Ark Dance Academy</h1><h2>See you soon! ⏰</h2><p>Hi ${(order.buyer_name || 'there').split(' ')[0]},</p><p>This is a reminder that <strong>${eventRow.title}</strong> is coming up.</p><p><strong>Date:</strong> ${formatDateGB(eventRow.event_date)}${eventRow.event_time ? ` · ${eventRow.event_time.slice(0, 5)}` : ''}${eventRow.event_end_time ? ` – ${eventRow.event_end_time.slice(0, 5)}` : ''}<br><strong>Venue:</strong> ${eventRow.location || 'To be confirmed'}<br><strong>Your tickets:</strong> ${order.tier_name} × ${order.tickets}</p><p>Add it to your calendar so you don't miss it. The attachment drops straight in.</p><p>See you there!</p></div>`,
      attachments: [{ filename: 'event.ics', content: Buffer.from(buildIcs({ title: eventRow.title, date: eventRow.event_date, startTime: eventRow.event_time, endTime: eventRow.event_end_time, location: eventRow.location, description: eventRow.description, url: `${PUBLIC_BASE_URL}#event/${order.event_id}` })).toString('base64') }],
    })
    if (result.sent || !process.env.RESEND_API_KEY) {
      await supabase.from('event_ticket_orders').update({ reminder_sent_at: new Date().toISOString() }).eq('id', order.id)
      if (result.sent) sent += 1
    }
  }
  return { checked: (orders || []).length, sent }
}

// Manual trigger for testing / admin.
app.post('/api/admin/send-event-reminders', async (request, response) => {
  const user = await authenticatedUser(request)
  if (!user || !supabase) return response.status(401).json({ error: 'Authentication is required.' })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return response.status(403).json({ error: 'Only admins can trigger reminders.' })
  const result = await sendDueReminders()
  response.json(result)
})

const REMINDER_INTERVAL_MS = Number(process.env.REMINDER_INTERVAL_MS || 60000)
setInterval(() => { sendDueReminders().catch((error) => console.error('Reminder scheduler error:', error)) }, REMINDER_INTERVAL_MS)

/* ------------------------------------------------------------------ */
/* Production: serve the built Vite app (dist/) and fall back to        */
/* index.html for any non-API route so the React hash/SPA router works.  */
/* Placed after the webhook (raw body) and all /api routes.              */
/* ------------------------------------------------------------------ */
const distPath = path.resolve(process.cwd(), 'dist')
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath))
  // SPA fallback: any GET that isn't an API route and doesn't map to a real file
  // returns index.html so the React hash/SPA router can take over.
  app.use((request, response, next) => {
    if (request.method !== 'GET' || request.path.startsWith('/api/')) return next()
    response.sendFile(path.join(distPath, 'index.html'))
  })
  console.log('Serving built frontend from dist/')
} else {
  console.log('dist/ not found — API-only mode (run npm run build to serve the frontend)')
}

app.listen(port, '0.0.0.0', () => console.log(`KADA server listening on port ${port}`))
