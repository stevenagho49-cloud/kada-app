import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { compressFlyer, flyerFileName } from '../lib/flyerImage'
import { OpsButton, EmptyState, Pill, OPS_COLORS, OPS_SERIF, opsInputStyle } from './ui'

/* ------------------------------------------------------------------ */
/* Operations > Social Studio (phase 1): media library with consent,   */
/* brand templates rendered on the server, a draft generator fed by    */
/* real platform data, an approval queue and a month calendar. Nothing */
/* is posted to a network: approved posts are downloaded as PNGs and   */
/* their caption copied, then published by hand.                       */
/* Access: the 'social' staff permission (server and RLS).             */
/* ------------------------------------------------------------------ */

const BUCKET = 'social-media'
const MAX_VIDEO_BYTES = 50 * 1024 * 1024
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']
const TAGS = [['class', 'Class'], ['event', 'Event'], ['school', 'School'], ['corporate', 'Corporate']]
const CONSENT_OPTIONS = [
  ['cleared', 'Cleared for website, Instagram and Facebook', 'green'],
  ['adults_only', 'Adults only', 'gold'],
  ['not_cleared', 'Not cleared', 'red'],
]
const STATUS = {
  draft: ['Draft', 'default'],
  approved: ['Approved', 'green'],
  scheduled: ['Scheduled', 'gold'],
  published: ['Published', 'green'],
}
const PLATFORM_LABELS = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn' }
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const setupMessage = 'Social Studio is not set up yet. Apply supabase/migrations/20261007_social_studio.sql in the Supabase SQL Editor.'

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, margin: '0 0 4px' }
const cardStyle = { border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 10, background: OPS_COLORS.ivory, padding: 14 }
const consentLabel = (value) => CONSENT_OPTIONS.find(([key]) => key === value)?.[1] || value
const consentTone = (value) => CONSENT_OPTIONS.find(([key]) => key === value)?.[2] || 'default'

const isCorporate = (post) => post.content_type === 'corporate_team' || post.template === 'linkedin_card' || (post.platforms || []).includes('linkedin')

// Mirrors the server rule: why this library item can't go on this post ('' = it can).
function mediaBlockReason(item, post) {
  if (item.consent === 'not_cleared') return 'Not cleared'
  if (item.kind !== 'image') return 'Video clip (templates need a photo)'
  if (isCorporate(post) && item.shows_children) return 'Shows children: not for LinkedIn or corporate posts'
  return ''
}

