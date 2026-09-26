import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { OpsButton, EmptyState, OPS_COLORS, OPS_SERIF, opsInputStyle, fileToDataUrl } from './ui'

/* ------------------------------------------------------------------ */
/* Operations > Formations. Named stage layouts per class, built by     */
/* dragging children's tokens around a stage, plus a quick two-tap      */
/* swap. Child photos here are STAFF-INTERNAL: private bucket            */
/* 'formation-photos', signed URLs only, never shown to parents or on   */
/* the website, and unrelated to the website/social photo consent.      */
/* Access: the 'formations' staff permission (RLS on every table).      */
/* ------------------------------------------------------------------ */

const BUCKET = 'formation-photos'
const GRID_COLUMNS = 12
const GRID_ROWS = 8
const setupMessage = 'The formation planner is not set up yet. Apply supabase/migrations/20260926_formations.sql in the Supabase SQL Editor.'
const friendly = (error) => (/formation/.test(error?.message || '') && /does not exist|could not find/i.test(error?.message || '') ? setupMessage : error?.message || 'Something went wrong.')
const clamp = (value) => Math.min(0.97, Math.max(0.03, value))
const snap = (value, steps) => Math.round(value * steps - 0.5) / steps + 0.5 / steps
const firstName = (name) => (name || '').split(' ')[0]
const initials = (name) => (name || '?').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()

