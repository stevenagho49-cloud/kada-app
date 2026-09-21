import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ImageField, OpsButton, OPS_COLORS, opsInputStyle } from './ui'

/* ------------------------------------------------------------------ */
/* Operations > Administration > Settings — everything the business    */
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

export function SettingsPage({ content, onSaveContent }) {
  // site_content-backed drafts (public website reads these)
  const [contact, setContact] = useState({ email: '', phone: '', address: '', ...(content.contact || {}) })
  const [branding, setBranding] = useState({ logoUrl: '', ...(content.branding || {}) })
  const [social, setSocial] = useState({ instagram: '', tiktok: '', youtube: '', facebook: '', ...(content.social || {}) })
  const [dirty, setDirty] = useState({})
  const [savingKey, setSavingKey] = useState('')

  // app_settings-backed notifications (admin-only, read by the server)
  const [notifications, setNotifications] = useState({ notifyEmail: '', newBooking: true, newContact: true, jobAlerts: true })
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
        Business-wide settings you can change yourself — no developer needed. Each section saves independently and goes live straight away.
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
        <TextField label="Address" value={contact.address} onChange={(value) => { setContact({ ...contact, address: value }); setDirty((c) => ({ ...c, contact: true })) }} />
      </Section>

      <Section
        title="Notifications"
        description="Where admin alert emails go (new bookings, website messages, job claims). Leave the email blank to use the server default. Alert types can be switched off individually."
        dirty={dirty.notifications}
        saving={savingKey === 'notifications'}
        onSave={saveNotifications}
      >
        <TextField label="Send admin alerts to" type="email" placeholder="bookings@kingsarkdance.com" value={notifications.notifyEmail} onChange={(value) => editNotifications({ notifyEmail: value })} />
        {notificationsLoaded && (
          <>
            <Toggle label="New booking / enquiry alerts" checked={notifications.newBooking} onChange={(value) => editNotifications({ newBooking: value })} />
            <Toggle label="Website contact form messages" checked={notifications.newContact} onChange={(value) => editNotifications({ newContact: value })} />
            <Toggle label="Job board & DBS alerts" hint="Instructor claims and certificate uploads" checked={notifications.jobAlerts} onChange={(value) => editNotifications({ jobAlerts: value })} />
          </>
        )}
      </Section>

      <Section
        title="Branding"
        description="Upload your logo once — it replaces the logo in the site header, browser tab icon, ticket and legal pages, all at once. Use a PNG with a transparent background for the cleanest result."
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
          <li>Ask whoever manages your email (or your developer) to set <strong>INBOUND_EMAIL_SECRET</strong> on the server — any long random word.</li>
          <li>Google Workspace: Gmail routing rule → forward enquiries to a SendGrid/Mailgun inbound-parse address → webhook URL above. Microsoft 365: a Power Automate flow ("When a new email arrives" → HTTP POST) does the same job.</li>
          <li>The sender is matched by email and added/updated automatically — never duplicated.</li>
          <li>Until that is wired up, use <strong>Contacts → Add from email</strong>: paste any email and it is filed in seconds.</li>
        </ol>
      </Section>

      <Section title="More places to look">
        <ul style={{ fontSize: 13, color: OPS_COLORS.ink, margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
          <li><strong>Bank details for invoices</strong> — Sales → Invoice settings</li>
          <li><strong>Homepage wording, prices, team photos</strong> — Site → Site content</li>
          <li><strong>Homepage section order & visibility</strong> — Site → Homepage layout</li>
          <li><strong>Staff logins & permissions</strong> — Administration → Team & access</li>
          <li><strong>Old spreadsheet data</strong> — Operations → Contacts → Import Excel / CSV</li>
        </ul>
      </Section>
    </div>
  )
}
