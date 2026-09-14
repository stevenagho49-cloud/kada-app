import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import PDFDocument from 'pdfkit'
import fs from 'node:fs'
import path from 'node:path'

const app = express()
const port = Number(process.env.PORT || 4242)
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }))

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
    const planType = metadata.plan_type || 'day_pass'
    const { data: existingStudents } = await supabase.from('students').select('*').eq('booking_id', metadata.booking_id)
    const studentList = existingStudents || []
    const { error: familyError } = await supabase.from('parent_families').upsert({
      id: metadata.family_id,
      guardian_name: metadata.parent_name,
      guardian_email: session.customer_details?.email || metadata.parent_email,
      plan_type: planType,
      membership_status: planType === 'monthly_membership' ? 'active' : 'active',
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
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object
    const membershipStatus = event.type.endsWith('deleted') ? 'cancelled' : ['active', 'trialing'].includes(subscription.status) ? 'active' : 'inactive'
    await supabase.from('parent_families').update({ membership_status: membershipStatus, updated_at: new Date().toISOString() }).eq('stripe_subscription_id', subscription.id)
  }

  response.json({ received: true })
})

app.use(express.json())

app.get('/api/parent/dashboard', async (request, response) => {
  const user = await authenticatedUser(request)
  if (!user || !supabase) return response.status(401).json({ error: 'Authentication is required.' })
  const { data: family, error: familyError } = await supabase.from('parent_families').select('*').or(`owner_user_id.eq.${user.id},guardian_email.eq.${user.email}`).maybeSingle()
  if (familyError) return response.status(500).json({ error: 'Family data could not be loaded.' })
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
  const logoPath = path.resolve(process.cwd(), 'public/images/logo.jpg')
  if (fs.existsSync(logoPath)) document.image(logoPath, margin + 5.67, 42.52, { fit: [45.36, 45.36], align: 'center', valign: 'center' })
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

app.post('/api/stripe/create-checkout-session', async (request, response) => {
  if (!stripe) return response.status(503).json({ error: 'Stripe is not configured on the server.' })

  const { planType, className, classDate, parentName, parentEmail, students } = request.body || {}
  const priceId = planType === 'monthly_membership' ? process.env.STRIPE_MONTHLY_PRICE_ID : process.env.STRIPE_DAY_PASS_PRICE_ID
  if (!priceId || !['monthly_membership', 'day_pass'].includes(planType) || !className || !classDate || !parentName || !parentEmail || !Array.isArray(students) || !students.length || students.some((student) => !student?.name || !student?.dateOfBirth)) {
    return response.status(400).json({ error: 'Plan, class, date, parent details, and at least one complete student record are required.' })
  }

  const bookingId = `parent-${crypto.randomUUID()}`
  const familyId = `family-${crypto.randomUUID()}`
  if (!supabase) return response.status(503).json({ error: 'Supabase server storage is not configured.' })
  const user = await authenticatedUser(request)
  const { error: familyError } = await supabase.from('parent_families').insert({ id: familyId, owner_user_id: user?.id || null, guardian_name: parentName, guardian_email: parentEmail, plan_type: planType, membership_status: 'pending' })
  if (familyError) return response.status(500).json({ error: 'Family record could not be created.' })
  const { error: bookingError } = await supabase.from('bookings').insert({ id: bookingId, family_id: familyId, contact_name: parentName, contact_email: parentEmail, date: classDate, session_type: className, price: planType === 'monthly_membership' ? 25 : 10, student_count: students.length, status: 'Enquiry', invoice_status: 'Not sent', payment_status: 'pending' })
  if (bookingError) return response.status(500).json({ error: 'Booking record could not be created.' })
  const { error: studentsError } = await supabase.from('students').insert(students.map((student, index) => ({ id: `student-${bookingId}-${index + 1}`, booking_id: bookingId, family_id: familyId, parent_name: parentName, parent_email: parentEmail, name: student.name, date_of_birth: student.dateOfBirth, class_name: className, term: classDate, membership_status: 'inactive' })))
  if (studentsError) return response.status(500).json({ error: 'Student records could not be created.' })
  const session = await stripe.checkout.sessions.create({
    mode: planType === 'monthly_membership' ? 'subscription' : 'payment',
    customer_email: parentEmail,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { booking_id: bookingId, family_id: familyId, plan_type: planType, class_name: className, class_date: classDate, amount_pence: planType === 'monthly_membership' ? '2500' : '1000', parent_name: parentName, parent_email: parentEmail },
    success_url: `${process.env.CLIENT_URL || 'http://localhost:5173'}?payment=success&session_id={CHECKOUT_SESSION_ID}#classes`,
    cancel_url: `${process.env.CLIENT_URL || 'http://localhost:5173'}#classes`,
  })

  response.json({ url: session.url })
})

app.post('/api/parent/billing-portal', async (request, response) => {
  if (!stripe || !supabase) return response.status(503).json({ error: 'Billing is not configured on the server.' })
  const user = await authenticatedUser(request)
  if (!user) return response.status(401).json({ error: 'Authentication is required.' })
  const { data: family } = await supabase.from('parent_families').select('stripe_customer_id').eq('owner_user_id', user.id).maybeSingle()
  if (!family?.stripe_customer_id) return response.status(400).json({ error: 'No paid family subscription or customer record was found.' })
  const portal = await stripe.billingPortal.sessions.create({ customer: family.stripe_customer_id, return_url: `${process.env.CLIENT_URL || 'http://localhost:5173'}#parent-dashboard` })
  response.json({ url: portal.url })
})

app.post('/api/parent/cancel-subscription', async (request, response) => {
  if (!stripe || !supabase) return response.status(503).json({ error: 'Billing is not configured on the server.' })
  const user = await authenticatedUser(request)
  if (!user) return response.status(401).json({ error: 'Authentication is required.' })
  const { data: family } = await supabase.from('parent_families').select('stripe_subscription_id').eq('owner_user_id', user.id).maybeSingle()
  if (!family?.stripe_subscription_id) return response.status(400).json({ error: 'No active subscription was found.' })
  await stripe.subscriptions.cancel(family.stripe_subscription_id)
  await supabase.from('parent_families').update({ membership_status: 'cancelled', updated_at: new Date().toISOString() }).eq('owner_user_id', user.id)
  response.json({ cancelled: true })
})

app.post('/api/parent/cancel-booking', async (request, response) => {
  const user = await authenticatedUser(request)
  if (!user || !supabase) return response.status(401).json({ error: 'Authentication is required.' })
  const { bookingId } = request.body || {}
  const { data: booking } = await supabase.from('bookings').select('id').eq('id', bookingId).in('family_id', (await supabase.from('parent_families').select('id').eq('owner_user_id', user.id)).data?.map((family) => family.id) || []).maybeSingle()
  if (!booking) return response.status(404).json({ error: 'Booking not found for this parent.' })
  const { error } = await supabase.from('bookings').update({ status: 'Cancelled' }).eq('id', bookingId)
  if (error) return response.status(500).json({ error: 'Booking could not be cancelled.' })
  response.json({ cancelled: true })
})

app.listen(port, () => console.log(`Stripe checkout server listening on http://localhost:${port}`))
