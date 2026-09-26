import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { OpsButton, Pill, EmptyState, OPS_COLORS, OPS_SERIF, opsInputStyle } from './ui'

/* ------------------------------------------------------------------ */
/* Awards: badge artwork, the "give an award" sheet used from the      */
/* attendance register, the recent-awards list and the admin editor    */
/* for award types. Badges are static files in public/badges/.         */
/* ------------------------------------------------------------------ */

export const BADGES = [
  { key: 'star', label: 'Star' },
  { key: 'team', label: 'Team' },
  { key: 'growth', label: 'Growth' },
  { key: 'sun', label: 'Sunshine' },
  { key: 'heart', label: 'Heart' },
  { key: 'music', label: 'Music' },
  { key: 'crown', label: 'Crown' },
  { key: 'bolt', label: 'Energy' },
]

export function BadgeImage({ badge, size = 64, alt = '' }) {
  const key = BADGES.some((item) => item.key === badge) ? badge : 'star'
  return <img src={`/badges/${key}.svg`} alt={alt} width={size} height={Math.round(size * 300 / 256)} style={{ display: 'block', flexShrink: 0 }} />
}

export const formatAwardDate = (award) => new Date(`${(award.session_date || award.created_at).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

export async function loadAwardTypes({ includeArchived = false } = {}) {
  let query = supabase.from('award_types').select('*').order('sort_order').order('created_at')
  if (!includeArchived) query = query.eq('active', true)
  const { data, error } = await query
  if (error) throw new Error(/award_types/.test(error.message) ? 'Awards are not set up yet. Apply supabase/migrations/20260926_awards.sql in the Supabase SQL Editor.' : error.message)
  return data || []
}

/* Bottom sheet for giving one child an award, sized for a phone. */
export function GiveAwardSheet({ child, className, sessionDate, session, onClose, onGiven }) {
  const [types, setTypes] = useState(null)
  const [typeId, setTypeId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadAwardTypes().then(setTypes).catch((loadError) => { setError(loadError.message); setTypes([]) })
  }, [])

  const give = async () => {
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/awards', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ studentId: child.id, awardTypeId: typeId, note, className, sessionDate }) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'The award could not be given.')
      onGiven(result)
    } catch (giveError) {
      setError(giveError.message)
      setSaving(false)
    }
  }

  const firstName = child.name.split(' ')[0]
  return (
    <div role="dialog" aria-modal="true" aria-label={`Give ${child.name} an award`} onClick={(event) => event.target === event.currentTarget && onClose()} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(20,24,20,.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: OPS_COLORS.cream, width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto', borderRadius: '18px 18px 0 0', padding: '18px 16px 22px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontFamily: OPS_SERIF, fontWeight: 400, color: OPS_COLORS.emerald, fontSize: 22 }}>Award for {firstName}</h3>
          <button type="button" aria-label="Close" onClick={onClose} style={{ border: 0, background: 'none', fontSize: 26, lineHeight: 1, color: OPS_COLORS.muted, cursor: 'pointer', minWidth: 44, minHeight: 44 }}>×</button>
        </div>
        {types === null ? <p style={{ color: OPS_COLORS.muted }}>Loading awards…</p> : !types.length && !error ? <p style={{ color: OPS_COLORS.muted }}>No awards set up yet. An admin can add them under Attendance &gt; Awards.</p> : (
          <div role="radiogroup" aria-label="Award" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            {types.map((type) => {
              const selected = typeId === type.id
              return (
                <button key={type.id} type="button" role="radio" aria-checked={selected} onClick={() => setTypeId(type.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', padding: 8, minHeight: 72, borderRadius: 12, border: `2px solid ${selected ? OPS_COLORS.gold : OPS_COLORS.rule}`, background: selected ? '#fbf1d3' : OPS_COLORS.ivory, fontFamily: 'inherit', cursor: 'pointer' }}>
                  <BadgeImage badge={type.badge} size={44} />
                  <span style={{ fontWeight: 700, fontSize: 14, color: OPS_COLORS.ink, lineHeight: 1.25 }}>{type.name}</span>
                </button>
              )
            })}
          </div>
        )}
        <label style={{ display: 'block', marginTop: 14, fontSize: 13, fontWeight: 700, color: OPS_COLORS.emerald }}>
          Personal note (optional)
          <textarea value={note} maxLength={280} rows={3} onChange={(event) => setNote(event.target.value)} placeholder={`e.g. Great job leading the group today, ${firstName}!`} style={{ ...opsInputStyle, marginTop: 4, fontSize: 16, resize: 'vertical', fontWeight: 400 }} />
        </label>
        <div style={{ fontSize: 11.5, color: OPS_COLORS.muted, textAlign: 'right' }}>{note.length}/280</div>
        {error && <p role="alert" style={{ color: OPS_COLORS.warn, fontSize: 14 }}>{error}</p>}
        <button type="button" disabled={!typeId || saving} onClick={give} style={{ width: '100%', minHeight: 52, marginTop: 8, borderRadius: 10, border: 0, background: OPS_COLORS.emerald, color: OPS_COLORS.ivory, fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: !typeId || saving ? 'not-allowed' : 'pointer', opacity: !typeId || saving ? 0.55 : 1 }}>
          {saving ? 'Giving award…' : typeId ? `Give award & email ${firstName}'s parent` : 'Choose an award'}
        </button>
      </div>
    </div>
  )
}

