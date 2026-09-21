import { useEffect, useState } from 'react'
import { OPS_COLORS } from './ui'

/* ------------------------------------------------------------------ */
/* Operations > Dashboard > Site analytics — traffic over the last 30  */
/* days from the page_views table (recorded by /api/track/pageview).   */
/* ------------------------------------------------------------------ */
export function SiteAnalytics({ session }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    fetch('/api/admin/site-analytics', { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.error || 'Could not load')
        if (mounted) setData(result)
      })
      .catch((err) => { if (mounted) setError(err.message) })
    return () => { mounted = false }
  }, [session])

  const maxViews = data?.days?.length ? Math.max(...data.days.map((d) => d.views), 1) : 1

  return (
    <div className="panel">
      <div className="panel-head"><h3>Site analytics (last 30 days)</h3></div>
      {error && <p style={{ color: OPS_COLORS.warn, fontSize: 13 }}>Site analytics unavailable ({error}). Apply the analytics migration in Supabase to start collecting views.</p>}
      {!error && !data && <p style={{ color: OPS_COLORS.muted, fontSize: 13 }}>Loading…</p>}
      {data && (
        <>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 14 }}>
            <div><div style={{ fontSize: 12, color: OPS_COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total views</div><strong style={{ fontSize: 24, color: OPS_COLORS.emerald }}>{data.totalViews}</strong></div>
            <div><div style={{ fontSize: 12, color: OPS_COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Active days</div><strong style={{ fontSize: 24, color: OPS_COLORS.emerald }}>{data.days.length}</strong></div>
          </div>

          {data.days.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 90, marginBottom: 18, padding: '4px 0' }}>
              {data.days.map((d) => (
                <div key={d.day} title={`${d.day}: ${d.views} view${d.views === 1 ? '' : 's'}`} style={{ flex: 1, minWidth: 4, background: OPS_COLORS.emerald, borderRadius: '3px 3px 0 0', height: `${Math.max((d.views / maxViews) * 100, 4)}%`, opacity: 0.85 }} />
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, marginBottom: 6 }}>Top pages</div>
              {data.topPages.length ? data.topPages.map((page) => (
                <div key={page.path} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: `1px solid ${OPS_COLORS.rule}` }}>
                  <span style={{ color: OPS_COLORS.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{page.path}</span>
                  <strong style={{ color: OPS_COLORS.muted }}>{page.views}</strong>
                </div>
              )) : <p style={{ color: OPS_COLORS.muted, fontSize: 13 }}>No page views recorded yet.</p>}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, marginBottom: 6 }}>Where visitors came from</div>
              {data.topReferrers.length ? data.topReferrers.map((ref) => (
                <div key={ref.source} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: `1px solid ${OPS_COLORS.rule}` }}>
                  <span style={{ color: OPS_COLORS.ink }}>{ref.source}</span>
                  <strong style={{ color: OPS_COLORS.muted }}>{ref.views}</strong>
                </div>
              )) : <p style={{ color: OPS_COLORS.muted, fontSize: 13 }}>No referrers recorded yet.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