function useApi(session) {
  return useCallback(async (path, { method = 'GET', body, blob = false } = {}) => {
    const response = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${session.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (blob && response.ok) return response
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw Object.assign(new Error(result.error || `Request failed (${response.status}).`), { details: result })
    return result
  }, [session])
}

export function SocialStudioPage({ session, view = 'posts' }) {
  const api = useApi(session)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editingId, setEditingId] = useState('')

  const load = useCallback(async () => {
    try {
      setData(await api('/api/social/bootstrap'))
      setError('')
    } catch (loadError) {
      setError(/social_(media|posts)|does not exist|schema cache/i.test(loadError.message) ? setupMessage : loadError.message)
    }
  }, [api])
  useEffect(() => { load() }, [load])

  const replacePost = (post) => setData((current) => ({ ...current, posts: [post, ...current.posts.filter((item) => item.id !== post.id)] }))
  const replaceMedia = (item) => setData((current) => ({ ...current, media: current.media.some((existing) => existing.id === item.id) ? current.media.map((existing) => existing.id === item.id ? item : existing) : [item, ...current.media] }))

  if (error) return <div className="panel"><p style={{ color: OPS_COLORS.warn }}>{error}</p></div>
  if (!data) return <div className="panel"><p style={{ color: OPS_COLORS.muted }}>Loading Social Studio…</p></div>

  const editing = data.posts.find((post) => post.id === editingId)
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {notice && <div role="status" style={{ ...cardStyle, background: '#e6f0e9', color: OPS_COLORS.okGreen, fontSize: 13 }}>{notice} <button type="button" onClick={() => setNotice('')} style={{ float: 'right', border: 0, background: 'none', cursor: 'pointer', color: 'inherit' }}>✕</button></div>}
      {editing ? (
        <PostEditor key={editing.id} post={editing} data={data} api={api} onChange={replacePost} onClose={() => setEditingId('')} onDeleted={(id) => { setData((current) => ({ ...current, posts: current.posts.filter((post) => post.id !== id) })); setEditingId('') }} onNotice={setNotice} />
      ) : view === 'library' ? (
        <MediaLibrary data={data} api={api} onMedia={replaceMedia} onRemoved={(id) => setData((current) => ({ ...current, media: current.media.filter((item) => item.id !== id) }))} onReload={load} />
      ) : view === 'calendar' ? (
        <CalendarView posts={data.posts} onOpen={setEditingId} />
      ) : view === 'settings' ? (
        <SettingsView data={data} api={api} onSaved={(settings) => setData((current) => ({ ...current, settings }))} />
      ) : (
        <>
          <NewPostPanel data={data} api={api} onCreated={(post, message, draftUsage) => { replacePost(post); if (draftUsage) setData((current) => ({ ...current, draftUsage })); setEditingId(post.id); setNotice(message) }} />
          <PostQueue posts={data.posts} data={data} onOpen={setEditingId} />
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Media library                                                       */
/* ------------------------------------------------------------------ */
function MediaLibrary({ data, api, onMedia, onRemoved }) {
  const [files, setFiles] = useState([])
  const [meta, setMeta] = useState({ title: '', tags: [], consent: '', showsChildren: true })
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [filter, setFilter] = useState({ consent: '', tag: '' })

  const upload = async () => {
    if (!files.length) return
    if (!meta.consent) { setError('Choose the consent status before uploading.'); return }
    setError('')
    for (const [index, file] of files.entries()) {
      setBusy(`Uploading ${index + 1} of ${files.length}…`)
      try {
        const isVideo = file.type.startsWith('video/')
        let body = file
        let name = file.name
        let size = {}
        if (isVideo) {
          if (!VIDEO_TYPES.includes(file.type)) throw new Error(`${file.name}: clips must be MP4, MOV or WebM.`)
          if (file.size > MAX_VIDEO_BYTES) throw new Error(`${file.name} is over 50 MB. Trim the clip and try again.`)
          name = file.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-80)
        } else {
          const compressed = await compressFlyer(file)
          body = compressed.blob
          name = flyerFileName(file.name)
          size = { width: compressed.width, height: compressed.height }
        }
        const storagePath = `${crypto.randomUUID()}/${name}`
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, body, { contentType: isVideo ? file.type : 'image/jpeg', upsert: false })
        if (uploadError) throw new Error(`${file.name}: ${uploadError.message}`)
        const result = await api('/api/social/media', { method: 'POST', body: { storagePath, kind: isVideo ? 'video' : 'image', title: meta.title || file.name.replace(/\.[^.]+$/, ''), tags: meta.tags, consent: meta.consent, showsChildren: meta.consent === 'adults_only' ? false : meta.showsChildren, ...size } })
        onMedia(result.media)
      } catch (uploadError) {
        setError(uploadError.message)
        break
      }
    }
    setBusy('')
    setFiles([])
    setMeta({ title: '', tags: [], consent: '', showsChildren: true })
  }

  const update = async (item, changes) => {
    try {
      if (changes.consent === 'not_cleared' && !window.confirm('Mark this as not cleared? Any draft or approved post using it loses the photo and goes back to draft.')) return
      onMedia((await api(`/api/social/media/${item.id}`, { method: 'PATCH', body: changes })).media)
    } catch (updateError) { window.alert(updateError.message) }
  }
  const remove = async (item) => {
    if (!window.confirm(`Delete "${item.title || 'this item'}" from the library? This also deletes the file.`)) return
    try { await api(`/api/social/media/${item.id}`, { method: 'DELETE' }); onRemoved(item.id) } catch (removeError) { window.alert(removeError.message) }
  }

  const shown = data.media.filter((item) => (!filter.consent || item.consent === filter.consent) && (!filter.tag || item.tags.includes(filter.tag)))
  return (
    <>
      <div className="panel">
        <div className="panel-head"><h3>Add photos and clips</h3></div>
        <p style={{ color: OPS_COLORS.muted, fontSize: 13, lineHeight: 1.55, margin: '0 0 12px' }}>Stored in a private bucket of their own, separate from every other photo store. Only items marked cleared (or adults only) can ever go on a post, and nothing showing children can go on a LinkedIn or corporate post. Photos are resized to JPEG on your phone before upload; clips up to 50 MB.</p>
        <div style={{ display: 'grid', gap: 12 }}>
          <label style={{ ...cardStyle, display: 'block', textAlign: 'center', cursor: 'pointer', borderStyle: 'dashed', padding: 20 }}>
            <input type="file" accept="image/*,video/mp4,video/quicktime,video/webm" multiple onChange={(event) => setFiles([...event.target.files])} style={{ display: 'none' }} />
            <strong style={{ color: OPS_COLORS.emerald }}>{files.length ? `${files.length} file${files.length === 1 ? '' : 's'} chosen` : 'Tap to choose or take photos and clips'}</strong>
            {files.length > 0 && <div style={{ fontSize: 12, color: OPS_COLORS.muted, marginTop: 4 }}>{files.map((file) => file.name).join(', ')}</div>}
          </label>
          <div>
            <label style={labelStyle} htmlFor="social-title">Title (optional)</label>
            <input id="social-title" style={opsInputStyle} value={meta.title} placeholder="e.g. Saturday class warm up" onChange={(event) => setMeta({ ...meta, title: event.target.value })} />
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={labelStyle}>Tags</legend>
            <TagPicker value={meta.tags} onChange={(tags) => setMeta({ ...meta, tags })} />
          </fieldset>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 6 }}>
            <legend style={labelStyle}>Consent status (required)</legend>
            {CONSENT_OPTIONS.map(([key, label]) => (
              <label key={key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, minHeight: 32 }}>
                <input type="radio" name="social-consent" checked={meta.consent === key} onChange={() => setMeta({ ...meta, consent: key, showsChildren: key === 'adults_only' ? false : meta.showsChildren })} /> {label}
              </label>
            ))}
          </fieldset>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, color: meta.consent === 'adults_only' ? OPS_COLORS.muted : OPS_COLORS.ink }}>
            <input type="checkbox" disabled={meta.consent === 'adults_only'} checked={meta.consent !== 'adults_only' && meta.showsChildren} onChange={(event) => setMeta({ ...meta, showsChildren: event.target.checked })} />
            Shows children (anyone under 18)
          </label>
          {error && <p role="alert" style={{ color: OPS_COLORS.warn, margin: 0, fontSize: 13 }}>{error}</p>}
          <div><OpsButton variant="gold" disabled={!files.length || Boolean(busy)} onClick={upload}>{busy || 'Upload to library'}</OpsButton></div>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head">
          <h3>Library ({data.media.length})</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select aria-label="Filter by consent" style={{ ...opsInputStyle, width: 'auto' }} value={filter.consent} onChange={(event) => setFilter({ ...filter, consent: event.target.value })}>
              <option value="">All consent</option>
              {CONSENT_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <select aria-label="Filter by tag" style={{ ...opsInputStyle, width: 'auto' }} value={filter.tag} onChange={(event) => setFilter({ ...filter, tag: event.target.value })}>
              <option value="">All tags</option>
              {TAGS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </div>
        </div>
        {shown.length === 0 ? <EmptyState icon="📸" title="Nothing here yet" body="Upload photos and short clips above. Set the consent status on each one." /> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 210px), 1fr))', gap: 12 }}>
            {shown.map((item) => (
              <div key={item.id} style={{ ...cardStyle, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <MediaThumb item={item} height={150} />
                <div style={{ padding: 10, display: 'grid', gap: 8, fontSize: 13 }}>
                  <input aria-label="Title" style={{ ...opsInputStyle, padding: '6px 8px', fontSize: 13 }} defaultValue={item.title} onBlur={(event) => event.target.value !== item.title && update(item, { title: event.target.value })} />
                  <select aria-label="Consent status" style={{ ...opsInputStyle, padding: '6px 8px', fontSize: 13 }} value={item.consent} onChange={(event) => update(item, { consent: event.target.value })}>
                    {CONSENT_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', color: item.consent === 'adults_only' ? OPS_COLORS.muted : OPS_COLORS.ink }}>
                    <input type="checkbox" disabled={item.consent === 'adults_only'} checked={item.shows_children} onChange={(event) => update(item, { showsChildren: event.target.checked })} /> Shows children
                  </label>
                  <TagPicker small value={item.tags} onChange={(tags) => update(item, { tags })} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Pill text={item.consent === 'cleared' ? 'Cleared' : consentLabel(item.consent)} tone={consentTone(item.consent)} />
                    <OpsButton small variant="danger" onClick={() => remove(item)}>Delete</OpsButton>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function TagPicker({ value, onChange, small = false }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {TAGS.map(([key, label]) => {
        const on = value.includes(key)
        return <button key={key} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((tag) => tag !== key) : [...value, key])} style={{ border: `1px solid ${on ? OPS_COLORS.emerald : OPS_COLORS.rule}`, background: on ? OPS_COLORS.emerald : OPS_COLORS.ivory, color: on ? OPS_COLORS.ivory : OPS_COLORS.ink, borderRadius: 999, padding: small ? '3px 10px' : '7px 14px', fontSize: small ? 12 : 13, cursor: 'pointer', fontFamily: 'inherit' }}>{label}</button>
      })}
    </div>
  )
}

function MediaThumb({ item, height = 120 }) {
  if (!item?.url) return <div style={{ height, background: OPS_COLORS.cream }} />
  return item.kind === 'video'
    ? <video src={item.url} muted playsInline controls preload="metadata" style={{ width: '100%', height, objectFit: 'cover', background: '#000' }} />
    : <img src={item.url} alt={item.title || 'Library photo'} loading="lazy" style={{ width: '100%', height, objectFit: 'cover', display: 'block' }} />
}

/* Photo picker: ineligible items are shown but can't be chosen. */
function MediaPicker({ media, post, value, onChange, label = 'Photo' }) {
  const [open, setOpen] = useState(false)
  const chosen = media.find((item) => item.id === value)
  return (
    <div>
      <span style={labelStyle}>{label}</span>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {chosen ? <div style={{ width: 72, borderRadius: 6, overflow: 'hidden' }}><MediaThumb item={chosen} height={72} /></div> : <span style={{ fontSize: 13, color: OPS_COLORS.muted }}>No photo</span>}
        <OpsButton small variant="ghost" onClick={() => setOpen(!open)}>{open ? 'Close' : chosen ? 'Swap photo' : 'Choose photo'}</OpsButton>
        {chosen && <OpsButton small variant="danger" onClick={() => onChange(null)}>Remove</OpsButton>}
      </div>
      {open && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8, marginTop: 10, maxHeight: 360, overflowY: 'auto' }}>
          {media.length === 0 && <p style={{ fontSize: 13, color: OPS_COLORS.muted }}>The library is empty. Upload photos under Social Studio &gt; Media library.</p>}
          {media.map((item) => {
            const reason = mediaBlockReason(item, post)
            return (
              <button key={item.id} type="button" disabled={Boolean(reason)} aria-disabled={Boolean(reason)} title={reason || item.title} data-media-id={item.id} data-blocked={reason ? 'true' : 'false'}
                onClick={() => { if (!reason) { onChange(item.id); setOpen(false) } }}
                style={{ padding: 0, border: `2px solid ${item.id === value ? OPS_COLORS.gold : OPS_COLORS.rule}`, borderRadius: 8, overflow: 'hidden', background: OPS_COLORS.ivory, cursor: reason ? 'not-allowed' : 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                <div style={{ position: 'relative', opacity: reason ? 0.35 : 1 }}>{item.kind === 'video' ? <div style={{ height: 80, display: 'grid', placeItems: 'center', background: '#111', color: '#fff', fontSize: 12 }}>Clip</div> : <MediaThumb item={item} height={80} />}</div>
                <div style={{ padding: '4px 6px', fontSize: 11, lineHeight: 1.3, color: reason ? OPS_COLORS.warn : OPS_COLORS.ink }}>{reason || item.title || 'Untitled'}</div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* New post / draft generator                                          */
/* ------------------------------------------------------------------ */
function NewPostPanel({ data, api, onCreated }) {
  const types = data.contentTypes
  const [form, setForm] = useState({ contentType: 'event_promo', sourceId: '', platforms: ['instagram', 'facebook'], notes: '', quote: '', attribution: '', mediaId: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const type = types[form.contentType]
  const sources = type.source === 'event' ? data.events.map((event) => [event.id, `${event.title} (${event.event_date})`]) : data.classes.map((item) => [item.id, `${item.name}${item.audience === 'adults' ? ' (adults)' : ''}${item.active ? '' : ' (hidden)'}`])
  const sourceKind = type.source === 'none' ? (form.sourceId ? form.sourceId.split(':')[0] : 'none') : type.source
  const sourceId = type.source === 'none' ? form.sourceId.split(':')[1] || '' : form.sourceId
  const platforms = form.contentType === 'corporate_team' ? ['linkedin'] : form.platforms
  const draftPost = { content_type: form.contentType, template: type.template, platforms }

  const generate = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await api('/api/social/drafts', { method: 'POST', body: { contentType: form.contentType, sourceKind, sourceId, platforms, notes: form.notes, quote: form.quote, attribution: form.attribution, mediaId: form.mediaId || undefined } })
      const flagged = (result.findings?.blocks?.length || 0) + (result.findings?.nameMatches?.length || 0)
      onCreated(result.post, `Draft created${result.draftedBy === 'claude' ? ' by Claude' : ' from platform data'}.${flagged ? ' Some text needs fixing before it can be approved (see the checks).' : ''}`, result.draftUsage)
      setForm({ ...form, notes: '', quote: '', attribution: '', mediaId: '' })
    } catch (generateError) {
      setError(generateError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <div className="panel-head"><h3>New post</h3></div>
      <p style={{ color: OPS_COLORS.muted, fontSize: 13, margin: '0 0 12px' }}>
        {data.aiDrafting ? 'Claude drafts the headline, slides and caption from live platform data (event dates, ticket tiers and tickets left, class times and prices).' : 'Claude drafting is not configured on this server (ANTHROPIC_API_KEY), so drafts are filled from platform data for you to edit.'}
        {data.draftUsage && ` ${Math.max(0, data.draftUsage.limit - data.draftUsage.used)} of ${data.draftUsage.limit} Claude drafts left today.`}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12 }}>
        <div>
          <label style={labelStyle} htmlFor="social-type">Content type</label>
          <select id="social-type" style={opsInputStyle} value={form.contentType} onChange={(event) => setForm({ ...form, contentType: event.target.value, sourceId: '', mediaId: '' })}>
            {Object.entries(types).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
          </select>
        </div>
        {type.source !== 'none' ? (
          <div>
            <label style={labelStyle} htmlFor="social-source">{type.source === 'event' ? 'Event' : 'Class'}</label>
            <select id="social-source" style={opsInputStyle} value={form.sourceId} onChange={(event) => setForm({ ...form, sourceId: event.target.value })}>
              <option value="">Choose…</option>
              {sources.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </div>
        ) : (
          <div>
            <label style={labelStyle} htmlFor="social-source">Facts from (optional)</label>
            <select id="social-source" style={opsInputStyle} value={form.sourceId} onChange={(event) => setForm({ ...form, sourceId: event.target.value })}>
              <option value="">KADA site content only</option>
              {data.events.map((event) => <option key={event.id} value={`event:${event.id}`}>Event: {event.title}</option>)}
              {data.classes.map((item) => <option key={item.id} value={`class:${item.id}`}>Class: {item.name}</option>)}
            </select>
          </div>
        )}
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={labelStyle}>Platforms</legend>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', paddingTop: 6 }}>
            {Object.entries(PLATFORM_LABELS).map(([key, label]) => (
              <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
                <input type="checkbox" disabled={form.contentType === 'corporate_team'} checked={platforms.includes(key)} onChange={(event) => setForm({ ...form, platforms: event.target.checked ? [...form.platforms, key] : form.platforms.filter((item) => item !== key) })} /> {label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      {form.contentType === 'testimonial' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 12, marginTop: 12 }}>
          <div>
            <label style={labelStyle} htmlFor="social-quote">Real testimonial (word for word)</label>
            <textarea id="social-quote" rows={3} style={opsInputStyle} value={form.quote} onChange={(event) => setForm({ ...form, quote: event.target.value })} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="social-attr">Attribution (no child's name)</label>
            <input id="social-attr" style={opsInputStyle} placeholder="e.g. Parent, Saturday class" value={form.attribution} onChange={(event) => setForm({ ...form, attribution: event.target.value })} />
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 12, marginTop: 12 }}>
        <div>
          <label style={labelStyle} htmlFor="social-notes">Notes for the draft (optional)</label>
          <textarea id="social-notes" rows={3} style={opsInputStyle} placeholder="Angle, audience, anything to mention" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </div>
        <MediaPicker media={data.media} post={draftPost} value={form.mediaId} onChange={(mediaId) => setForm({ ...form, mediaId: mediaId || '' })} />
      </div>
      {error && <p role="alert" style={{ color: OPS_COLORS.warn, fontSize: 13 }}>{error}</p>}
      <div style={{ marginTop: 12 }}>
        <OpsButton variant="gold" disabled={busy || (type.source !== 'none' && !form.sourceId)} onClick={generate}>{busy ? 'Drafting…' : 'Generate draft'}</OpsButton>
      </div>
    </div>
  )
}

function PostQueue({ posts, data, onOpen }) {
  const columns = ['draft', 'approved', 'scheduled', 'published']
  return (
    <div className="panel">
      <div className="panel-head"><h3>Posts</h3></div>
      {posts.length === 0 ? <EmptyState icon="🗒" title="No posts yet" body="Generate your first draft above." /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))', gap: 12 }}>
          {columns.map((status) => {
            const list = posts.filter((post) => post.status === status)
            return (
              <section key={status} aria-label={STATUS[status][0]} style={{ background: OPS_COLORS.cream, borderRadius: 10, padding: 10 }}>
                <h4 style={{ margin: '0 0 8px', fontSize: 13, color: OPS_COLORS.emerald }}>{STATUS[status][0]} ({list.length})</h4>
                <div style={{ display: 'grid', gap: 8 }}>
                  {list.map((post) => (
                    <button key={post.id} type="button" onClick={() => onOpen(post.id)} style={{ ...cardStyle, padding: 10, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: OPS_COLORS.ink }}>{post.title || post.headline || 'Untitled'}</div>
                      <div style={{ fontSize: 12, color: OPS_COLORS.muted, marginTop: 3 }}>{data.contentTypes[post.content_type]?.label || post.content_type} · {data.templates[post.template]?.label}</div>
                      <div style={{ fontSize: 12, color: OPS_COLORS.muted }}>{(post.platforms || []).map((key) => PLATFORM_LABELS[key]).join(', ')}{post.scheduled_for ? ` · ${new Date(post.scheduled_for).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</div>
                    </button>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Post editor: edit text, swap images, preview, approve, export       */
/* ------------------------------------------------------------------ */
const editable = (post) => ({
  title: post.title || '', eyebrow: post.eyebrow || '', headline: post.headline || '', subhead: post.subhead || '', quote: post.quote || '', attribution: post.attribution || '', cta: post.cta || '',
  caption: post.caption || '', hashtags: (post.hashtags || []).join(' '), points: [...(post.points || []), '', '', ''].slice(0, 3), slides: post.slides || [], mediaId: post.media_id || '',
  template: post.template, formats: post.formats || [], platforms: post.platforms || [], sourceKind: post.source_kind, sourceId: post.source_id || '',
})

function PostEditor({ post, data, api, onChange, onClose, onDeleted, onNotice }) {
  const [form, setForm] = useState(() => editable(post))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [checks, setChecks] = useState(null)
  const [format, setFormat] = useState(post.formats?.[0] || 'portrait')
  const [slide, setSlide] = useState(0)
  const [preview, setPreview] = useState({ url: '', width: 0, height: 0, slides: 1, error: '' })
  const [scheduleAt, setScheduleAt] = useState('')
  const set = (changes) => { setForm((current) => ({ ...current, ...changes })); setDirty(true) }
  const draftShape = { content_type: post.content_type, template: form.template, platforms: form.platforms }
  const template = data.templates[form.template]
  const approved = post.status !== 'draft' && Boolean(post.approved_at)
  const sourceOptions = post.source_kind === 'event' ? data.events.map((event) => [event.id, event.title]) : post.source_kind === 'class' ? data.classes.map((item) => [item.id, item.name]) : []

  const runChecks = useCallback(async () => {
    try { setChecks(await api(`/api/social/posts/${post.id}/check`)) } catch { setChecks(null) }
  }, [api, post.id])
  useEffect(() => { runChecks() }, [runChecks, post.updated_at])

  useEffect(() => {
    let live = true
    let objectUrl = ''
    if (!post.formats?.includes(format)) return undefined
    api(`/api/social/posts/${post.id}/preview?format=${format}&slide=${slide}`, { blob: true }).then(async (response) => {
      const blob = await response.blob()
      objectUrl = URL.createObjectURL(blob)
      if (live) setPreview({ url: objectUrl, width: Number(response.headers.get('X-Image-Width')), height: Number(response.headers.get('X-Image-Height')), slides: Number(response.headers.get('X-Slide-Count')) || 1, error: '' })
    }).catch((previewError) => { if (live) setPreview({ url: '', width: 0, height: 0, slides: 1, error: previewError.message }) })
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [api, post.id, post.updated_at, post.formats, format, slide])

  const save = async () => {
    setBusy('Saving…')
    setError('')
    try {
      const body = { ...form, hashtags: form.hashtags.split(/[\s,]+/).filter(Boolean), points: form.points.filter((point) => point.trim()), mediaId: form.mediaId || null }
      if (post.source_kind === 'none') { delete body.sourceKind; delete body.sourceId }
      const result = await api(`/api/social/posts/${post.id}`, { method: 'PATCH', body })
      onChange(result.post)
      setForm(editable(result.post))
      setDirty(false)
      if (approved && result.post.status === 'draft') onNotice('Saved. The post changed, so it is back in Draft and needs approving again.')
      if (!result.post.formats.includes(format)) setFormat(result.post.formats[0])
      return result.post
    } catch (saveError) {
      setError(saveError.message)
      return null
    } finally {
      setBusy('')
    }
  }

  const approve = async (confirmNames = false) => {
    setBusy('Checking…')
    setError('')
    try {
      const result = await api(`/api/social/posts/${post.id}/approve`, { method: 'POST', body: { confirmNames } })
      onChange(result.post)
      onNotice('Approved. You can now download the images and copy the caption.')
    } catch (approveError) {
      const details = approveError.details || {}
      if (details.needsNameConfirmation && window.confirm(`${approveError.message}\n\nPress OK only if you are sure this is not a child's name.`)) { setBusy(''); approve(true); return }
      setError([approveError.message, ...(details.problems || []), ...(details.findings?.blocks || []).map((item) => `${item.field}: "${item.excerpt}". ${item.message}`)].join('\n'))
      runChecks()
    } finally {
      setBusy('')
    }
  }

  const setStatus = async (status) => {
    setError('')
    try {
      const result = await api(`/api/social/posts/${post.id}/status`, { method: 'POST', body: { status, scheduledFor: scheduleAt ? new Date(scheduleAt).toISOString() : undefined } })
      onChange(result.post)
    } catch (statusError) { setError(statusError.message) }
  }

  const download = async () => {
    setBusy('Preparing images…')
    setError('')
    try {
      for (const size of post.formats) {
        const first = await api(`/api/social/posts/${post.id}/export?format=${size}&slide=0`, { blob: true })
        const count = Number(first.headers.get('X-Slide-Count')) || 1
        for (let index = 0; index < count; index += 1) {
          const response = index === 0 ? first : await api(`/api/social/posts/${post.id}/export?format=${size}&slide=${index}`, { blob: true })
          const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '')?.[1] || `kada-${size}-${index + 1}.png`
          const url = URL.createObjectURL(await response.blob())
          const link = document.createElement('a')
          link.href = url
          link.download = name
          document.body.appendChild(link)
          link.click()
          link.remove()
          setTimeout(() => URL.revokeObjectURL(url), 2000)
        }
      }
    } catch (downloadError) { setError(downloadError.message) } finally { setBusy('') }
  }

  const copyCaption = async () => {
    try {
      const { caption } = await api(`/api/social/posts/${post.id}/caption`)
      await navigator.clipboard.writeText(caption)
      onNotice('Caption copied.')
    } catch (copyError) { setError(copyError.message) }
  }

  const remove = async () => {
    if (!window.confirm('Delete this post?')) return
    try { await api(`/api/social/posts/${post.id}`, { method: 'DELETE' }); onDeleted(post.id) } catch (removeError) { setError(removeError.message) }
  }

  const field = (key, label, { multiline = false, rows = 3, placeholder = '' } = {}) => (
    <div>
      <label style={labelStyle} htmlFor={`post-${key}`}>{label}</label>
      {multiline
        ? <textarea id={`post-${key}`} rows={rows} style={opsInputStyle} value={form[key]} placeholder={placeholder} onChange={(event) => set({ [key]: event.target.value })} />
        : <input id={`post-${key}`} style={opsInputStyle} value={form[key]} placeholder={placeholder} onChange={(event) => set({ [key]: event.target.value })} />}
    </div>
  )
  const blocks = checks?.findings?.blocks || []
  const names = checks?.findings?.nameMatches || []
  const problems = checks?.problems || []

  return (
    <div className="panel">
      <div className="panel-head" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{post.title || post.headline || 'Untitled post'} <Pill text={STATUS[post.status][0]} tone={STATUS[post.status][1]} /></h3>
        <OpsButton small variant="ghost" onClick={() => { if (!dirty || window.confirm('Discard unsaved changes?')) onClose() }}>← All posts</OpsButton>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <div>
              <label style={labelStyle} htmlFor="post-template">Template</label>
              <select id="post-template" style={opsInputStyle} value={form.template} onChange={(event) => set({ template: event.target.value, formats: data.templates[event.target.value].formats.slice(0, 1) })}>
                {Object.entries(data.templates).filter(([key]) => (key === 'class_poster') === (post.template === 'class_poster') && (key !== 'event_promo' || post.source_kind === 'event')).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
              </select>
            </div>
            {sourceOptions.length > 0 && (
              <div>
                <label style={labelStyle} htmlFor="post-source">{post.source_kind === 'event' ? 'Event' : 'Class'}</label>
                <select id="post-source" style={opsInputStyle} value={form.sourceId} onChange={(event) => set({ sourceId: event.target.value })}>
                  {sourceOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </div>
            )}
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={labelStyle}>Image sizes</legend>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {template.formats.map((key) => (
                <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  <input type="checkbox" checked={form.formats.includes(key)} onChange={(event) => set({ formats: event.target.checked ? [...form.formats, key] : form.formats.filter((item) => item !== key) })} /> {data.formats[key].label}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={labelStyle}>Platforms</legend>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {Object.entries(PLATFORM_LABELS).map(([key, label]) => (
                <label key={key} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  <input type="checkbox" disabled={post.content_type === 'corporate_team'} checked={form.platforms.includes(key)} onChange={(event) => set({ platforms: event.target.checked ? [...form.platforms, key] : form.platforms.filter((item) => item !== key) })} /> {label}
                </label>
              ))}
            </div>
          </fieldset>
          {field('title', 'Internal title')}
          {form.template === 'class_poster' ? (
            <p style={{ fontSize: 13, color: OPS_COLORS.muted, margin: 0 }}>Every word on the class poster comes from the class record (Operations &gt; Class schedule &gt; Poster details), and the QR code is made from its booking link. Edit them there.</p>
          ) : (
            <>
              {field('eyebrow', 'Eyebrow')}
              {field('headline', form.template === 'quote' ? 'Label' : 'Headline')}
              {form.template !== 'quote' && field('subhead', 'Sub-heading', { multiline: true, rows: 2 })}
              {form.template === 'quote' && field('quote', 'Quote (word for word)', { multiline: true })}
              {form.template === 'quote' && field('attribution', 'Attribution')}
              {form.template === 'event_promo' && field('cta', 'Button text')}
              {form.template === 'linkedin_card' && form.points.map((point, index) => (
                <div key={index}>
                  <label style={labelStyle} htmlFor={`post-point-${index}`}>Point {index + 1}</label>
                  <input id={`post-point-${index}`} style={opsInputStyle} value={point} onChange={(event) => set({ points: form.points.map((item, i) => i === index ? event.target.value : item) })} />
                </div>
              ))}
            </>
          )}
          {form.template !== 'carousel' && <MediaPicker media={data.media} post={draftShape} value={form.mediaId} onChange={(mediaId) => set({ mediaId: mediaId || '' })} />}
          {form.template === 'carousel' && (
            <div style={{ display: 'grid', gap: 10 }}>
              <span style={labelStyle}>Slides ({form.slides.length} of 10)</span>
              {form.slides.map((item, index) => (
                <div key={index} style={{ ...cardStyle, padding: 10, display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, color: OPS_COLORS.muted }}>
                    <span>Slide {index + 1}{index === 0 ? ' (cover)' : ''}</span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      {index > 0 && <OpsButton small variant="ghost" onClick={() => set({ slides: form.slides.map((s, i) => i === index - 1 ? form.slides[index] : i === index ? form.slides[index - 1] : s) })}>↑</OpsButton>}
                      <OpsButton small variant="danger" onClick={() => set({ slides: form.slides.filter((_, i) => i !== index) })}>Remove</OpsButton>
                    </span>
                  </div>
                  <input aria-label={`Slide ${index + 1} heading`} style={opsInputStyle} value={item.heading} onChange={(event) => set({ slides: form.slides.map((s, i) => i === index ? { ...s, heading: event.target.value } : s) })} />
                  <textarea aria-label={`Slide ${index + 1} text`} rows={2} style={opsInputStyle} value={item.body} onChange={(event) => set({ slides: form.slides.map((s, i) => i === index ? { ...s, body: event.target.value } : s) })} />
                  <MediaPicker label="Slide photo (optional)" media={data.media} post={draftShape} value={item.mediaId || ''} onChange={(mediaId) => set({ slides: form.slides.map((s, i) => i === index ? { ...s, mediaId: mediaId || undefined } : s) })} />
                </div>
              ))}
              {form.slides.length < 10 && <div><OpsButton small variant="ghost" onClick={() => set({ slides: [...form.slides, { heading: '', body: '' }] })}>+ Add slide</OpsButton></div>}
            </div>
          )}
          {field('caption', 'Caption', { multiline: true, rows: 7 })}
          {field('hashtags', 'Hashtags (space separated, no #)')}
          {error && <pre role="alert" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', color: OPS_COLORS.warn, fontSize: 13, margin: 0 }}>{error}</pre>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <OpsButton disabled={!dirty || Boolean(busy)} onClick={save}>{busy === 'Saving…' ? busy : approved ? 'Save (needs re-approval)' : 'Save changes'}</OpsButton>
            <OpsButton variant="danger" onClick={remove}>Delete post</OpsButton>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {(post.formats || []).map((key) => <OpsButton key={key} small variant={key === format ? 'primary' : 'ghost'} onClick={() => { setFormat(key); setSlide(0) }}>{data.formats[key].label.replace(/ \(.*\)/, '')}</OpsButton>)}
          </div>
          <div style={{ background: OPS_COLORS.cream, borderRadius: 10, padding: 10, textAlign: 'center' }}>
            {preview.error ? <p style={{ color: OPS_COLORS.warn, fontSize: 13 }}>{preview.error}</p> : preview.url ? <img src={preview.url} alt="Post preview" style={{ maxWidth: '100%', maxHeight: 560, display: 'block', margin: '0 auto', boxShadow: '0 2px 12px rgba(0,0,0,0.12)' }} /> : <p style={{ color: OPS_COLORS.muted, fontSize: 13 }}>Drawing preview…</p>}
            <div style={{ fontSize: 12, color: OPS_COLORS.muted, marginTop: 6 }}>{preview.width ? `${preview.width} × ${preview.height} px` : ''}{dirty ? ' · Save to update the preview' : ''}</div>
            {preview.slides > 1 && (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 8, alignItems: 'center' }}>
                <OpsButton small variant="ghost" disabled={slide === 0} onClick={() => setSlide(slide - 1)}>←</OpsButton>
                <span style={{ fontSize: 13 }}>Slide {slide + 1} of {preview.slides}</span>
                <OpsButton small variant="ghost" disabled={slide >= preview.slides - 1} onClick={() => setSlide(slide + 1)}>→</OpsButton>
              </div>
            )}
          </div>

          <div style={{ ...cardStyle, display: 'grid', gap: 8 }}>
            <strong style={{ fontFamily: OPS_SERIF, color: OPS_COLORS.emerald }}>Checks</strong>
            {!checks ? <span style={{ fontSize: 13, color: OPS_COLORS.muted }}>Checking…</span> : blocks.length + names.length + problems.length === 0 ? <span style={{ fontSize: 13, color: OPS_COLORS.okGreen }}>✓ Content rules, photo consent and placeholders all pass.</span> : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: OPS_COLORS.warn, display: 'grid', gap: 4 }}>
                {blocks.map((item, index) => <li key={`b${index}`}>{item.field}: “{item.excerpt}”. {item.message}</li>)}
                {names.map((name) => <li key={name} style={{ color: '#8a6d10' }}>“{name}” matches a child's first name on the register. Remove it, or confirm when approving that it isn't a child.</li>)}
                {problems.map((item, index) => <li key={`p${index}`}>{item}</li>)}
              </ul>
            )}
          </div>

          <div style={{ ...cardStyle, display: 'grid', gap: 10 }}>
            <strong style={{ fontFamily: OPS_SERIF, color: OPS_COLORS.emerald }}>Approval and export</strong>
            {post.status === 'draft' && (
              <>
                <p style={{ margin: 0, fontSize: 13, color: OPS_COLORS.muted }}>Nothing can be downloaded, copied, scheduled or marked published until someone approves it.</p>
                <div><OpsButton variant="gold" disabled={dirty || Boolean(busy)} onClick={() => approve(false)}>{busy === 'Checking…' ? busy : 'Approve post'}</OpsButton></div>
                {dirty && <span style={{ fontSize: 12, color: OPS_COLORS.muted }}>Save your changes first.</span>}
              </>
            )}
            {approved && (
              <>
                <p style={{ margin: 0, fontSize: 13, color: OPS_COLORS.muted }}>Approved {new Date(post.approved_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.{post.scheduled_for && post.status === 'scheduled' ? ` Scheduled for ${new Date(post.scheduled_for).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.` : ''}{post.published_at ? ` Published ${new Date(post.published_at).toLocaleDateString('en-GB')}.` : ''}</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <OpsButton variant="gold" disabled={Boolean(busy)} onClick={download}>{busy === 'Preparing images…' ? busy : 'Download images'}</OpsButton>
                  <OpsButton variant="ghost" onClick={copyCaption}>Copy caption</OpsButton>
                </div>
                {post.status !== 'published' && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input type="datetime-local" aria-label="Schedule for" style={{ ...opsInputStyle, width: 'auto' }} value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} />
                    <OpsButton small variant="ghost" disabled={!scheduleAt} onClick={() => setStatus('scheduled')}>Schedule</OpsButton>
                    <OpsButton small onClick={() => setStatus('published')}>Mark as published</OpsButton>
                  </div>
                )}
                <div><OpsButton small variant="danger" onClick={() => setStatus('draft')}>Back to draft</OpsButton></div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Calendar                                                            */
/* ------------------------------------------------------------------ */
const postDate = (post) => post.published_at || post.scheduled_for || null

function CalendarView({ posts, onOpen }) {
  const [month, setMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1) })
  const cells = useMemo(() => {
    const start = new Date(month)
    start.setDate(1 - ((start.getDay() + 6) % 7)) // Monday-first grid
    return Array.from({ length: 42 }, (_, index) => { const day = new Date(start); day.setDate(start.getDate() + index); return day })
  }, [month])
  const key = (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
  const byDay = new Map()
  for (const post of posts) {
    const when = postDate(post)
    if (!when) continue
    const day = key(new Date(when))
    byDay.set(day, [...(byDay.get(day) || []), post])
  }
  const unscheduled = posts.filter((post) => post.status === 'approved' && !postDate(post))
  const shift = (delta) => setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1))
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <OpsButton small variant="ghost" onClick={() => shift(-1)}>←</OpsButton>
          <OpsButton small variant="ghost" onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)) }}>Today</OpsButton>
          <OpsButton small variant="ghost" onClick={() => shift(1)}>→</OpsButton>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(44px, 1fr))', gap: 4, minWidth: 320 }}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <div key={day} style={{ fontSize: 11, fontWeight: 700, color: OPS_COLORS.muted, textAlign: 'center' }}>{day}</div>)}
          {cells.map((day) => {
            const inMonth = day.getMonth() === month.getMonth()
            const list = byDay.get(key(day)) || []
            const today = key(day) === key(new Date())
            return (
              <div key={key(day)} style={{ minHeight: 76, background: inMonth ? OPS_COLORS.ivory : OPS_COLORS.cream, border: `1px solid ${today ? OPS_COLORS.gold : OPS_COLORS.rule}`, borderRadius: 6, padding: 4 }}>
                <div style={{ fontSize: 11, color: inMonth ? OPS_COLORS.ink : OPS_COLORS.muted }} aria-label={`${DAY_NAMES[day.getDay()]} ${day.getDate()}`}>{day.getDate()}</div>
                {list.map((post) => (
                  <button key={post.id} type="button" onClick={() => onOpen(post.id)} title={post.title || post.headline} style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, borderRadius: 4, marginTop: 3, padding: '2px 4px', fontSize: 11, fontFamily: 'inherit', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: post.status === 'published' ? '#e6f0e9' : '#faf1d9', color: post.status === 'published' ? OPS_COLORS.okGreen : '#8a6d10' }}>
                    {new Date(postDate(post)).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} {post.title || post.headline}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      </div>
      <p style={{ fontSize: 12, color: OPS_COLORS.muted }}>Gold: scheduled. Green: published. Only approved posts can be scheduled.</p>
      {unscheduled.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <h4 style={{ fontSize: 13, color: OPS_COLORS.emerald, margin: '0 0 6px' }}>Approved, not scheduled yet</h4>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{unscheduled.map((post) => <OpsButton key={post.id} small variant="ghost" onClick={() => onOpen(post.id)}>{post.title || post.headline}</OpsButton>)}</div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Settings: the two approved research statements (admin only)         */
/* ------------------------------------------------------------------ */
function SettingsView({ data, api, onSaved }) {
  const [statements, setStatements] = useState(() => [...data.settings.researchStatements, '', ''].slice(0, 2))
  const [status, setStatus] = useState('')
  const save = async () => {
    try {
      const result = await api('/api/social/settings', { method: 'PUT', body: { researchStatements: statements.filter((item) => item.trim()) } })
      onSaved(result.settings)
      setStatus('Saved.')
    } catch (saveError) { setStatus(saveError.message) }
  }
  return (
    <div className="panel">
      <div className="panel-head"><h3>Drafting rules</h3></div>
      <ul style={{ fontSize: 13, lineHeight: 1.6, color: OPS_COLORS.ink, marginTop: 0 }}>
        <li>Never promise productivity gains.</li>
        <li>Never say attention drops after a set number of minutes.</li>
        <li>No weight loss, calorie or health outcome claims.</li>
        <li>Never name a child (checked against first names on the register).</li>
        <li>Research may only be cited with one of the two approved statements below, word for word.</li>
      </ul>
      <p style={{ fontSize: 13, color: OPS_COLORS.muted }}>These rules are checked when a draft is generated, every time a post is saved, and again on approval.</p>
      {[0, 1].map((index) => (
        <div key={index} style={{ marginBottom: 12 }}>
          <label style={labelStyle} htmlFor={`research-${index}`}>Approved research statement {index + 1}</label>
          <textarea id={`research-${index}`} rows={2} disabled={!data.isAdmin} style={opsInputStyle} value={statements[index]} onChange={(event) => setStatements(statements.map((item, i) => i === index ? event.target.value : item))} />
        </div>
      ))}
      {data.isAdmin ? <OpsButton onClick={save}>Save statements</OpsButton> : <p style={{ fontSize: 13, color: OPS_COLORS.muted }}>Only an admin can change these.</p>}
      {status && <p role="status" style={{ fontSize: 13 }}>{status}</p>}
    </div>
  )
}

export default SocialStudioPage
