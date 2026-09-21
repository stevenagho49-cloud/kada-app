import { useEffect, useMemo, useState } from 'react'
import { OpsButton, Pill, OPS_COLORS, opsInputStyle } from './ui'
import { TEMPLATES, TEMPLATE_CATEGORIES } from './emailTemplates'
import { VisualEmailEditor } from './VisualEmailEditor'

/* ------------------------------------------------------------------ */
/* Operations > Marketing > Campaigns ,  design emails from 50 brand    */
/* templates (or AI), pick an audience, send now or schedule one-off / */
/* recurring, and track sent/failed per campaign. Admins only.         */
/* ------------------------------------------------------------------ */

const AUDIENCES = [
  { value: 'all', label: 'Everyone (all contacts)' },
  { value: 'school', label: 'Schools' },
  { value: 'parent', label: 'Parents' },
  { value: 'client', label: 'Clients' },
  { value: 'partner', label: 'Partners' },
  { value: 'other', label: 'Other' },
  { value: 'custom', label: 'One-off email list (type the addresses)' },
]
const RECURRENCE = [
  { value: 'none', label: 'Send once' },
  { value: 'daily', label: 'Repeat daily' },
  { value: 'weekly', label: 'Repeat weekly' },
  { value: 'monthly', label: 'Repeat monthly' },
]
const STATUS_TONES = { draft: 'default', scheduled: 'gold', active: 'green', paused: 'default', done: 'default' }

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, marginBottom: 4 }
const sectionStyle = { border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 10, padding: 16, background: OPS_COLORS.ivory, marginBottom: 14 }

const emptyDraft = { name: '', subject: '', previewText: '', bodyHtml: '', audience: 'all', recurrence: 'none', scheduledAt: '', customEmails: '' }

