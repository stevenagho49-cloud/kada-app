/* Parent dashboard award gallery. Awards are read with the parent's own login,
   so row-level security guarantees only their own children's awards come back. */
import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { BadgeImage, formatAwardDate } from './ops/awards'

const emerald = '#0b3d2e'
const gold = '#a97e2b'
const muted = '#767066'
const serif = "'Iowan Old Style', Georgia, 'Times New Roman', serif"

export function useParentAwards(enabled = true) {
  const [state, setState] = useState({ awards: null, error: '' })
  useEffect(() => {
    if (!enabled) return undefined
    let active = true
    supabase.from('student_awards').select('id,student_id,student_name,award_name,award_description,badge,note,class_name,session_date,given_by_name,created_at').order('created_at', { ascending: false })
      .then(({ data, error }) => { if (active) setState({ awards: error ? [] : data || [], error: error ? 'Awards could not be loaded right now.' : '' }) })
    return () => { active = false }
  }, [enabled])
  return state
}

const isRecent = (award) => Date.now() - new Date(award.created_at).getTime() < 7 * 86400000
const firstName = (name) => (name || '').split(' ')[0]

/* Compact card for the dashboard home: the latest award. */
export function LatestAwardPanel({ awards, onOpen }) {
  const latest = awards?.[0]
  if (!latest) return null
  return (
    <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 16, background: 'linear-gradient(135deg, #fffdf8 0%, #fbf1d3 100%)', borderColor: '#ecdcae' }}>
      <BadgeImage badge={latest.badge} size={64} alt={`${latest.award_name} badge`} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: gold, fontWeight: 700 }}>Latest award</div>
        <div style={{ fontFamily: serif, fontSize: 20, color: emerald }}>{firstName(latest.student_name)} earned {latest.award_name}</div>
        <div style={{ fontSize: 13, color: muted }}>{formatAwardDate(latest)}</div>
      </div>
      <button type="button" onClick={onOpen} style={{ border: `1px solid ${emerald}`, background: 'transparent', color: emerald, borderRadius: 8, padding: '9px 14px', fontFamily: 'inherit', fontWeight: 700, cursor: 'pointer' }}>See all awards</button>
    </div>
  )
}

