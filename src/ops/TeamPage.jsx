import { useEffect, useState } from 'react'
import { OpsButton, Pill, OPS_COLORS, opsInputStyle } from './ui'

/* ------------------------------------------------------------------ */
/* Operations > Administration > Team & access — invite staff, give    */
/* them a job title, and choose exactly which parts of Operations      */
/* they can see. Backed by /api/admin/team (service role on the        */
/* server); admins only.                                               */
/* ------------------------------------------------------------------ */

export const PERMISSION_AREAS = [
  { key: 'bookings', label: 'Bookings & calendar' },
  { key: 'contacts', label: 'Contacts (CRM)' },
  { key: 'students', label: 'Students & class schedule' },
  { key: 'events', label: 'Events & ticketing' },
  { key: 'messages', label: 'Messages' },
  { key: 'site', label: 'Site content & layout' },
  { key: 'sales', label: 'Sales (subscriptions & invoices)' },
]

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, marginBottom: 4 }
const sectionStyle = { border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 10, padding: 16, background: OPS_COLORS.ivory, marginBottom: 14 }

function PermissionGrid({ value, onChange, disabled = false }) {
  const toggle = (key) => {
    if (disabled) return
    onChange(value.includes(key) ? value.filter((item) => item !== key) : [...value, key])
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 6 }}>
      {PERMISSION_AREAS.map((area) => (
        <label key={area.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: disabled ? OPS_COLORS.muted : OPS_COLORS.ink, cursor: disabled ? 'default' : 'pointer' }}>
          <input type="checkbox" checked={value.includes(area.key)} disabled={disabled} onChange={() => toggle(area.key)} />
          {area.label}
        </label>
      ))}
    </div>
  )
}

