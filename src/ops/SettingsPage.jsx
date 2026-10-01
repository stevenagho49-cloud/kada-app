import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { AddressAutocomplete } from '../lib/AddressAutocomplete'
import { ImageField, OpsButton, OPS_COLORS, opsInputStyle } from './ui'

/* ------------------------------------------------------------------ */
/* Operations > Administration > Settings ,  everything the business    */
/* can change without touching code:                                   */
/*   Business profile  → site_content 'contact' (public site + invoices) */
/*   Branding          → site_content 'branding' (header logo override)  */
/*   Social links      → site_content 'social' (website footer)          */
/*   Notifications     → app_settings 'notifications' (admin-only; the   */
/*                        server reads this to route alert emails)       */
/*   Integrations      → email auto-capture webhook setup guide          */
/* ------------------------------------------------------------------ */

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, marginBottom: 4 }
const sectionStyle = { border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 10, padding: 16, background: OPS_COLORS.ivory, marginBottom: 14 }

function TextField({ label, value, onChange, type = 'text', placeholder = '' }) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <span style={labelStyle}>{label}</span>
      <input type={type} style={opsInputStyle} value={value || ''} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13.5, color: OPS_COLORS.ink, marginBottom: 8, cursor: 'pointer' }}>
      <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} style={{ marginTop: 3 }} />
      <span>{label}{hint && <span style={{ display: 'block', fontSize: 12, color: OPS_COLORS.muted }}>{hint}</span>}</span>
    </label>
  )
}

function Section({ title, description, onSave, saving, dirty, children }) {
  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
        <h4 style={{ margin: 0, fontSize: 15, color: OPS_COLORS.emerald }}>{title}</h4>
        {onSave && <OpsButton small disabled={!dirty || saving} onClick={onSave}>{saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</OpsButton>}
      </div>
      {description && <p style={{ margin: '0 0 12px', fontSize: 12.5, color: OPS_COLORS.muted }}>{description}</p>}
      {children}
    </div>
  )
}