export function AwardGallery({ awards, error, students = [] }) {
  const childIds = [...new Set((awards || []).map((award) => award.student_id))]
  const [childFilter, setChildFilter] = useState('all')
  if (awards === null) return <div className="panel"><p style={{ color: muted }}>Loading awards…</p></div>
  if (error) return <div className="panel"><p style={{ color: '#a3401f' }}>{error}</p></div>

  const nameOf = (id) => students.find((student) => student.id === id)?.name || awards.find((award) => award.student_id === id)?.student_name || 'Your child'
  const shown = childFilter === 'all' ? awards : awards.filter((award) => award.student_id === childFilter)
  const tally = []
  for (const award of shown) {
    const entry = tally.find((item) => item.name === award.award_name)
    if (entry) entry.count += 1
    else tally.push({ name: award.award_name, badge: award.badge, count: 1 })
  }
  const heading = childFilter !== 'all' ? `${firstName(nameOf(childFilter))}'s awards` : childIds.length === 1 ? `${firstName(nameOf(childIds[0]))}'s awards` : 'Your awards'

  if (!awards.length) {
    return (
      <div className="panel" style={{ textAlign: 'center', padding: '40px 20px', background: 'linear-gradient(180deg, #fffdf8 0%, #f8f0da 100%)' }}>
        <div aria-hidden="true" style={{ display: 'flex', justifyContent: 'center', gap: 10, opacity: 0.35, filter: 'grayscale(1)' }}>
          {['star', 'team', 'growth', 'sun'].map((badge) => <BadgeImage key={badge} badge={badge} size={48} />)}
        </div>
        <h3 style={{ fontFamily: serif, fontWeight: 400, color: emerald, fontSize: 24, margin: '16px 0 6px' }}>The trophy shelf is ready</h3>
        <p style={{ color: muted, maxWidth: 420, margin: '0 auto', lineHeight: 1.6 }}>Our teachers give awards for great moves, teamwork, effort and attitude. Every award your child earns will be kept here, and we'll email you the moment it happens.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="panel" style={{ background: 'radial-gradient(circle at 15% 0%, #fff7dc 0%, #fbf1d3 45%, #f3e3b4 100%)', borderColor: '#e7d49c', marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: gold, fontWeight: 700 }}>Trophy shelf</div>
            <h3 style={{ fontFamily: serif, fontWeight: 400, color: emerald, fontSize: 28, margin: '4px 0 0' }}>{heading}</h3>
            <p style={{ margin: '4px 0 0', color: '#5b5140' }}>{shown.length} award{shown.length === 1 ? '' : 's'} earned so far. Brilliant!</p>
          </div>
          {childIds.length > 1 && (
            <div role="tablist" aria-label="Choose a child" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['all', ...childIds].map((id) => (
                <button key={id} type="button" role="tab" aria-selected={childFilter === id} onClick={() => setChildFilter(id)} style={{ borderRadius: 20, padding: '7px 14px', border: `1px solid ${childFilter === id ? emerald : '#d9c58c'}`, background: childFilter === id ? emerald : 'rgba(255,253,248,.7)', color: childFilter === id ? '#fffdf8' : emerald, fontFamily: 'inherit', fontWeight: 700, cursor: 'pointer' }}>{id === 'all' ? 'Everyone' : firstName(nameOf(id))}</button>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 16 }}>
          {tally.map((item) => (
            <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,253,248,.75)', borderRadius: 40, padding: '4px 14px 4px 4px' }}>
              <BadgeImage badge={item.badge} size={34} alt="" />
              <span style={{ fontSize: 13.5, color: '#3b3526' }}><strong>{item.name}</strong>{item.count > 1 ? ` × ${item.count}` : ''}</span>
            </div>
          ))}
        </div>
      </div>

      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 16 }}>
        {shown.map((award) => (
          <li key={award.id} style={{ position: 'relative', background: '#fffdf8', border: '1px solid #ecdcae', borderRadius: 18, padding: '22px 18px 18px', textAlign: 'center', boxShadow: '0 10px 24px rgba(107, 83, 16, 0.08)', overflow: 'hidden' }}>
            <div aria-hidden="true" style={{ position: 'absolute', inset: '0 0 auto 0', height: 5, background: 'linear-gradient(90deg, #0b3d2e, #c9a227, #0b3d2e)' }} />
            {isRecent(award) && <span style={{ position: 'absolute', top: 14, right: 14, background: '#c9a227', color: '#0b3d2e', borderRadius: 20, padding: '2px 9px', fontSize: 11, fontWeight: 800, letterSpacing: '.06em' }}>NEW</span>}
            <div style={{ display: 'flex', justifyContent: 'center', filter: 'drop-shadow(0 6px 10px rgba(80, 60, 10, 0.22))' }}>
              <BadgeImage badge={award.badge} size={104} alt={`${award.award_name} badge`} />
            </div>
            {childIds.length > 1 && childFilter === 'all' && <div style={{ marginTop: 10, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: gold, fontWeight: 700 }}>{firstName(nameOf(award.student_id))}</div>}
            <h4 style={{ fontFamily: serif, fontWeight: 500, color: emerald, fontSize: 22, margin: childIds.length > 1 && childFilter === 'all' ? '2px 0 0' : '12px 0 0', lineHeight: 1.2 }}>{award.award_name}</h4>
            <div style={{ fontSize: 12.5, color: muted, marginTop: 4 }}>{formatAwardDate(award)}{award.class_name ? ` · ${award.class_name}` : ''}</div>
            {award.award_description && <p style={{ fontSize: 13.5, color: '#4a4436', margin: '10px 0 0', lineHeight: 1.5 }}>{award.award_description}</p>}
            {award.note && (
              <blockquote style={{ margin: '14px 0 0', padding: '12px 14px', background: '#fbf6e7', borderRadius: 12, textAlign: 'left' }}>
                <p style={{ margin: 0, fontFamily: serif, fontStyle: 'italic', fontSize: 15.5, lineHeight: 1.5, color: '#2c2a24' }}>“{award.note}”</p>
                {/* not <footer>: the site's global footer styles would apply */}
                {award.given_by_name && <div style={{ marginTop: 6, fontSize: 12, color: gold, fontWeight: 700 }}>{firstName(award.given_by_name)}, KADA</div>}
              </blockquote>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