export function TeamPage({ session }) {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [invite, setInvite] = useState({ name: '', email: '', jobTitle: '', permissions: [] })
  const [inviting, setInviting] = useState(false)
  const [drafts, setDrafts] = useState({}) // id → { role, jobTitle, permissions }
  const [savingId, setSavingId] = useState('')

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
    setError('')
    try {
      const result = await authedFetch('/api/admin/team')
      setMembers(result.members || [])
    } catch (loadErr) {
      setError(loadErr.message)
    }
    setLoading(false)
  }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const draftFor = (member) => drafts[member.id] || { role: member.role, jobTitle: member.jobTitle || '', permissions: member.permissions || [] }
  const editDraft = (member, changes) => setDrafts((current) => ({ ...current, [member.id]: { ...draftFor(member), ...changes } }))

  const sendInvite = async () => {
    if (!invite.name.trim() || !/.+@.+\..+/.test(invite.email)) { setError('Add the team member\'s name and a valid email to send an invite.'); return }
    setInviting(true)
    setError('')
    try {
      await authedFetch('/api/admin/team/invite', { method: 'POST', body: JSON.stringify(invite) })
      setNotice(`Invite emailed to ${invite.email}. They set their own password from the link.`)
      setInvite({ name: '', email: '', jobTitle: '', permissions: [] })
      await load()
    } catch (inviteErr) {
      setError(inviteErr.message)
    }
    setInviting(false)
  }

  const saveMember = async (member) => {
    setSavingId(member.id)
    setError('')
    try {
      await authedFetch(`/api/admin/team/${member.id}`, { method: 'POST', body: JSON.stringify(draftFor(member)) })
      setDrafts((current) => { const next = { ...current }; delete next[member.id]; return next })
      setNotice(`${member.name || member.email} updated.`)
      await load()
    } catch (saveErr) {
      setError(saveErr.message)
    }
    setSavingId('')
  }

  const removeMember = async (member) => {
    if (!window.confirm(`Remove ${member.name || member.email}'s access completely? Their sign-in stops working immediately.`)) return
    setError('')
    try {
      await authedFetch(`/api/admin/team/${member.id}/remove`, { method: 'POST' })
      setNotice(`${member.name || member.email} removed.`)
      await load()
    } catch (removeErr) {
      setError(removeErr.message)
    }
  }

  return (
    <div className="panel">
      <div className="panel-head"><h3>Team &amp; access</h3></div>
      <p style={{ color: OPS_COLORS.muted, fontSize: 13, margin: '0 0 16px' }}>
        Invite staff by email, give them a job title, and tick exactly which parts of Operations they can open.
        Admins always see everything; staff only see what you grant here.
      </p>

      <div style={sectionStyle}>
        <h4 style={{ margin: '0 0 12px', fontSize: 15, color: OPS_COLORS.emerald }}>Invite a team member</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 12 }}>
          <label style={{ display: 'block' }}><span style={labelStyle}>Full name</span><input style={opsInputStyle} value={invite.name} onChange={(event) => setInvite({ ...invite, name: event.target.value })} /></label>
          <label style={{ display: 'block' }}><span style={labelStyle}>Email</span><input type="email" style={opsInputStyle} value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} /></label>
          <label style={{ display: 'block' }}><span style={labelStyle}>Job title</span><input style={opsInputStyle} placeholder="e.g. Programme coordinator" value={invite.jobTitle} onChange={(event) => setInvite({ ...invite, jobTitle: event.target.value })} /></label>
        </div>
        <span style={labelStyle}>Access to</span>
        <PermissionGrid value={invite.permissions} onChange={(permissions) => setInvite({ ...invite, permissions })} />
        <div style={{ marginTop: 12 }}><OpsButton disabled={inviting} onClick={sendInvite}>{inviting ? 'Sending…' : 'Send invite email'}</OpsButton></div>
      </div>

      {error && <p style={{ color: OPS_COLORS.warn, fontSize: 13 }}>{error}</p>}
      {notice && <p style={{ color: OPS_COLORS.okGreen, fontSize: 13 }}>{notice}</p>}
      {loading && <p style={{ color: OPS_COLORS.muted }}>Loading team…</p>}

      {!loading && members.map((member) => {
        const draft = draftFor(member)
        const isSelf = member.id === session.user.id
        const dirty = Boolean(drafts[member.id])
        return (
          <div key={member.id} style={sectionStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
              <div>
                <strong>{member.name || member.email}</strong> {isSelf && <Pill text="You" tone="gold" />}
                <span style={{ color: OPS_COLORS.muted, fontSize: 12.5, marginLeft: 8 }}>{member.email}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Pill text={member.role === 'admin' ? 'Admin — full access' : 'Staff'} tone={member.role === 'admin' ? 'green' : 'default'} />
                {!isSelf && (
                  <select style={{ ...opsInputStyle, width: 'auto', padding: '5px 8px', fontSize: 12.5 }} value={draft.role} onChange={(event) => editDraft(member, { role: event.target.value })}>
                    <option value="staff">Staff</option>
                    <option value="admin">Admin</option>
                  </select>
                )}
              </div>
            </div>
            <label style={{ display: 'block', maxWidth: 320, marginBottom: 10 }}>
              <span style={labelStyle}>Job title</span>
              <input style={opsInputStyle} value={draft.jobTitle} disabled={isSelf && member.role === 'admin'} onChange={(event) => editDraft(member, { jobTitle: event.target.value })} />
            </label>
            <span style={labelStyle}>Access to</span>
            <PermissionGrid value={draft.role === 'admin' ? PERMISSION_AREAS.map((area) => area.key) : draft.permissions} disabled={draft.role === 'admin' || (isSelf && member.role === 'admin')} onChange={(permissions) => editDraft(member, { permissions })} />
            <div style={{ display: 'flex', gap: 10, marginTop: 12, justifyContent: 'flex-end' }}>
              {!isSelf && <OpsButton small variant="danger" onClick={() => removeMember(member)}>Remove access</OpsButton>}
              <OpsButton small disabled={!dirty || savingId === member.id} onClick={() => saveMember(member)}>{savingId === member.id ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</OpsButton>
            </div>
          </div>
        )
      })}

      {!loading && !members.length && !error && (
        <p style={{ color: OPS_COLORS.muted, fontSize: 13 }}>No team members yet — send your first invite above.</p>
      )}
    </div>
  )
}