export function FormationsPage({ session }) {
  const [classes, setClasses] = useState(null)
  const [className, setClassName] = useState('')
  const [children, setChildren] = useState([])
  const [photos, setPhotos] = useState({}) // studentId -> { path, url }
  const [formations, setFormations] = useState([])
  const [formationId, setFormationId] = useState('')
  const [positions, setPositions] = useState({}) // studentId -> { x, y }
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [swapMode, setSwapMode] = useState(false)
  const [swapPick, setSwapPick] = useState('')
  const [snapToGrid, setSnapToGrid] = useState(true)
  const [nameDraft, setNameDraft] = useState(null) // { mode: 'new' | 'rename' | 'copy', value }
  const [showPhotos, setShowPhotos] = useState(false)
  const [drag, setDrag] = useState(null) // { id, x, y, moved }
  const stageRef = useRef(null)
  const benchRef = useRef(null)
  const pending = useRef(null)

  useEffect(() => {
    Promise.all([
      supabase.from('class_sessions').select('name,active').order('day_of_week').order('start_time'),
      supabase.from('formations').select('class_name'),
    ]).then(([scheduled, existing]) => {
      if (existing.error) setError(friendly(existing.error))
      const names = [...new Set([...(scheduled.data || []).filter((item) => item.active).map((item) => item.name), ...(existing.data || []).map((row) => row.class_name)])]
      setClasses(names)
      if (names[0]) setClassName(names[0])
    })
  }, [])

  const loadPhotos = useCallback(async (studentIds) => {
    if (!studentIds.length) { setPhotos({}); return }
    const { data: rows, error: photoError } = await supabase.from('formation_student_photos').select('student_id,storage_path').in('student_id', studentIds)
    if (photoError) { setError(friendly(photoError)); return }
    if (!rows?.length) { setPhotos({}); return }
    // Signed, short-lived URLs from the private bucket; nothing here is public.
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(rows.map((row) => row.storage_path), 3600)
    const urlByPath = new Map((signed || []).map((item) => [item.path, item.signedUrl]))
    setPhotos(Object.fromEntries(rows.map((row) => [row.student_id, { path: row.storage_path, url: urlByPath.get(row.storage_path) || '' }])))
  }, [])

  const loadClass = useCallback(async (name, keepFormation = '') => {
    const [roster, list] = await Promise.all([
      supabase.rpc('formation_class_students', { p_class: name }),
      supabase.from('formations').select('*').eq('class_name', name).order('created_at'),
    ])
    const firstError = roster.error || list.error
    if (firstError) { setError(friendly(firstError)); setChildren([]); setFormations([]); return }
    setError('')
    const kids = (roster.data || []).map((row) => ({ id: row.student_id, name: row.student_name }))
    setChildren(kids)
    setFormations(list.data || [])
    setFormationId((list.data || []).some((item) => item.id === keepFormation) ? keepFormation : list.data?.[0]?.id || '')
    loadPhotos(kids.map((kid) => kid.id))
  }, [loadPhotos])

  useEffect(() => { if (className) loadClass(className) }, [className, loadClass])

  useEffect(() => {
    if (!formationId) { setPositions({}); return }
    supabase.from('formation_positions').select('student_id,x,y').eq('formation_id', formationId).then(({ data, error: loadError }) => {
      if (loadError) { setError(friendly(loadError)); return }
      setPositions(Object.fromEntries((data || []).map((row) => [row.student_id, { x: Number(row.x), y: Number(row.y) }])))
    })
    setSwapPick('')
  }, [formationId])

  // Persist a batch of changes: { studentId: {x, y} } places, { studentId: null } benches.
  const save = async (changes) => {
    setPositions((current) => {
      const next = { ...current }
      for (const [id, pos] of Object.entries(changes)) {
        if (pos) next[id] = pos
        else delete next[id]
      }
      return next
    })
    setStatus('Saving…')
    const upserts = Object.entries(changes).filter(([, pos]) => pos).map(([id, pos]) => ({ formation_id: formationId, student_id: id, x: Number(pos.x.toFixed(4)), y: Number(pos.y.toFixed(4)), updated_at: new Date().toISOString() }))
    const removals = Object.entries(changes).filter(([, pos]) => !pos).map(([id]) => id)
    const results = await Promise.all([
      upserts.length ? supabase.from('formation_positions').upsert(upserts, { onConflict: 'formation_id,student_id' }) : { error: null },
      removals.length ? supabase.from('formation_positions').delete().eq('formation_id', formationId).in('student_id', removals) : { error: null },
      supabase.from('formations').update({ updated_at: new Date().toISOString() }).eq('id', formationId),
    ])
    const failed = results.find((result) => result.error)
    setStatus(failed ? `Not saved: ${friendly(failed.error)}` : 'Saved ✓')
  }

  const placeFromPointer = (clientX, clientY) => {
    const rect = stageRef.current.getBoundingClientRect()
    let x = clamp((clientX - rect.left) / rect.width)
    let y = clamp((clientY - rect.top) / rect.height)
    if (snapToGrid) { x = snap(x, GRID_COLUMNS); y = snap(y, GRID_ROWS) }
    return { x, y }
  }
  const inside = (element, clientX, clientY) => {
    if (!element) return false
    const rect = element.getBoundingClientRect()
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  }

  const tap = (id) => {
    if (!swapMode) return
    if (!swapPick) { setSwapPick(id); return }
    if (swapPick === id) { setSwapPick(''); return }
    const a = positions[swapPick] || null
    const b = positions[id] || null
    setSwapPick('')
    save({ [swapPick]: b, [id]: a })
  }

  // One pointer model for mouse and touch: movement past 6px is a drag,
  // anything less is a tap (used by swap mode).
  const onPointerDown = (event, id) => {
    if (event.button !== undefined && event.button !== 0) return
    // Stop a mouse drag from selecting text on the page (keyboard focus is unaffected).
    if (event.pointerType === 'mouse') event.preventDefault()
    pending.current = { id, startX: event.clientX, startY: event.clientY }
  }
  useEffect(() => {
    const move = (event) => {
      const start = pending.current
      if (!start) return
      const moved = Math.hypot(event.clientX - start.startX, event.clientY - start.startY) > 6
      if (moved || drag) {
        event.preventDefault()
        setDrag({ id: start.id, x: event.clientX, y: event.clientY, moved: true })
      }
    }
    const up = (event) => {
      const start = pending.current
      pending.current = null
      if (!start) return
      if (!drag) { tap(start.id); return }
      setDrag(null)
      if (inside(stageRef.current, event.clientX, event.clientY)) save({ [start.id]: placeFromPointer(event.clientX, event.clientY) })
      else if (inside(benchRef.current, event.clientX, event.clientY) && positions[start.id]) save({ [start.id]: null })
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  })

  const nudge = (event, id) => {
    const pos = positions[id]
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
    if (!pos || !step) return
    event.preventDefault()
    save({ [id]: { x: clamp(pos.x + step[0] / GRID_COLUMNS / (snapToGrid ? 1 : 2)), y: clamp(pos.y + step[1] / GRID_ROWS / (snapToGrid ? 1 : 2)) } })
  }

  // Put everyone still on the bench into rows from the back, in free grid slots.
  const placeRest = () => {
    const taken = new Set(Object.values(positions).map((pos) => `${Math.floor(pos.x * GRID_COLUMNS)}:${Math.floor(pos.y * GRID_ROWS)}`))
    const changes = {}
    let slot = 0
    for (const child of children.filter((kid) => !positions[kid.id])) {
      let col
      let row
      do {
        row = 1 + Math.floor(slot / 5) * 2
        col = 2 + (slot % 5) * 2
        slot += 1
      } while (taken.has(`${col}:${row}`) && slot < 200)
      changes[child.id] = { x: (col + 0.5) / GRID_COLUMNS, y: (Math.min(row, GRID_ROWS - 1) + 0.5) / GRID_ROWS }
    }
    if (Object.keys(changes).length) save(changes)
  }

  const submitName = async () => {
    const value = nameDraft.value.trim()
    if (!value) return
    if (nameDraft.mode === 'rename') {
      const { error: renameError } = await supabase.from('formations').update({ name: value, updated_at: new Date().toISOString() }).eq('id', formationId)
      if (renameError) { setError(renameError.code === '23505' ? `There's already a formation called "${value}".` : friendly(renameError)); return }
      setNameDraft(null)
      loadClass(className, formationId)
      return
    }
    const { data: created, error: createError } = await supabase.from('formations').insert({ class_name: className, name: value, created_by: session.user.id, created_by_name: session.user.email }).select('id').single()
    if (createError) { setError(createError.code === '23505' ? `There's already a formation called "${value}".` : friendly(createError)); return }
    if (nameDraft.mode === 'copy' && Object.keys(positions).length) {
      await supabase.from('formation_positions').insert(Object.entries(positions).map(([id, pos]) => ({ formation_id: created.id, student_id: id, x: pos.x, y: pos.y })))
    }
    setNameDraft(null)
    setError('')
    loadClass(className, created.id)
  }

  const deleteFormation = async () => {
    const formation = formations.find((item) => item.id === formationId)
    if (!formation || !window.confirm(`Delete the "${formation.name}" formation? Its layout is lost.`)) return
    const { error: deleteError } = await supabase.from('formations').delete().eq('id', formationId)
    if (deleteError) { setError(friendly(deleteError)); return }
    loadClass(className)
  }

  if (classes === null) return <p style={{ color: OPS_COLORS.muted }}>Loading…</p>
  const current = formations.find((item) => item.id === formationId)
  const bench = children.filter((kid) => !positions[kid.id])
  const onStage = children.filter((kid) => positions[kid.id])
  const dragged = drag && children.find((kid) => kid.id === drag.id)

  return (
    <div style={{ maxWidth: 960 }}>
      <h2 style={{ fontFamily: OPS_SERIF, color: OPS_COLORS.emerald, fontWeight: 400, margin: '0 0 4px' }}>Formations</h2>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: OPS_COLORS.muted }}>🔒 Staff only. Children's photos here are for planning and are never shown to parents or on the website.</p>
      {error && <p role="alert" style={{ background: '#f7e9e4', color: OPS_COLORS.warn, padding: '10px 12px', borderRadius: 6, fontSize: 14 }}>{error}</p>}
      {!classes.length ? <EmptyState icon="🗓" title="No classes scheduled" body="Add a class in Students > Class schedule first." /> : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <select aria-label="Class" value={className} onChange={(event) => setClassName(event.target.value)} style={{ ...opsInputStyle, width: 'auto', fontSize: 15 }}>
              {classes.map((name) => <option key={name}>{name}</option>)}
            </select>
            <OpsButton small variant="ghost" onClick={() => setShowPhotos((value) => !value)}>{showPhotos ? 'Hide photos' : `Children's photos (${Object.keys(photos).length}/${children.length})`}</OpsButton>
          </div>

          {showPhotos && <PhotoManager kids={children} photos={photos} session={session} onChanged={() => loadPhotos(children.map((kid) => kid.id))} onError={setError} />}

          <div role="tablist" aria-label="Formations" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            {formations.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={item.id === formationId} onClick={() => setFormationId(item.id)} style={{ borderRadius: 20, padding: '8px 14px', minHeight: 40, border: `1px solid ${item.id === formationId ? OPS_COLORS.emerald : OPS_COLORS.rule}`, background: item.id === formationId ? OPS_COLORS.emerald : OPS_COLORS.ivory, color: item.id === formationId ? OPS_COLORS.ivory : OPS_COLORS.emerald, fontFamily: 'inherit', fontWeight: 700, cursor: 'pointer' }}>{item.name}</button>
            ))}
            {!nameDraft && <OpsButton small variant="gold" onClick={() => setNameDraft({ mode: 'new', value: '' })}>+ New formation</OpsButton>}
          </div>
          {nameDraft && (
            <form onSubmit={(event) => { event.preventDefault(); submitName() }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <input autoFocus aria-label="Formation name" maxLength={60} value={nameDraft.value} onChange={(event) => setNameDraft({ ...nameDraft, value: event.target.value })} placeholder="e.g. Chorus" style={{ ...opsInputStyle, width: 220 }} />
              <OpsButton type="submit" small>{nameDraft.mode === 'rename' ? 'Rename' : nameDraft.mode === 'copy' ? 'Create copy' : 'Create'}</OpsButton>
              <OpsButton small variant="ghost" onClick={() => setNameDraft(null)}>Cancel</OpsButton>
            </form>
          )}

          {!current ? (
            !nameDraft && <EmptyState icon="💃" title="No formations for this class yet" body='Create one for each part of the routine, e.g. "Verse 1", "Chorus", "Finale".' ctaLabel="+ New formation" onCta={() => setNameDraft({ mode: 'new', value: '' })} />
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                <button type="button" aria-pressed={swapMode} onClick={() => { setSwapMode((value) => !value); setSwapPick('') }} style={{ minHeight: 40, borderRadius: 8, padding: '0 14px', border: `2px solid ${swapMode ? OPS_COLORS.gold : OPS_COLORS.rule}`, background: swapMode ? '#fbf1d3' : OPS_COLORS.ivory, color: '#6b5310', fontFamily: 'inherit', fontWeight: 700, cursor: 'pointer' }}>⇄ Swap{swapMode ? ' (on)' : ''}</button>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: OPS_COLORS.muted }}><input type="checkbox" checked={snapToGrid} onChange={(event) => setSnapToGrid(event.target.checked)} />Snap to grid</label>
                <span style={{ flex: 1 }} />
                {!nameDraft && <>
                  <OpsButton small variant="ghost" onClick={() => setNameDraft({ mode: 'rename', value: current.name })}>Rename</OpsButton>
                  <OpsButton small variant="ghost" onClick={() => setNameDraft({ mode: 'copy', value: `${current.name} (copy)` })}>Duplicate</OpsButton>
                  <OpsButton small variant="danger" onClick={deleteFormation}>Delete</OpsButton>
                </>}
              </div>
              <p role="status" style={{ margin: '0 0 8px', fontSize: 13, color: swapMode ? '#6b5310' : OPS_COLORS.muted, minHeight: 18 }}>
                {swapMode ? (swapPick ? `Now tap who ${firstName(children.find((kid) => kid.id === swapPick)?.name)} should swap with.` : 'Tap two children to swap their places.') : 'Drag children onto the stage. Drag back to the bench to take someone off.'}
                {status && <span style={{ float: 'right', color: status.startsWith('Not') ? OPS_COLORS.warn : OPS_COLORS.okGreen }}>{status}</span>}
              </p>

              <div ref={stageRef} data-testid="stage" aria-label={`Stage for ${current.name}`} style={{ position: 'relative', width: '100%', maxWidth: 'calc(60vh * 1.6)', margin: '0 auto', aspectRatio: '16 / 10', borderRadius: 14, overflow: 'hidden', backgroundColor: '#0b3d2e', backgroundImage: `linear-gradient(rgba(255,246,220,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,246,220,.07) 1px, transparent 1px), linear-gradient(180deg, #154a3a 0%, #0b3d2e 100%)`, backgroundSize: `${100 / GRID_COLUMNS}% ${100 / GRID_ROWS}%, ${100 / GRID_COLUMNS}% ${100 / GRID_ROWS}%, 100% 100%`, touchAction: 'none', userSelect: 'none' }}>
                <div aria-hidden="true" style={{ position: 'absolute', top: 6, left: 0, right: 0, textAlign: 'center', fontSize: 10.5, letterSpacing: '.18em', color: 'rgba(255,246,220,.45)', fontWeight: 700 }}>BACK OF STAGE</div>
                <div aria-hidden="true" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '4px 0', textAlign: 'center', fontSize: 10.5, letterSpacing: '.18em', color: '#0b3d2e', background: 'rgba(201,162,39,.85)', fontWeight: 800 }}>FRONT · AUDIENCE</div>
                {onStage.map((kid) => (
                  <Token key={kid.id} kid={kid} photo={photos[kid.id]?.url} style={{ position: 'absolute', left: `${positions[kid.id].x * 100}%`, top: `${positions[kid.id].y * 100}%`, transform: 'translate(-50%, -50%)' }} picked={swapPick === kid.id} faded={drag?.id === kid.id} onPointerDown={onPointerDown} onKeyDown={nudge} onDark />
                ))}
              </div>

              <div ref={benchRef} data-testid="bench" style={{ marginTop: 10, minHeight: 86, border: `2px dashed ${OPS_COLORS.rule}`, borderRadius: 12, padding: 10, background: OPS_COLORS.ivory }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <strong style={{ fontSize: 13, color: OPS_COLORS.emerald }}>Off stage ({bench.length})</strong>
                  {bench.length > 0 && <OpsButton small variant="ghost" onClick={placeRest}>Place everyone in rows</OpsButton>}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {bench.map((kid) => <Token key={kid.id} kid={kid} photo={photos[kid.id]?.url} picked={swapPick === kid.id} faded={drag?.id === kid.id} onPointerDown={onPointerDown} onKeyDown={nudge} />)}
                  {!children.length && <span style={{ fontSize: 13, color: OPS_COLORS.muted }}>No children enrolled in this class yet.</span>}
                </div>
              </div>
            </>
          )}
        </>
      )}
      {dragged && drag.moved && (
        <div aria-hidden="true" style={{ position: 'fixed', left: drag.x, top: drag.y, transform: 'translate(-50%, -50%) scale(1.1)', pointerEvents: 'none', zIndex: 80 }}>
          <Token kid={dragged} photo={photos[dragged.id]?.url} ghost />
        </div>
      )}
    </div>
  )
}