export function CampaignsPage({ session }) {
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [draft, setDraft] = useState(emptyDraft)
  const [saving, setSaving] = useState(false)
  const [templateCategory, setTemplateCategory] = useState(TEMPLATE_CATEGORIES[0])
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiTone, setAiTone] = useState('warm')
  const [aiBusy, setAiBusy] = useState(false)
  const [preview, setPreview] = useState(false)
  const [previewTemplate, setPreviewTemplate] = useState(null)
  const [analyticsFor, setAnalyticsFor] = useState(null)

  const authedFetch = async (path, options = {}) => {
    const response = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...(options.headers || {}) },
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || 'Request failed.')
    return result
  }

  const load = async () => {
    setLoading(true)
    try {
      const result = await authedFetch('/api/admin/campaigns')
      setCampaigns(result.campaigns || [])
    } catch (loadErr) {
      setError(loadErr.message)
    }
    setLoading(false)
  }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const applyTemplate = (template) => {
    setDraft((current) => ({ ...current, name: template.name, subject: template.subject, bodyHtml: template.body }))
    setNotice(`Template "${template.name}" loaded into the composer below ,  edit it freely.`)
  }

  const designWithAi = async () => {
    if (!aiPrompt.trim()) { setError('Describe the email you want ,  e.g. "Invite schools to book a Black History Month workshop, energetic tone".'); return }
    setAiBusy(true)
    setError('')
    try {
      const designed = await authedFetch('/api/admin/campaigns/ai-design', { method: 'POST', body: JSON.stringify({ prompt: aiPrompt, tone: aiTone }) })
      setDraft((current) => ({ ...current, name: designed.name || current.name, subject: designed.subject || current.subject, previewText: designed.previewText || '', bodyHtml: designed.bodyHtml || current.bodyHtml }))
      setNotice('AI design loaded into the composer ,  review and edit before sending.')
    } catch (aiErr) {
      setError(aiErr.message)
    }
    setAiBusy(false)
  }

  const saveAndSchedule = async (sendNow = false) => {
    if (!draft.name.trim() || !draft.subject.trim() || !draft.bodyHtml.trim()) { setError('Give the campaign a name, subject and body.'); return }
    if (!sendNow && !draft.scheduledAt && draft.recurrence === 'none') { setError('Pick a date/time, choose a repeat, or use "Send now".'); return }
    setSaving(true)
    setError('')
    try {
      const { campaign } = await authedFetch('/api/admin/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name: draft.name.trim(),
          subject: draft.subject.trim(),
          previewText: draft.previewText,
          bodyHtml: draft.bodyHtml,
          audience: draft.audience,
          customEmails: draft.customEmails,
          recurrence: draft.recurrence,
          scheduledAt: draft.scheduledAt ? new Date(draft.scheduledAt).toISOString() : null,
        }),
      })
      if (sendNow) {
        const result = await authedFetch(`/api/admin/campaigns/${campaign.id}/send-now`, { method: 'POST' })
        setNotice(`Campaign sent ,  ${result.sent} email${result.sent === 1 ? '' : 's'} delivered.`)
      } else {
        await authedFetch(`/api/admin/campaigns/${campaign.id}/schedule`, { method: 'POST', body: JSON.stringify({ scheduledAt: draft.scheduledAt, recurrence: draft.recurrence }) })
        setNotice(draft.recurrence === 'none' ? `Scheduled for ${new Date(draft.scheduledAt).toLocaleString('en-GB')}.` : `Scheduled ,  repeats ${draft.recurrence} starting ${new Date(draft.scheduledAt).toLocaleString('en-GB')}.`)
      }
      setDraft(emptyDraft)
      await load()
    } catch (saveErr) {
      setError(saveErr.message)
    }
    setSaving(false)
  }

  const pause = async (campaign) => { await authedFetch(`/api/admin/campaigns/${campaign.id}/pause`, { method: 'POST' }); await load() }
  const remove = async (campaign) => {
    if (!window.confirm(`Delete "${campaign.name}"? Its send history is removed too.`)) return
    await authedFetch(`/api/admin/campaigns/${campaign.id}/delete`, { method: 'POST' })
    await load()
  }

  const templatesInCategory = useMemo(() => TEMPLATES.filter((template) => template.category === templateCategory), [templateCategory])

  return (
    <div className="panel">
      <div className="panel-head"><h3>Email campaigns</h3></div>
      <p style={{ color: OPS_COLORS.muted, fontSize: 13, margin: '0 0 16px' }}>
        Design branded emails from 50 ready-made templates (or let AI draft one), choose an audience from your Contacts,
        and send immediately or schedule one-off / recurring sends. Every recipient gets their own personal email with their name filled in.
      </p>

      {error && <p style={{ color: OPS_COLORS.warn, fontSize: 13 }}>{error}</p>}
      {notice && <p style={{ color: OPS_COLORS.okGreen, fontSize: 13 }}>{notice}</p>}

      <div style={sectionStyle}>
        <h4 style={{ margin: '0 0 10px', fontSize: 15, color: OPS_COLORS.emerald }}>1 · Start from a template ({TEMPLATES.length})</h4>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {TEMPLATE_CATEGORIES.map((category) => (
            <button key={category} type="button" onClick={() => setTemplateCategory(category)} style={{ border: `1px solid ${templateCategory === category ? OPS_COLORS.emerald : OPS_COLORS.rule}`, background: templateCategory === category ? OPS_COLORS.emerald : 'transparent', color: templateCategory === category ? OPS_COLORS.ivory : OPS_COLORS.ink, borderRadius: 20, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>{category}</button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
          {templatesInCategory.map((template) => (
            <div key={template.name} style={{ border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 8, padding: '10px 12px', background: OPS_COLORS.cream }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: OPS_COLORS.emerald }}>{template.name}</div>
              <div style={{ fontSize: 12, color: OPS_COLORS.muted, margin: '2px 0 8px' }}>{template.subject}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <OpsButton small variant="ghost" onClick={() => setPreviewTemplate(template)}>Preview</OpsButton>
                <OpsButton small variant="gold" onClick={() => applyTemplate(template)}>Edit & use</OpsButton>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={sectionStyle}>
        <h4 style={{ margin: '0 0 10px', fontSize: 15, color: OPS_COLORS.emerald }}>2 · …or ask AI to design it</h4>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: 1, minWidth: 240 }}>
            <span style={labelStyle}>Describe the email</span>
            <input style={opsInputStyle} placeholder="e.g. Invite schools to book a Black History Month workshop" value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} />
          </label>
          <label>
            <span style={labelStyle}>Tone</span>
            <select style={opsInputStyle} value={aiTone} onChange={(event) => setAiTone(event.target.value)}>
              {['warm', 'energetic', 'professional', 'urgent', 'celebratory'].map((tone) => <option key={tone} value={tone}>{tone}</option>)}
            </select>
          </label>
          <OpsButton variant="ghost" disabled={aiBusy} onClick={designWithAi}>{aiBusy ? 'Designing…' : '✨ Design with AI'}</OpsButton>
        </div>
        <p style={{ fontSize: 12, color: OPS_COLORS.muted, margin: '8px 0 0' }}>
          Powered by Claude (Anthropic). To enable: get a key at <strong>console.anthropic.com → API Keys</strong>, then in Render open the <strong>kada-app</strong> service → <strong>Environment</strong> → add <code>ANTHROPIC_API_KEY</code> and save (Render redeploys automatically). Until then this button shows "not configured".
        </p>
      </div>

      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
          <h4 style={{ margin: '0 0 10px', fontSize: 15, color: OPS_COLORS.emerald }}>3 · Compose & schedule</h4>
          <OpsButton small variant="ghost" onClick={() => setPreview((current) => !current)}>{preview ? 'Back to editing' : 'Preview'}</OpsButton>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={{ display: 'block' }}><span style={labelStyle}>Campaign name (internal)</span><input style={opsInputStyle} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label style={{ display: 'block' }}><span style={labelStyle}>Audience</span>
            <select style={opsInputStyle} value={draft.audience} onChange={(event) => setDraft({ ...draft, audience: event.target.value })}>
              {AUDIENCES.map((audience) => <option key={audience.value} value={audience.value}>{audience.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'block' }}><span style={labelStyle}>Subject line</span><input style={opsInputStyle} value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} /></label>
          <label style={{ display: 'block' }}><span style={labelStyle}>Inbox preview text</span><input style={opsInputStyle} value={draft.previewText} onChange={(event) => setDraft({ ...draft, previewText: event.target.value })} /></label>
        </div>
        {draft.audience === 'custom' && (
          <label style={{ display: 'block', marginTop: 10 }}>
            <span style={labelStyle}>One-off email list ,  one or many addresses</span>
            <textarea style={{ ...opsInputStyle, minHeight: 90, fontFamily: 'monospace', fontSize: 12.5 }} placeholder={'jane@oakridge.sch.uk\nmrsmith@stmarys.org, temi@kingsarkdance.com'} value={draft.customEmails} onChange={(event) => setDraft({ ...draft, customEmails: event.target.value })} />
            <span style={{ fontSize: 12, color: OPS_COLORS.muted }}>Separate addresses with commas, semicolons or new lines. Anyone already in Contacts is only emailed once.</span>
          </label>
        )}
        <div style={{ marginTop: 10 }}>
          <span style={labelStyle}>Email content ,  edit it like a document ({'{{name}}'} inserts the recipient's name). Use Preview to see the finished email.</span>
          {preview
            ? <div style={{ border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 8, overflow: 'hidden' }} dangerouslySetInnerHTML={{ __html: draft.bodyHtml.replace(/{{name}}/g, 'Sarah') }} />
            : <VisualEmailEditor key={draft.name + draft.subject} value={draft.bodyHtml} onChange={(html) => setDraft((current) => ({ ...current, bodyHtml: html }))} />}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
          <label style={{ display: 'block' }}><span style={labelStyle}>Schedule</span>
            <select style={opsInputStyle} value={draft.recurrence} onChange={(event) => setDraft({ ...draft, recurrence: event.target.value })}>
              {RECURRENCE.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'block' }}><span style={labelStyle}>{draft.recurrence === 'none' ? 'Send on' : 'First send'}</span><input type="datetime-local" style={opsInputStyle} value={draft.scheduledAt} onChange={(event) => setDraft({ ...draft, scheduledAt: event.target.value })} /></label>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <OpsButton disabled={saving} onClick={() => saveAndSchedule(false)}>{saving ? 'Saving…' : draft.recurrence === 'none' ? 'Schedule campaign' : 'Schedule recurring'}</OpsButton>
          <OpsButton variant="gold" disabled={saving} onClick={() => saveAndSchedule(true)}>{saving ? 'Sending…' : 'Send now'}</OpsButton>
        </div>
      </div>

      <div style={sectionStyle}>
        <h4 style={{ margin: '0 0 10px', fontSize: 15, color: OPS_COLORS.emerald }}>Campaigns</h4>
        {loading && <p style={{ color: OPS_COLORS.muted, fontSize: 13 }}>Loading…</p>}
        {!loading && !campaigns.length && <p style={{ color: OPS_COLORS.muted, fontSize: 13 }}>No campaigns yet ,  design your first one above.</p>}
        <div style={{ display: 'grid', gap: 8 }}>
          {campaigns.map((campaign) => (
            <div key={campaign.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderTop: `1px solid ${OPS_COLORS.rule}`, paddingTop: 10 }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <strong>{campaign.name}</strong>
                <div style={{ fontSize: 12, color: OPS_COLORS.muted }}>
                  {AUDIENCES.find((audience) => audience.value === campaign.audience)?.label}{campaign.audience === 'custom' && campaign.custom_emails?.length ? ` (${campaign.custom_emails.length} address${campaign.custom_emails.length === 1 ? '' : 'es'})` : ''} · {RECURRENCE.find((option) => option.value === campaign.recurrence)?.label}
                  {campaign.scheduled_at ? ` · ${new Date(campaign.scheduled_at).toLocaleString('en-GB')}` : ''}
                  {campaign.sentCount ? ` · ${campaign.sentCount} sent` : ''}{campaign.failedCount ? ` · ${campaign.failedCount} failed` : ''}
                </div>
              </div>
              <Pill text={campaign.status} tone={STATUS_TONES[campaign.status]} />
              {campaign.sentCount > 0 && <OpsButton small variant="ghost" onClick={() => setAnalyticsFor(campaign)}>Stats</OpsButton>}
              {(campaign.status === 'scheduled' || campaign.status === 'active') && <OpsButton small variant="ghost" onClick={() => pause(campaign)}>Pause</OpsButton>}
              <OpsButton small variant="danger" onClick={() => remove(campaign)}>Delete</OpsButton>
            </div>
          ))}
        </div>
      </div>

      {analyticsFor && (
        <CampaignAnalytics session={session} campaign={analyticsFor} onClose={() => setAnalyticsFor(null)} />
      )}

      {previewTemplate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(35,35,35,0.55)', zIndex: 60, display: 'grid', placeItems: 'center', padding: 20 }} onClick={(event) => { if (event.target === event.currentTarget) setPreviewTemplate(null) }}>
          <div style={{ background: OPS_COLORS.cream, borderRadius: 12, padding: 22, width: '100%', maxWidth: 640, maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 18px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
              <h3 style={{ margin: 0, fontFamily: "'Iowan Old Style', Georgia, serif", color: OPS_COLORS.emerald, fontWeight: 400 }}>{previewTemplate.name}</h3>
              <span style={{ fontSize: 12, color: OPS_COLORS.muted }}>Subject: {previewTemplate.subject}</span>
            </div>
            <div style={{ border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 8, overflow: 'hidden', margin: '10px 0 14px' }} dangerouslySetInnerHTML={{ __html: previewTemplate.body.replace(/{{name}}/g, 'Sarah') }} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <OpsButton variant="ghost" onClick={() => setPreviewTemplate(null)}>Close</OpsButton>
              <OpsButton variant="gold" onClick={() => { applyTemplate(previewTemplate); setPreviewTemplate(null) }}>Edit & use this template</OpsButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* Per-campaign analytics: delivery, open and click engagement, plus a        */
/* per-recipient table showing who opened and who clicked.                    */
function CampaignAnalytics({ session, campaign, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    fetch(`/api/admin/campaigns/${campaign.id}/analytics`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.error || 'Could not load')
        if (mounted) setData(result)
      })
      .catch((err) => { if (mounted) setError(err.message) })
    return () => { mounted = false }
  }, [campaign.id, session])

  const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '0%')

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(35,35,35,0.55)', zIndex: 60, display: 'grid', placeItems: 'center', padding: 20 }} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div style={{ background: OPS_COLORS.cream, borderRadius: 12, padding: 22, width: '100%', maxWidth: 680, maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 18px 60px rgba(0,0,0,0.3)' }}>
        <h3 style={{ margin: '0 0 2px', fontFamily: "'Iowan Old Style', Georgia, serif", color: OPS_COLORS.emerald, fontWeight: 400 }}>{campaign.name}</h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: OPS_COLORS.muted }}>Subject: {campaign.subject}</p>
        {error && <p style={{ color: OPS_COLORS.warn, fontSize: 13 }}>{error}</p>}
        {!error && !data && <p style={{ color: OPS_COLORS.muted, fontSize: 13 }}>Loading…</p>}
        {data && (
          <>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
              {[
                ['Sent', data.sent],
                ['Failed', data.failed],
                ['Opened', `${data.opened} (${pct(data.opened, data.sent)})`],
                ['Clicked', `${data.clicked} (${pct(data.clicked, data.sent)})`],
              ].map(([label, value]) => (
                <div key={label} style={{ border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 8, padding: '10px 14px', background: OPS_COLORS.ivory, minWidth: 110 }}>
                  <div style={{ fontSize: 11, color: OPS_COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                  <strong style={{ fontSize: 20, color: OPS_COLORS.emerald }}>{value}</strong>
                </div>
              ))}
            </div>
            {data.machineOpens > 0 && (
              <p style={{ margin: '-4px 0 12px', fontSize: 12, color: OPS_COLORS.muted }}>
                {data.machineOpens} machine open{data.machineOpens === 1 ? '' : 's'} filtered out (privacy proxies and security scanners fetch images before anyone reads). Only real readers are counted, and a click always counts as an open.
              </p>
            )}
            <div style={{ maxHeight: 320, overflowY: 'auto', border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 8 }}>
              <table className="ops-table">
                <thead><tr><th>Recipient</th><th>Status</th><th>Opened</th><th>Clicked</th></tr></thead>
                <tbody>
                  {data.recipients.map((recipient) => (
                    <tr key={recipient.id}>
                      <td style={{ fontSize: 12.5 }}>{recipient.email}</td>
                      <td><Pill text={recipient.status} tone={recipient.status === 'sent' ? 'green' : recipient.status === 'failed' ? 'red' : 'default'} /></td>
                      <td style={{ fontSize: 12.5 }}>{recipient.opens > 0 ? `Yes (${recipient.opens}×)` : 'Not yet'}</td>
                      <td style={{ fontSize: 12.5 }}>{recipient.clicks > 0 ? `Yes (${recipient.clicks}×)` : 'Not yet'}</td>
                    </tr>
                  ))}
                  {!data.recipients.length && <tr><td colSpan="4" style={{ color: OPS_COLORS.muted, fontSize: 13 }}>No recipients recorded.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}><OpsButton onClick={onClose}>Close</OpsButton></div>
      </div>
    </div>
  )
}
