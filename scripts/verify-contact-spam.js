// Verifies the website contact form's spam protection against a local server.
// Start the server with Cloudflare's always-pass Turnstile test secret:
//   TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA node server/index.js
// then: node scripts/verify-contact-spam.js
// The contact limiter allows 5 posts per hour per IP, so restart the server
// before each run. The normal message really is emailed to the admin inbox and
// filed in Contacts; the script deletes the Contacts row and held rows after.
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:4242'
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const stamp = Date.now()
const realEmail = `verify-contact-real-${stamp}@example.com`
const botEmail = `verify-contact-bot-${stamp}@example.com`
const PASS_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX' // accepted by Cloudflare's test secret
let failures = 0
const tempUsers = []
const createdRescue = []

const check = (label, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}
const post = async (body) => {
  const response = await fetch(`${BASE}/api/public/contact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: response.status, body: await response.json().catch(() => ({})) }
}
const base = { topic: 'parent', elapsedMs: 25000, turnstileToken: PASS_TOKEN, website: '' }
const realMessage = { ...base, name: 'Sarah McDonald', email: realEmail, message: `Hi, my daughter is 7 and would love to join the Saturday classes. Is there space in the 10am group? Thanks! (verify ${stamp})` }
const botMessage = { ...base, name: 'VcQjJpRpXbOnYzEw', email: botEmail, message: 'aMhTzKnKbWfQyGwIqLxOnXcG' }

try {
  let result = await post({ ...botMessage, website: 'http://spam.example' })
  check('Honeypot filled: looks sent, silently dropped', result.status === 200 && result.body.sent === true, `HTTP ${result.status}`)

  result = await post({ ...realMessage, elapsedMs: 1200 })
  check('Sent 1.2 s after load: rejected', result.status === 400, `HTTP ${result.status}: ${result.body.error}`)

  result = await post({ ...realMessage, turnstileToken: '' })
  check('No Turnstile token: rejected', result.status === 400, `HTTP ${result.status}: ${result.body.error}`)

  result = await post(botMessage)
  check('Bot-style message: looks sent to the bot', result.status === 200 && result.body.sent === true, `HTTP ${result.status}`)
  const { data: held, error: heldError } = await supabase.from('held_contact_messages').select('*').eq('email', botEmail)
  check('Bot-style message: in the held list', !heldError && held?.length === 1, heldError?.message || `reasons: ${held?.[0]?.reasons?.join('; ')}`)

  result = await post(realMessage)
  check('Normal message: sent', result.status === 200 && result.body.sent === true, `HTTP ${result.status}`)
  const { data: realHeld } = await supabase.from('held_contact_messages').select('id').eq('email', realEmail)
  check('Normal message: not held', !realHeld?.length)

  result = await post(realMessage)
  check('6th post this hour from one IP: rate limited', result.status === 429, `HTTP ${result.status}`)

  // Give the async Contacts filing a moment, then look for it and the email.
  await new Promise((resolve) => { setTimeout(resolve, 3000) })
  const { data: contact } = await supabase.from('contacts').select('id,kind,source,notes').eq('email', realEmail).maybeSingle()
  check('Normal message: filed in Contacts', contact?.source === 'website' && contact?.kind === 'parent', contact ? `${contact.kind}, ${contact.source}` : 'missing')
  const { data: botContact } = await supabase.from('contacts').select('id').eq('email', botEmail).maybeSingle()
  check('Bot-style message: not filed in Contacts', !botContact)

  const list = await (await fetch('https://api.resend.com/emails?limit=20', { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } })).json()
  const recent = (list.data || []).filter((email) => email.subject?.startsWith('[KADA] Website contact'))
  const bodies = await Promise.all(recent.map(async (email) => (await (await fetch(`https://api.resend.com/emails/${email.id}`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } })).json())))
  const realEmails = bodies.filter((email) => email.html?.includes(realEmail))
  const botEmails = bodies.filter((email) => email.html?.includes(botEmail))
  check('Normal message: exactly one admin email', realEmails.length === 1, realEmails.map((email) => `"${email.subject}" to ${email.to}`).join(', '))
  check('Bot messages: no admin email', botEmails.length === 0, `${botEmails.length} found`)

  // Held list in Operations > Contacts: staff need the contacts permission.
  const staff = async (label, permissions) => {
    const email = `verify-held-${label}-${stamp}@example.com`
    const password = `Verify-${stamp}-${label}!x`
    const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: 'staff', full_name: `Verify Held ${label}` }, app_metadata: { signup_notified_at: new Date().toISOString() } })
    if (error) throw error
    tempUsers.push(data.user.id)
    await supabase.from('profiles').update({ role: 'staff', permissions }).eq('id', data.user.id)
    const client = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    const { data: signIn } = await client.auth.signInWithPassword({ email, password })
    return signIn.session.access_token
  }
  const api = async (token, path, method = 'GET') => {
    const response = await fetch(`${BASE}/api/admin/held-messages${path}`, { method, headers: { Authorization: `Bearer ${token}` } })
    return { status: response.status, body: await response.json().catch(() => ({})) }
  }
  const withContacts = await staff('contacts', ['contacts'])
  const withoutContacts = await staff('bookings', ['bookings'])
  const rescueEmail = `verify-contact-rescue-${stamp}@example.com`
  const { data: rescue } = await supabase.from('held_contact_messages').insert({ name: 'Aoife Ni Bhriain', email: rescueEmail, topic: 'school', message: `Real message wrongly held (verify ${stamp})`, reasons: ['test'] }).select('id').single()
  const { data: junk } = await supabase.from('held_contact_messages').insert({ name: 'XkQwPzLm', email: botEmail, topic: 'other', message: 'hEoSjDkSlXqWpZmAnBvC', reasons: ['test'] }).select('id').single()

  check('Held list: staff without contacts permission refused', (await api(withoutContacts, '')).status === 403)
  const listed = await api(withContacts, '')
  check('Held list: staff with contacts permission see held messages', listed.body.messages?.some((message) => message.id === rescue.id))
  const released = await api(withContacts, `/${rescue.id}/release`, 'POST')
  check('Not spam, send it on: sent', released.status === 200, `HTTP ${released.status} ${released.body.error || ''}`)
  const { data: stillHeld } = await supabase.from('held_contact_messages').select('id').eq('id', rescue.id)
  check('Not spam, send it on: removed from the held list', !stillHeld?.length)
  const deleted = await api(withContacts, `/${junk.id}`, 'DELETE')
  const { data: junkLeft } = await supabase.from('held_contact_messages').select('id').eq('id', junk.id)
  check('Delete: removed', deleted.status === 200 && !junkLeft?.length)
  await new Promise((resolve) => { setTimeout(resolve, 3000) })
  const { data: rescued } = await supabase.from('contacts').select('kind,source').eq('email', rescueEmail).maybeSingle()
  check('Released message: filed in Contacts', rescued?.source === 'website' && rescued?.kind === 'school', rescued ? `${rescued.kind}, ${rescued.source}` : 'missing')
  const latest = await (await fetch('https://api.resend.com/emails?limit=10', { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } })).json()
  const rescuedEmails = await Promise.all((latest.data || []).filter((email) => email.subject === '[KADA] Website contact: School').map(async (email) => (await (await fetch(`https://api.resend.com/emails/${email.id}`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } })).json())))
  check('Released message: admin email sent', rescuedEmails.some((email) => email.html?.includes(rescueEmail)))
  createdRescue.push(rescueEmail)
} finally {
  await supabase.from('contacts').delete().in('email', [realEmail, botEmail, ...createdRescue])
  await supabase.from('held_contact_messages').delete().in('email', [realEmail, botEmail, ...createdRescue])
  for (const id of tempUsers) await supabase.auth.admin.deleteUser(id) // eslint-disable-line no-await-in-loop
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
