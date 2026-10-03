import { useEffect, useMemo, useState } from 'react'
import { OpsButton, Pill, OPS_COLORS, opsInputStyle } from './ui'

/* ------------------------------------------------------------------ */
/* Campaign audience: tick any number of segments (contact kinds,       */
/* accounts and records, contact tags), optionally type extra addresses, */
/* and exclude individuals from this one campaign. The total below is   */
/* exactly who the send reaches: each person once, never anyone who has */
/* unsubscribed.                                                         */
/* ------------------------------------------------------------------ */

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, marginBottom: 4 }
const number = (value) => Number(value || 0).toLocaleString('en-GB')

export function CampaignAudience({ session, audiences, customEmails, excludedEmails, onChange, onPreview }) {
  const [segments, setSegments] = useState(null)
  const [segmentsError, setSegmentsError] = useState('')
  const [preview, setPreview] = useState(null)
  const [previewError, setPreviewError] = useState('')
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [showTags, setShowTags] = useState(false)
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }

  useEffect(() => {
    fetch('/api/admin/campaigns/segments', { headers })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.error || 'Audiences could not be loaded.')
        setSegments(result)
      })
      .catch((error) => setSegmentsError(error.message))
  }, [session]) // eslint-disable-line react-hooks/exhaustive-deps

  // The exact recipient list, recalculated as segments, addresses or exclusions change.
  useEffect(() => {
    if (!audiences.length && !customEmails.trim()) { setPreview(null); onPreview(null); return undefined }
    let mounted = true
    setLoading(true)
    const timer = window.setTimeout(() => {
      fetch('/api/admin/campaigns/audience-preview', { method: 'POST', headers, body: JSON.stringify({ audiences, customEmails, excludedEmails }) })
        .then(async (response) => {
          const result = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(result.error || 'The recipient count could not be worked out.')
          if (mounted) { setPreview(result); setPreviewError(''); onPreview(result) }
        })
        .catch((error) => { if (mounted) { setPreviewError(error.message); setPreview(null); onPreview(null) } })
        .finally(() => { if (mounted) setLoading(false) })
    }, 350)
    return () => { mounted = false; window.clearTimeout(timer) }
  }, [audiences.join('|'), customEmails, excludedEmails.join('|'), session]) // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const list = segments?.segments || []
    return ['Contacts', 'Accounts and records', 'Contact tags'].map((group) => ({ group, items: list.filter((segment) => segment.group === group) }))
  }, [segments])
  const toggle = (key) => onChange({ audiences: audiences.includes(key) ? audiences.filter((item) => item !== key) : [...audiences, key] })
  const exclude = (email) => onChange({ excludedEmails: [...new Set([...excludedEmails, email])] })
  const include = (email) => onChange({ excludedEmails: excludedEmails.filter((item) => item !== email) })
  const matches = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!preview || term.length < 2) return []
    return preview.people.filter((person) => person.email.includes(term) || String(person.name || '').toLowerCase().includes(term)).slice(0, 30)
  }, [preview, search])

  const checkbox = (segment) => (
    <label key={segment.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '4px 10px', border: `1px solid ${audiences.includes(segment.key) ? OPS_COLORS.emerald : OPS_COLORS.rule}`, borderRadius: 20, background: audiences.includes(segment.key) ? '#e6f0e9' : '#fff', cursor: 'pointer' }}>
      <input type="checkbox" checked={audiences.includes(segment.key)} onChange={() => toggle(segment.key)} />
      {segment.label} <span style={{ color: OPS_COLORS.muted }}>({number(segment.count)})</span>
    </label>
  )

  return (
    <div style={{ marginTop: 10 }} aria-label="Audience" role="group">
      <span style={labelStyle}>Audience: tick every group this email should go to</span>
      {segmentsError && <p style={{ color: OPS_COLORS.warn, fontSize: 13 }}>{segmentsError}</p>}
      {segments?.migrationNeeded && <p style={{ color: OPS_COLORS.warn, fontSize: 13 }}>Audience segments and unsubscribes aren't set up yet. {segments.migrationNeeded}</p>}
      {!segments && !segmentsError && <p style={{ color: OPS_COLORS.muted, fontSize: 13 }}>Loading audiences…</p>}
      {segments && groups.map(({ group, items }) => items.length > 0 && (
        <div key={group} style={{ marginBottom: 8 }}>
          {group === 'Contact tags'
            ? <button type="button" onClick={() => setShowTags((current) => !current)} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: OPS_COLORS.muted, fontFamily: 'inherit', fontWeight: 700 }}>{showTags ? '▾' : '▸'} {group} ({items.length}){audiences.some((key) => key.startsWith('tag:')) ? ` · ${audiences.filter((key) => key.startsWith('tag:')).length} ticked` : ''}</button>
            : <div style={{ fontSize: 12, color: OPS_COLORS.muted, fontWeight: 700, marginBottom: 4 }}>{group}</div>}
          {(group !== 'Contact tags' || showTags) && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>{items.map(checkbox)}</div>}
        </div>
      ))}

      <label style={{ display: 'block', marginTop: 8 }}>
        <span style={labelStyle}>Also send to these addresses (optional)</span>
        <textarea aria-label="Extra email addresses" style={{ ...opsInputStyle, minHeight: 60, fontFamily: 'monospace', fontSize: 12.5 }} placeholder={'jane@oakridge.sch.uk, temi@kingsarkdance.com'} value={customEmails} onChange={(event) => onChange({ customEmails: event.target.value })} />
        <span style={{ fontSize: 12, color: OPS_COLORS.muted }}>Commas, semicolons or new lines. Anyone also in a ticked group still gets just one email.</span>
      </label>

      <div aria-live="polite" style={{ marginTop: 10, border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 8, padding: '10px 12px', background: '#fff' }}>
        {previewError && <p style={{ color: OPS_COLORS.warn, fontSize: 13, margin: 0 }}>{previewError}</p>}
        {!preview && !previewError && <p style={{ color: OPS_COLORS.muted, fontSize: 13, margin: 0 }}>{loading ? 'Counting recipients…' : 'Tick at least one group, or type some addresses.'}</p>}
        {preview && (
          <>
            <p data-testid="recipient-total" style={{ margin: 0, fontSize: 15 }}>
              Will be sent to <strong style={{ fontSize: 18, color: OPS_COLORS.emerald }}>{number(preview.total)}</strong> {preview.total === 1 ? 'person' : 'people'}, one email each{loading ? ' (updating…)' : ''}.
            </p>
            <p data-testid="recipient-working" style={{ margin: '4px 0 0', fontSize: 12.5, color: OPS_COLORS.muted }}>
              {preview.breakdown.map((item) => `${item.label} ${number(item.count)}`).join(' + ')}
              {` = ${number(preview.matched)} different people`}
              {preview.duplicates ? ` (${number(preview.duplicates)} in more than one group, counted once)` : ''}
              {preview.unsubscribed ? `, minus ${number(preview.unsubscribed)} unsubscribed` : ''}
              {preview.excluded ? `, minus ${number(preview.excluded)} excluded` : ''}.
            </p>
            {segments?.unsubscribedCount > 0 && !preview.unsubscribed && <p style={{ margin: '4px 0 0', fontSize: 12, color: OPS_COLORS.muted }}>None of the {number(segments.unsubscribedCount)} people who have unsubscribed are in these groups.</p>}

            <label style={{ display: 'block', marginTop: 10 }}>
              <span style={labelStyle}>Leave someone out of this campaign</span>
              <input aria-label="Find a recipient" style={opsInputStyle} placeholder="Search by name or email" value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            {matches.length > 0 && (
              <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 6 }}>
                {matches.map((person) => (
                  <div key={person.email} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: `1px solid ${OPS_COLORS.rule}`, fontSize: 13 }}>
                    <span>{person.name ? `${person.name} · ` : ''}{person.email}<span style={{ color: OPS_COLORS.muted, fontSize: 11.5 }}> · {person.segments.join(', ')}</span></span>
                    {person.unsubscribed ? <Pill text="Unsubscribed" tone="red" />
                      : person.excluded ? <OpsButton small variant="ghost" onClick={() => include(person.email)}>Include again</OpsButton>
                        : <OpsButton small variant="ghost" onClick={() => exclude(person.email)}>Exclude</OpsButton>}
                  </div>
                ))}
              </div>
            )}
            {search.trim().length >= 2 && !matches.length && <p style={{ fontSize: 12.5, color: OPS_COLORS.muted, margin: '6px 0 0' }}>Nobody in this audience matches "{search.trim()}".</p>}
            {excludedEmails.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <span style={{ fontSize: 12, color: OPS_COLORS.muted }}>Left out of this campaign only (not unsubscribed):</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {excludedEmails.map((email) => (
                    <span key={email} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 20, padding: '3px 4px 3px 10px', fontSize: 12.5, background: OPS_COLORS.cream }}>
                      {email}
                      <button type="button" aria-label={`Include ${email} again`} onClick={() => include(email)} style={{ border: 0, background: 'none', cursor: 'pointer', color: OPS_COLORS.muted, fontSize: 14 }}>×</button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