export function SettingsPage({ content, onSaveContent, session }) {
  // site_content-backed drafts (public website reads these)
  const [contact, setContact] = useState({ email: '', phone: '', address: '', ...(content.contact || {}) })
  const [branding, setBranding] = useState({ logoUrl: '', ...(content.branding || {}) })
  const [social, setSocial] = useState({ instagram: '', tiktok: '', youtube: '', facebook: '', ...(content.social || {}) })
  const [dirty, setDirty] = useState({})
  const [savingKey, setSavingKey] = useState('')

  // app_settings-backed notifications (admin-only, read by the server)
  const [notifications, setNotifications] = useState({ notifyEmail: '', newBooking: true, newContact: true, jobAlerts: true, eventSales: true, paymentLinkSales: true, invoicePayments: true, newSignups: true })
  const [notificationsLoaded, setNotificationsLoaded] = useState(false)

  useEffect(() => {
    let mounted = true
    supabase.from('app_settings').select('key,value').eq('key', 'notifications').maybeSingle().then(({ data, error }) => {
      if (mounted && !error) {
        if (data) setNotifications((current) => ({ ...current, ...data.value }))
        setNotificationsLoaded(true)
      }
    })
    return () => { mounted = false }
  }, [])

  const saveContent = async (key, value) => {
    setSavingKey(key)
    await onSaveContent(key, value)
    setSavingKey('')
    setDirty((current) => ({ ...current, [key]: false }))
  }

  const saveNotifications = async () => {
    setSavingKey('notifications')
    await supabase.from('app_settings').upsert({ key: 'notifications', value: notifications, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    setSavingKey('')
    setDirty((current) => ({ ...current, notifications: false }))
  }

  const editNotifications = (changes) => {
    setNotifications((current) => ({ ...current, ...changes }))
    setDirty((current) => ({ ...current, notifications: true }))
  }

  return (
    <div className="panel">
      <div className="panel-head"><h3>Settings</h3></div>
      <p style={{ color: OPS_COLORS.muted, fontSize: 13, margin: '0 0 16px' }}>
        Business-wide settings you can change yourself ,  no developer needed. Each section saves independently and goes live straight away.
      </p>

      <Section
        title="Business profile"
        description="Your public contact details. Used in the website Contact section, the footer of invoices, and reply-to details on emails."
        dirty={dirty.contact}
        saving={savingKey === 'contact'}
        onSave={() => saveContent('contact', contact)}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <TextField label="Bookings email" type="email" value={contact.email} onChange={(value) => { setContact({ ...contact, email: value }); setDirty((c) => ({ ...c, contact: true })) }} />
          <TextField label="Phone" value={contact.phone} onChange={(value) => { setContact({ ...contact, phone: value }); setDirty((c) => ({ ...c, contact: true })) }} />
        </div>
        <div style={{ marginBottom: 10 }}>
          <span style={labelStyle}>Address</span>
          <AddressAutocomplete
            style={opsInputStyle}
            value={contact.address}
            placeholder="Postcode or street, pick the full address"
            onChange={(value) => { setContact({ ...contact, address: value }); setDirty((c) => ({ ...c, contact: true })) }}
            onSelect={(result) => { setContact((current) => ({ ...current, address: result.label })); setDirty((c) => ({ ...c, contact: true })) }}
          />
        </div>
      </Section>

      <Section
        title="Notifications"
        description="Where admin alert emails go (new bookings, event ticket sales, website messages, job claims). Leave the email blank to use the server default. Alert types can be switched off individually."
        dirty={dirty.notifications}
        saving={savingKey === 'notifications'}
        onSave={saveNotifications}
      >
        <TextField label="Send admin alerts to" type="email" placeholder="bookings@kingsarkdance.com" value={notifications.notifyEmail} onChange={(value) => editNotifications({ notifyEmail: value })} />
        {notificationsLoaded && (
          <>
            <Toggle label="New booking / enquiry alerts" checked={notifications.newBooking} onChange={(value) => editNotifications({ newBooking: value })} />
            <Toggle label="Event ticket sales" checked={notifications.eventSales} onChange={(value) => editNotifications({ eventSales: value })} />
            <Toggle label="Payment link payments" checked={notifications.paymentLinkSales} onChange={(value) => editNotifications({ paymentLinkSales: value })} />
            <Toggle label="Invoices paid online" checked={notifications.invoicePayments} onChange={(value) => editNotifications({ invoicePayments: value })} />
            <Toggle label="Website contact form messages" checked={notifications.newContact} onChange={(value) => editNotifications({ newContact: value })} />
            <Toggle label="New sign-ups" hint="Parents, instructors and schools creating an account on the website" checked={notifications.newSignups} onChange={(value) => editNotifications({ newSignups: value })} />
            <Toggle label="Job board & DBS alerts" hint="Job claims, accepted jobs, sessions marked done and DBS certificate uploads" checked={notifications.jobAlerts} onChange={(value) => editNotifications({ jobAlerts: value })} />
          </>
        )}
      </Section>

      {session && <DiscountCodesSection session={session} />}

      <Section
        title="Branding"
        description="Upload your logo once ,  it replaces the logo in the site header, browser tab icon, ticket and legal pages, all at once. Use a PNG with a transparent background for the cleanest result."
        dirty={dirty.branding}
        saving={savingKey === 'branding'}
        onSave={() => saveContent('branding', branding)}
      >
        <ImageField
          label="Site logo"
          shape="logo"
          value={branding.logoUrl}
          defaultSrc="/images/logo-mark.png"
          hint="Upload from your photos or files. 'Reset to default' brings back the built-in KADA mark."
          onChange={(dataUrl) => { setBranding({ ...branding, logoUrl: dataUrl }); setDirty((c) => ({ ...c, branding: true })) }}
        />
      </Section>

      <Section
        title="Social links"
        description="Shown in the website footer. Leave a link blank to hide it."
        dirty={dirty.social}
        saving={savingKey === 'social'}
        onSave={() => saveContent('social', social)}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <TextField label="Instagram" placeholder="https://www.instagram.com/…" value={social.instagram} onChange={(value) => { setSocial({ ...social, instagram: value }); setDirty((c) => ({ ...c, social: true })) }} />
          <TextField label="TikTok" placeholder="https://www.tiktok.com/@…" value={social.tiktok} onChange={(value) => { setSocial({ ...social, tiktok: value }); setDirty((c) => ({ ...c, social: true })) }} />
          <TextField label="YouTube" placeholder="https://www.youtube.com/…" value={social.youtube} onChange={(value) => { setSocial({ ...social, youtube: value }); setDirty((c) => ({ ...c, social: true })) }} />
          <TextField label="Facebook" placeholder="https://www.facebook.com/…" value={social.facebook} onChange={(value) => { setSocial({ ...social, facebook: value }); setDirty((c) => ({ ...c, social: true })) }} />
        </div>
      </Section>

      <Section title="Email → Contacts (automatic capture)">
        <p style={{ fontSize: 13, color: OPS_COLORS.ink, margin: '0 0 8px' }}>
          Emails can file themselves into Operations → Contacts. Point any inbound-email service at this webhook:
        </p>
        <code style={{ display: 'block', background: OPS_COLORS.emerald, color: OPS_COLORS.ivory, borderRadius: 6, padding: '8px 12px', fontSize: 12.5, marginBottom: 10, wordBreak: 'break-all' }}>
          POST https://kingsarkdance.com/api/inbound-email?token=YOUR_SECRET
        </code>
        <ol style={{ fontSize: 13, color: OPS_COLORS.ink, margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Ask whoever manages your email (or your developer) to set <strong>INBOUND_EMAIL_SECRET</strong> on the server ,  any long random word.</li>
          <li>Google Workspace: Gmail routing rule → forward enquiries to a SendGrid/Mailgun inbound-parse address → webhook URL above. Microsoft 365: a Power Automate flow ("When a new email arrives" → HTTP POST) does the same job.</li>
          <li>The sender is matched by email and added/updated automatically ,  never duplicated.</li>
          <li>Until that is wired up, use <strong>Contacts → Add from email</strong>: paste any email and it is filed in seconds.</li>
        </ol>
      </Section>

      <Section title="More places to look">
        <ul style={{ fontSize: 13, color: OPS_COLORS.ink, margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
          <li><strong>Bank details for invoices</strong> ,  Sales → Invoice settings</li>
          <li><strong>Homepage wording, prices, team photos</strong> ,  Site → Site content</li>
          <li><strong>Homepage section order & visibility</strong> ,  Site → Homepage layout</li>
          <li><strong>Staff logins & permissions</strong> ,  Administration → Team & access</li>
          <li><strong>Old spreadsheet data</strong> ,  Operations → Contacts → Import Excel / CSV</li>
        </ul>
      </Section>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Discount codes. Stored server-side (app_settings 'discount_codes',   */
/* admin-only) and checked again at every checkout. A code works on     */
/* any mix of class bookings, school bookings and event tickets, takes  */
/* a percentage or a fixed £ amount off, and can be switched off        */
/* without deleting it.                                                 */
/* ------------------------------------------------------------------ */
const DISCOUNT_SCOPES = [
  { key: 'class', label: 'Parent class bookings' },
  { key: 'school', label: 'School bookings (taken off the invoice)' },
  { key: 'event', label: 'Event tickets' },
]
const emptyDiscount = { id: '', code: '', description: '', appliesTo: ['class'], type: 'percent', value: '', membershipDuration: 'once', active: true }
const describeDiscount = (code) => (code.type === 'percent' ? `${code.percentOff}% off` : `£${(code.amountOffPence / 100).toFixed(2)} off`)

function DiscountCodesSection({ session }) {
  const [codes, setCodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const request = async (method, body) => {
    const response = await fetch('/api/admin/discount-codes', { method, headers: { Authorization: `Bearer ${session.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || 'Request failed.')
    return result
  }

  useEffect(() => {
    let mounted = true
    request('GET').then((result) => { if (mounted) setCodes(result.codes || []) }).catch((loadError) => { if (mounted) setError(loadError.message) }).finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = async (draft) => {
    setSaving(true)
    setError('')
    try {
      const result = await request('POST', { ...draft, id: draft.id || undefined, value: Number(draft.value) })
      setCodes(result.codes)
      setEditing(null)
    } catch (saveError) {
      setError(saveError.message)
    }
    setSaving(false)
  }

  const toggleActive = async (code) => {
    setError('')
    try {
      const result = await request('POST', { id: code.id, active: !code.active })
      setCodes(result.codes)
    } catch (saveError) {
      setError(saveError.message)
    }
  }

  const startEdit = (code) => setEditing({ id: code.id, code: code.code, description: code.description || '', appliesTo: code.appliesTo, type: code.type, value: String(code.type === 'percent' ? code.percentOff : code.amountOffPence / 100), membershipDuration: code.membershipDuration || 'once', active: code.active })

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
        <h4 style={{ margin: 0, fontSize: 15, color: OPS_COLORS.emerald }}>Discount codes</h4>
        {!editing && <OpsButton small onClick={() => setEditing({ ...emptyDiscount })}>New code</OpsButton>}
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 12.5, color: OPS_COLORS.muted }}>Codes people type at checkout. A 100% code makes the booking free: it is still recorded as a confirmed booking or ticket order, with no card payment. Switching a code off keeps it here for your records.</p>
      {error && <p style={{ color: OPS_COLORS.warn, fontSize: 13, margin: '0 0 10px' }}>{error}</p>}
      {editing && <DiscountCodeForm draft={editing} saving={saving} onChange={setEditing} onSave={() => save(editing)} onCancel={() => { setEditing(null); setError('') }} />}
      {loading ? <p style={{ color: OPS_COLORS.muted, fontSize: 13 }}>Loading…</p> : codes.length === 0 ? <p style={{ color: OPS_COLORS.muted, fontSize: 13, margin: 0 }}>No discount codes yet.</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="ops-table">
            <thead><tr><th>Code</th><th>Discount</th><th>Works on</th><th>Status</th><th /></tr></thead>
            <tbody>
              {codes.map((code) => (
                <tr key={code.id} style={{ opacity: code.active ? 1 : 0.6 }}>
                  <td><strong style={{ letterSpacing: '0.04em' }}>{code.code}</strong>{code.description && <div style={{ fontSize: 12, color: OPS_COLORS.muted }}>{code.description}</div>}</td>
                  <td style={{ fontSize: 13 }}>{describeDiscount(code)}{code.appliesTo.includes('class') && <div style={{ fontSize: 11.5, color: OPS_COLORS.muted }}>Memberships: {code.membershipDuration === 'forever' ? 'every month' : 'first month'}</div>}</td>
                  <td style={{ fontSize: 12.5 }}>{code.appliesTo.map((scope) => DISCOUNT_SCOPES.find((item) => item.key === scope)?.label.replace(/ \(.*\)$/, '')).join(', ')}</td>
                  <td><span style={{ fontSize: 12, fontWeight: 700, color: code.active ? '#2e6b47' : OPS_COLORS.muted }}>{code.active ? 'Active' : 'Off'}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}><OpsButton small variant="ghost" onClick={() => startEdit(code)}>Edit</OpsButton> <OpsButton small variant="ghost" onClick={() => toggleActive(code)}>{code.active ? 'Switch off' : 'Switch on'}</OpsButton></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function DiscountCodeForm({ draft, saving, onChange, onSave, onCancel }) {
  const set = (changes) => onChange({ ...draft, ...changes })
  const toggleScope = (key) => set({ appliesTo: draft.appliesTo.includes(key) ? draft.appliesTo.filter((item) => item !== key) : [...draft.appliesTo, key] })
  const value = Number(draft.value)
  const valid = /^[A-Za-z0-9_-]{3,30}$/.test(draft.code.trim()) && draft.appliesTo.length > 0 && draft.value !== '' && Number.isFinite(value) && (draft.type === 'percent' ? value >= 0 && value <= 100 : value > 0)
  return (
    <div style={{ border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 8, padding: 14, marginBottom: 14, background: '#fffdf8' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        <label style={{ display: 'block' }}><span style={labelStyle}>Code</span><input style={{ ...opsInputStyle, textTransform: 'uppercase' }} value={draft.code} placeholder="FAMILY10" onChange={(event) => set({ code: event.target.value.replace(/\s+/g, '') })} /></label>
        <label style={{ display: 'block' }}><span style={labelStyle}>Note for staff (optional)</span><input style={opsInputStyle} value={draft.description} placeholder="e.g. Siblings discount" onChange={(event) => set({ description: event.target.value })} /></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 10 }}>
        <label style={{ display: 'block' }}><span style={labelStyle}>Discount type</span><select style={opsInputStyle} value={draft.type} onChange={(event) => set({ type: event.target.value })}><option value="percent">Percentage off</option><option value="amount">Fixed amount off (£)</option></select></label>
        <label style={{ display: 'block' }}><span style={labelStyle}>{draft.type === 'percent' ? 'Percentage (0 to 100)' : 'Amount off (£)'}</span><input type="number" min="0" max={draft.type === 'percent' ? 100 : undefined} step="0.01" style={opsInputStyle} value={draft.value} placeholder={draft.type === 'percent' ? '10' : '10.00'} onChange={(event) => set({ value: event.target.value })} /></label>
      </div>
      <div style={{ marginTop: 12 }}>
        <span style={labelStyle}>Works on</span>
        {DISCOUNT_SCOPES.map((scope) => <Toggle key={scope.key} label={scope.label} checked={draft.appliesTo.includes(scope.key)} onChange={() => toggleScope(scope.key)} />)}
      </div>
      {draft.appliesTo.includes('class') && (
        <label style={{ display: 'block', marginTop: 4 }}><span style={labelStyle}>On monthly memberships</span><select style={{ ...opsInputStyle, maxWidth: 320 }} value={draft.membershipDuration} onChange={(event) => set({ membershipDuration: event.target.value })}><option value="once">First month only</option><option value="forever">Every month</option></select></label>
      )}
      <Toggle label="Active (can be used at checkout)" checked={draft.active} onChange={(checked) => set({ active: checked })} />
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <OpsButton small disabled={!valid || saving} onClick={onSave}>{saving ? 'Saving…' : draft.id ? 'Save code' : 'Create code'}</OpsButton>
        <OpsButton small variant="ghost" onClick={onCancel}>Cancel</OpsButton>
      </div>
    </div>
  )
}
