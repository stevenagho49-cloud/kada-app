import { useState } from 'react'
import { ImageField, OpsButton, OPS_COLORS, opsInputStyle } from './ui'

/* ------------------------------------------------------------------ */
/* Operations > Site > Site content — edit homepage copy, team,        */
/* contact details and prices. Stored as key/jsonb in site_content;    */
/* the public homepage reads the same rows on every visit.             */
/* ------------------------------------------------------------------ */

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, marginBottom: 4 }
const sectionStyle = { border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 10, padding: 16, background: OPS_COLORS.ivory, marginBottom: 14 }

function TextField({ label, value, onChange, textarea = false, type = 'text' }) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <span style={labelStyle}>{label}</span>
      {textarea
        ? <textarea style={{ ...opsInputStyle, minHeight: 74 }} value={value} onChange={(event) => onChange(event.target.value)} />
        : <input type={type} style={opsInputStyle} value={value} onChange={(event) => onChange(event.target.value)} />}
    </label>
  )
}

function ContentSection({ title, description, children, onSave, saving, dirty }) {
  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
        <h4 style={{ margin: 0, fontSize: 15, color: OPS_COLORS.emerald }}>{title}</h4>
        <OpsButton small disabled={!dirty || saving} onClick={onSave}>{saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</OpsButton>
      </div>
      {description && <p style={{ margin: '0 0 12px', fontSize: 12.5, color: OPS_COLORS.muted }}>{description}</p>}
      {children}
    </div>
  )
}