/* Attendance > Awards: recent awards for everyone with the permission, and the
   award-type editor for admins. */
export function AwardsTab({ session, isAdmin }) {
  const [awards, setAwards] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = async () => {
    const { data, error: loadError } = await supabase.from('student_awards').select('*').order('created_at', { ascending: false }).limit(60)
    if (loadError) { setError(/student_awards/.test(loadError.message) ? 'Awards are not set up yet. Apply supabase/migrations/20260926_awards.sql in the Supabase SQL Editor.' : loadError.message); setAwards([]); return }
    setAwards(data || [])
  }
  useEffect(() => { load() }, [])

  const resend = async (award) => {
    const response = await fetch(`/api/awards/${award.id}/resend`, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } })
    const result = await response.json().catch(() => ({}))
    setNotice(response.ok ? `Celebration email sent to ${result.emailTo}.` : result.error || 'The email could not be sent.')
    load()
  }
  const remove = async (award) => {
    if (!window.confirm(`Remove ${award.award_name} from ${award.student_name}? It disappears from their parent's dashboard (an email already sent can't be recalled).`)) return
    const { error: deleteError } = await supabase.from('student_awards').delete().eq('id', award.id)
    setNotice(deleteError ? deleteError.message : 'Award removed.')
    load()
  }

  return (
    <div>
      {notice && <p role="status" style={{ background: '#faf1d9', color: '#6b5310', padding: '8px 12px', borderRadius: 6, fontSize: 13.5 }}>{notice}</p>}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head"><h3>Recent awards</h3></div>
        {error ? <p style={{ color: OPS_COLORS.warn }}>{error}</p> : awards === null ? <p style={{ color: OPS_COLORS.muted }}>Loading…</p> : !awards.length ? (
          <EmptyState icon="🏅" title="No awards yet" body="Give one from the register: tap the award button under a child's name." />
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {awards.map((award) => (
              <li key={award.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 0', borderTop: `1px solid ${OPS_COLORS.rule}` }}>
                <BadgeImage badge={award.badge} size={40} alt="" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div><strong>{award.student_name}</strong> · {award.award_name}</div>
                  {award.note && <div style={{ fontSize: 13, fontStyle: 'italic', color: OPS_COLORS.ink }}>“{award.note}”</div>}
                  <div style={{ fontSize: 12, color: OPS_COLORS.muted }}>
                    {formatAwardDate(award)}{award.class_name ? ` · ${award.class_name}` : ''}{award.given_by_name ? ` · from ${award.given_by_name}` : ''}
                    {' · '}{award.email_sent_at ? 'parent emailed' : <span style={{ color: OPS_COLORS.warn }}>email not sent{award.email_error ? ` (${award.email_error})` : ''}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {!award.email_sent_at && <OpsButton small variant="ghost" onClick={() => resend(award)}>Send email</OpsButton>}
                  <OpsButton small variant="danger" onClick={() => remove(award)}>Remove</OpsButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {isAdmin && <AwardTypesEditor />}
    </div>
  )
}

function AwardTypesEditor() {
  const [types, setTypes] = useState(null)
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')

  const load = () => loadAwardTypes({ includeArchived: true }).then(setTypes).catch((loadError) => { setError(loadError.message); setTypes([]) })
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!draft.name.trim()) { setError('Give the award a name.'); return }
    const record = { name: draft.name.trim().slice(0, 60), description: draft.description.trim().slice(0, 200), badge: draft.badge, active: draft.active, updated_at: new Date().toISOString() }
    const { error: saveError } = draft.id
      ? await supabase.from('award_types').update(record).eq('id', draft.id)
      : await supabase.from('award_types').insert({ ...record, sort_order: (types?.length || 0) + 1 })
    if (saveError) { setError(saveError.message); return }
    setDraft(null)
    setError('')
    load()
  }
  const setActive = async (type, active) => {
    const { error: saveError } = await supabase.from('award_types').update({ active, updated_at: new Date().toISOString() }).eq('id', type.id)
    if (saveError) setError(saveError.message)
    load()
  }

  return (
    <div className="panel">
      <div className="panel-head"><h3>Award types</h3>{!draft && <OpsButton small onClick={() => setDraft({ name: '', description: '', badge: 'star', active: true })}>Add award</OpsButton>}</div>
      <p style={{ color: OPS_COLORS.muted, fontSize: 13, marginTop: 0 }}>Archived awards can't be given any more but stay on every child who already earned them. Renaming doesn't change awards already given.</p>
      {error && <p role="alert" style={{ color: OPS_COLORS.warn }}>{error}</p>}
      {draft && (
        <div style={{ border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 10, padding: 14, marginBottom: 14, background: OPS_COLORS.ivory }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald }}>Name<input value={draft.name} maxLength={60} onChange={(event) => setDraft({ ...draft, name: event.target.value })} style={{ ...opsInputStyle, marginTop: 4 }} /></label>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, marginTop: 10 }}>Short description (shown in the parent's email)<input value={draft.description} maxLength={200} onChange={(event) => setDraft({ ...draft, description: event.target.value })} style={{ ...opsInputStyle, marginTop: 4 }} /></label>
          <div style={{ fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, marginTop: 10 }}>Badge</div>
          <div role="radiogroup" aria-label="Badge" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {BADGES.map((badge) => (
              <button key={badge.key} type="button" role="radio" aria-checked={draft.badge === badge.key} aria-label={badge.label} title={badge.label} onClick={() => setDraft({ ...draft, badge: badge.key })} style={{ padding: 4, borderRadius: 10, border: `2px solid ${draft.badge === badge.key ? OPS_COLORS.gold : 'transparent'}`, background: draft.badge === badge.key ? '#fbf1d3' : 'transparent', cursor: 'pointer' }}>
                <BadgeImage badge={badge.key} size={46} />
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}><OpsButton onClick={save}>{draft.id ? 'Save award' : 'Add award'}</OpsButton><OpsButton variant="ghost" onClick={() => { setDraft(null); setError('') }}>Cancel</OpsButton></div>
        </div>
      )}
      {types === null ? <p style={{ color: OPS_COLORS.muted }}>Loading…</p> : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {types.map((type) => (
            <li key={type.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0', borderTop: `1px solid ${OPS_COLORS.rule}`, opacity: type.active ? 1 : 0.6 }}>
              <BadgeImage badge={type.badge} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{type.name}</strong> {!type.active && <Pill text="Archived" />}
                <div style={{ fontSize: 12.5, color: OPS_COLORS.muted }}>{type.description}</div>
              </div>
              <OpsButton small variant="ghost" onClick={() => setDraft({ id: type.id, name: type.name, description: type.description, badge: type.badge, active: type.active })}>Edit</OpsButton>
              <OpsButton small variant={type.active ? 'danger' : 'ghost'} onClick={() => setActive(type, !type.active)}>{type.active ? 'Archive' : 'Restore'}</OpsButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
