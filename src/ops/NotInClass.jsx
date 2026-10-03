import { useEffect, useState } from 'react'
import { Pill, OPS_COLORS, OPS_SERIF } from './ui'

/* ------------------------------------------------------------------ */
/* Operations > Students: families whose children are in no class yet. */
/* A child gets a class when the parent books one; until then they are */
/* on no register. Click a child to open their record and put them in  */
/* a class by hand.                                                     */
/* ------------------------------------------------------------------ */

const daysAgo = (iso) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000)
  return days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`
}

export function NotInClassCard({ session, refreshKey = 0, onOpenChild }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(true)

  useEffect(() => {
    let mounted = true
    fetch('/api/admin/families/not-in-class', { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.error || 'Families not in a class could not be loaded.')
        if (mounted) { setData(result); setError('') }
      })
      .catch((loadError) => { if (mounted) setError(loadError.message) })
    return () => { mounted = false }
  }, [session, refreshKey])

  if (error) return <p style={{ color: OPS_COLORS.warn, fontSize: 13 }}>{error}</p>
  if (!data) return null
  const families = data.families || []
  const childCount = families.reduce((sum, family) => sum + family.children.length, 0)
  const note = (family) => [
    !family.hasLogin ? 'No parent login' : !family.emailConfirmed ? 'Email not confirmed yet' : '',
    family.subscriptionRequest ? `Subscription request ${family.subscriptionRequest}` : '',
    family.placedChildren ? `${family.placedChildren} other child${family.placedChildren === 1 ? ' is' : 'ren are'} in a class` : '',
    family.reminderSentAt ? `Reminder emailed ${daysAgo(family.reminderSentAt)}` : family.hasLogin && !family.placedChildren && !family.bookings && !family.subscriptionRequest ? `One reminder goes ${data.reminderAfterDays} days after sign-up` : '',
  ].filter(Boolean).join(' · ')

  return (
    <section aria-label="Not yet in a class" style={{ border: `1px solid ${families.length ? '#e0c56e' : OPS_COLORS.rule}`, background: families.length ? '#fbf6e4' : OPS_COLORS.ivory, borderRadius: 10, padding: '12px 16px', margin: '0 0 16px' }}>
      <button type="button" onClick={() => setOpen((current) => !current)} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'baseline', gap: 10, width: '100%', textAlign: 'left', fontFamily: 'inherit' }}>
        <h3 style={{ margin: 0, fontFamily: OPS_SERIF, color: OPS_COLORS.emerald, fontWeight: 400, fontSize: 19 }}>{open ? '▾' : '▸'} Not yet in a class</h3>
        <Pill text={families.length ? `${families.length} famil${families.length === 1 ? 'y' : 'ies'} · ${childCount} child${childCount === 1 ? '' : 'ren'}` : 'None'} tone={families.length ? 'gold' : 'green'} />
      </button>
      {open && (
        <>
          <p style={{ margin: '6px 0 10px', fontSize: 13, color: OPS_COLORS.muted }}>
            {families.length
              ? "These children aren't on any class register yet: the parent hasn't booked a class. Click a child to put them in a class by hand (e.g. a walk-in)."
              : 'Every child is in a class.'}
          </p>
          {families.map((family) => (
            <div key={family.familyId || family.email} style={{ borderTop: `1px solid ${OPS_COLORS.rule}`, padding: '10px 0', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 220 }}>
                <strong style={{ color: OPS_COLORS.emerald }}>{family.guardianName || 'No name'}</strong>
                <div style={{ fontSize: 12.5, color: OPS_COLORS.muted }}>{family.email}{family.email && ' · '}signed up {daysAgo(family.signedUpAt)}</div>
                {note(family) && <div style={{ fontSize: 12, color: OPS_COLORS.muted, marginTop: 2 }}>{note(family)}</div>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {family.children.map((child) => (
                  <button key={child.id} type="button" onClick={() => onOpenChild(child.id)} title="Open record to put in a class" style={{ border: `1px solid ${OPS_COLORS.rule}`, background: '#fff', borderRadius: 20, padding: '5px 12px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: OPS_COLORS.ink }}>{child.name.trim()} →</button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </section>
  )
}