export function SiteContentPage({ content, onSave }) {
  // Local drafts per key; dirty tracking per section so each has its own Save.
  const [drafts, setDrafts] = useState(() => ({ ...content }))
  const [dirty, setDirty] = useState({})
  const [savingKey, setSavingKey] = useState('')

  const edit = (key, changes) => {
    setDrafts((current) => ({ ...current, [key]: { ...current[key], ...changes } }))
    setDirty((current) => ({ ...current, [key]: true }))
  }
  const editTeamMember = (index, changes) => {
    const members = (drafts.team?.members || []).map((member, i) => (i === index ? { ...member, ...changes } : member))
    edit('team', { members })
  }
  const save = async (key) => {
    setSavingKey(key)
    await onSave(key, drafts[key])
    setSavingKey('')
    setDirty((current) => ({ ...current, [key]: false }))
  }

  const d = (key) => drafts[key] || {}

  return (
    <div className="panel">
      <div className="panel-head"><h3>Site content</h3></div>
      <p style={{ color: OPS_COLORS.muted, fontSize: 13, margin: '0 0 16px' }}>
        Edit the words, team members, contact details and prices shown on the public website. Changes go live immediately after saving.
      </p>

      <ContentSection title="Hero" description="The first thing visitors see." dirty={dirty.hero} saving={savingKey === 'hero'} onSave={() => save('hero')}>
        <TextField label="Headline" value={d('hero').title || ''} onChange={(value) => edit('hero', { title: value })} />
        <TextField label="Headline second line" value={d('hero').titleLine2 || ''} onChange={(value) => edit('hero', { titleLine2: value })} />
        <TextField label="Intro sentence" textarea value={d('hero').lede || ''} onChange={(value) => edit('hero', { lede: value })} />
      </ContentSection>

      <ContentSection title="Stats strip" description="The three big numbers under the hero." dirty={dirty.stats} saving={savingKey === 'stats'} onSave={() => save('stats')}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <TextField label="Children empowered" value={d('stats').childrenEmpowered || ''} onChange={(value) => edit('stats', { childrenEmpowered: value })} />
          <TextField label="Schools reached" value={d('stats').schoolsReached || ''} onChange={(value) => edit('stats', { schoolsReached: value })} />
          <TextField label="Years of impact" value={d('stats').yearsImpact || ''} onChange={(value) => edit('stats', { yearsImpact: value })} />
        </div>
      </ContentSection>

      <ContentSection title="About" dirty={dirty.about} saving={savingKey === 'about'} onSave={() => save('about')}>
        <TextField label="Title" value={d('about').title || ''} onChange={(value) => edit('about', { title: value })} />
        <TextField label="Title emphasis (italic part)" value={d('about').titleEmphasis || ''} onChange={(value) => edit('about', { titleEmphasis: value })} />
        <TextField label="First paragraph" textarea value={d('about').paragraph1 || ''} onChange={(value) => edit('about', { paragraph1: value })} />
        <TextField label="Second paragraph" textarea value={d('about').paragraph2 || ''} onChange={(value) => edit('about', { paragraph2: value })} />
        <TextField label="Button label" value={d('about').ctaLabel || ''} onChange={(value) => edit('about', { ctaLabel: value })} />
      </ContentSection>

      <ContentSection title="Workshops section" dirty={dirty.workshops} saving={savingKey === 'workshops'} onSave={() => save('workshops')}>
        <TextField label="Eyebrow" value={d('workshops').eyebrow || ''} onChange={(value) => edit('workshops', { eyebrow: value })} />
        <TextField label="Title" value={d('workshops').title || ''} onChange={(value) => edit('workshops', { title: value })} />
        <TextField label="Body" textarea value={d('workshops').body || ''} onChange={(value) => edit('workshops', { body: value })} />
        <TextField label="Button label" value={d('workshops').ctaLabel || ''} onChange={(value) => edit('workshops', { ctaLabel: value })} />
      </ContentSection>

      <ContentSection title="Classes section" dirty={dirty.classes} saving={savingKey === 'classes'} onSave={() => save('classes')}>
        <TextField label="Eyebrow" value={d('classes').eyebrow || ''} onChange={(value) => edit('classes', { eyebrow: value })} />
        <TextField label="Title" value={d('classes').title || ''} onChange={(value) => edit('classes', { title: value })} />
        <TextField label="Body" textarea value={d('classes').body || ''} onChange={(value) => edit('classes', { body: value })} />
        <TextField label="Button label" value={d('classes').ctaLabel || ''} onChange={(value) => edit('classes', { ctaLabel: value })} />
      </ContentSection>

      <ContentSection title="Team" description="People shown in Meet the team. Upload each person's photo here, add new members, or remove anyone." dirty={dirty.team} saving={savingKey === 'team'} onSave={() => save('team')}>
        <TextField label="Section eyebrow" value={d('team').eyebrow || ''} onChange={(value) => edit('team', { eyebrow: value })} />
        <TextField label="Section title" value={d('team').title || ''} onChange={(value) => edit('team', { title: value })} />
        {(d('team').members || []).map((member, index) => (
          <div key={index} style={{ borderTop: `1px solid ${OPS_COLORS.rule}`, paddingTop: 10, marginTop: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <strong style={{ fontSize: 13, color: OPS_COLORS.emerald }}>Member {index + 1}</strong>
              <button type="button" onClick={() => edit('team', { members: (drafts.team?.members || []).filter((_, i) => i !== index) })} style={{ border: 0, background: 'none', color: OPS_COLORS.warn, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>Remove</button>
            </div>
            <ImageField label="Photo" shape="circle" value={member.photo || ''} hint="Square photos look best." onChange={(dataUrl) => editTeamMember(index, { photo: dataUrl })} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <TextField label="Name" value={member.name || ''} onChange={(value) => editTeamMember(index, { name: value })} />
              <TextField label="Role" value={member.role || ''} onChange={(value) => editTeamMember(index, { role: value })} />
            </div>
          </div>
        ))}
        <OpsButton small variant="ghost" onClick={() => edit('team', { members: [...(drafts.team?.members || []), { name: '', role: '', photo: '' }] })}>+ Add team member</OpsButton>
      </ContentSection>

      <ContentSection title="Homepage photos" description="The big images across the site — hero, about section, and the workshop/class feature blocks. Upload a replacement and it goes live when you save." dirty={dirty.images} saving={savingKey === 'images'} onSave={() => save('images')}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <ImageField label="Hero photo (top of homepage)" value={d('images').hero || ''} defaultSrc="/images/hero-workshop.jpeg" onChange={(dataUrl) => edit('images', { hero: dataUrl })} />
          <ImageField label="Hero accent photo (small overlay)" value={d('images').heroFloat || ''} defaultSrc="/images/nVgB0rjQ.jpeg" onChange={(dataUrl) => edit('images', { heroFloat: dataUrl })} />
          <ImageField label="About section photo" value={d('images').about || ''} defaultSrc="/images/about-kada.jpeg" onChange={(dataUrl) => edit('images', { about: dataUrl })} />
          <ImageField label="Workshops block photo" value={d('images').workshopsBg || ''} defaultSrc="/images/u.dance sunday warm up2.JPG" onChange={(dataUrl) => edit('images', { workshopsBg: dataUrl })} />
          <ImageField label="Classes block photo" value={d('images').classesBg || ''} defaultSrc="/images/u.dance saturday20.JPG" onChange={(dataUrl) => edit('images', { classesBg: dataUrl })} />
        </div>
      </ContentSection>

      <ContentSection title="Contact details" description="Shown in the Contact section, the footer of invoices, and used for reply-to details." dirty={dirty.contact} saving={savingKey === 'contact'} onSave={() => save('contact')}>
        <TextField label="Section title" value={d('contact').heading || ''} onChange={(value) => edit('contact', { heading: value })} />
        <TextField label="Intro" textarea value={d('contact').intro || ''} onChange={(value) => edit('contact', { intro: value })} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <TextField label="Email" value={d('contact').email || ''} onChange={(value) => edit('contact', { email: value })} />
          <TextField label="Phone" value={d('contact').phone || ''} onChange={(value) => edit('contact', { phone: value })} />
        </div>
        <TextField label="Address" value={d('contact').address || ''} onChange={(value) => edit('contact', { address: value })} />
      </ContentSection>

      <ContentSection title="Prices" description="Class plan prices shown on the booking form. The Stripe prices themselves are set in Stripe — these must match what Stripe charges." dirty={dirty.prices} saving={savingKey === 'prices'} onSave={() => save('prices')}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <TextField label="Monthly membership (£)" type="number" value={String((d('prices').membershipPence ?? 2500) / 100)} onChange={(value) => edit('prices', { membershipPence: Math.round(Number(value || 0) * 100) })} />
          <TextField label="Day pass (£)" type="number" value={String((d('prices').dayPassPence ?? 1000) / 100)} onChange={(value) => edit('prices', { dayPassPence: Math.round(Number(value || 0) * 100) })} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <TextField label="Workshop: full day (£)" type="number" value={String(d('prices').workshopFullDayPounds ?? 490)} onChange={(value) => edit('prices', { workshopFullDayPounds: Number(value || 0) })} />
          <TextField label="Workshop: half day (£)" type="number" value={String(d('prices').workshopHalfDayPounds ?? 260)} onChange={(value) => edit('prices', { workshopHalfDayPounds: Number(value || 0) })} />
          <TextField label="Workshop: single (£)" type="number" value={String(d('prices').workshopSinglePounds ?? 150)} onChange={(value) => edit('prices', { workshopSinglePounds: Number(value || 0) })} />
        </div>
      </ContentSection>
    </div>
  )
}

export default SiteContentPage