function Token({ kid, photo, style, picked, faded, ghost, onDark, onPointerDown, onKeyDown }) {
  return (
    <button
      type="button"
      data-student={kid.id}
      aria-label={kid.name}
      aria-pressed={picked || undefined}
      onPointerDown={onPointerDown ? (event) => onPointerDown(event, kid.id) : undefined}
      onKeyDown={onKeyDown ? (event) => onKeyDown(event, kid.id) : undefined}
      style={{ ...style, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, width: 64, padding: 0, border: 0, background: 'none', cursor: ghost ? 'grabbing' : 'grab', touchAction: 'none', opacity: faded ? 0.3 : 1, zIndex: picked ? 3 : 1, fontFamily: 'inherit' }}
    >
      <span style={{ width: 46, height: 46, borderRadius: '50%', overflow: 'hidden', display: 'grid', placeItems: 'center', background: '#e9dfc4', color: OPS_COLORS.emerald, fontWeight: 800, fontSize: 15, border: `3px solid ${picked ? OPS_COLORS.gold : '#fffdf8'}`, boxShadow: picked ? '0 0 0 3px rgba(201,162,39,.55)' : '0 2px 6px rgba(0,0,0,.25)' }}>
        {photo ? <img src={photo} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials(kid.name)}
      </span>
      <span style={{ maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5, fontWeight: 700, padding: '1px 6px', borderRadius: 10, background: onDark || ghost ? 'rgba(255,253,248,.92)' : 'transparent', color: OPS_COLORS.ink }}>{firstName(kid.name)}</span>
    </button>
  )
}

/* One internal reference photo per child: upload, replace, delete. */
function PhotoManager({ kids, photos, session, onChanged, onError }) {
  const [busy, setBusy] = useState('')

  const upload = async (kid, file) => {
    if (!file) return
    setBusy(kid.id)
    try {
      const dataUrl = await fileToDataUrl(file, { maxWidth: 480, format: 'jpeg', quality: 0.82 })
      const blob = await (await fetch(dataUrl)).blob()
      const path = `${kid.id}/${crypto.randomUUID()}.jpg`
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
      if (uploadError) throw uploadError
      const previous = photos[kid.id]?.path
      const { error: rowError } = await supabase.from('formation_student_photos').upsert({ student_id: kid.id, storage_path: path, uploaded_by: session.user.id, uploaded_at: new Date().toISOString() }, { onConflict: 'student_id' })
      if (rowError) { await supabase.storage.from(BUCKET).remove([path]); throw rowError }
      if (previous) await supabase.storage.from(BUCKET).remove([previous])
      onChanged()
    } catch (uploadError) {
      onError(`Photo for ${kid.name} not saved: ${friendly(uploadError)}`)
    }
    setBusy('')
  }

  const remove = async (kid) => {
    const photo = photos[kid.id]
    if (!photo || !window.confirm(`Delete ${kid.name}'s planning photo?`)) return
    setBusy(kid.id)
    const { error: storageError } = await supabase.storage.from(BUCKET).remove([photo.path])
    const { error: rowError } = await supabase.from('formation_student_photos').delete().eq('student_id', kid.id)
    if (storageError || rowError) onError(friendly(storageError || rowError))
    setBusy('')
    onChanged()
  }

  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-head"><h3>Children's planning photos</h3></div>
      <p style={{ margin: '0 0 10px', fontSize: 13, color: OPS_COLORS.muted }}>One reference photo per child so staff can tell who is who on the stage. Stored privately, visible only to staff with formation access, never to parents or on the website. This is separate from the website/social media photo consent.</p>
      {!kids.length ? <p style={{ color: OPS_COLORS.muted, margin: 0 }}>No children enrolled in this class yet.</p> : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {kids.map((kid) => (
            <li key={kid.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 10, background: OPS_COLORS.ivory }}>
              <span style={{ width: 44, height: 44, flexShrink: 0, borderRadius: '50%', overflow: 'hidden', display: 'grid', placeItems: 'center', background: '#e9dfc4', color: OPS_COLORS.emerald, fontWeight: 800 }}>
                {photos[kid.id]?.url ? <img src={photos[kid.id].url} alt={`${kid.name} planning photo`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials(kid.name)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, overflowWrap: 'anywhere' }}>{kid.name}</div>
                <div style={{ display: 'flex', gap: 10, fontSize: 12.5 }}>
                  <label style={{ color: OPS_COLORS.emerald, fontWeight: 700, cursor: 'pointer' }}>
                    {busy === kid.id ? 'Saving…' : photos[kid.id] ? 'Replace' : 'Upload'}
                    <input type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Photo for ${kid.name}`} disabled={busy === kid.id} onChange={(event) => upload(kid, event.target.files?.[0])} style={{ display: 'none' }} />
                  </label>
                  {photos[kid.id] && <button type="button" onClick={() => remove(kid)} style={{ border: 0, background: 'none', padding: 0, color: OPS_COLORS.warn, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5 }}>Delete</button>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
