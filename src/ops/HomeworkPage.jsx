import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { OpsButton, Pill, EmptyState, OPS_COLORS, OPS_SERIF, opsInputStyle, fileToDataUrl } from './ui'
import { HomeworkContent, youtubeId, formatHomeworkDate } from './homeworkShared'

/* ------------------------------------------------------------------ */
/* Operations > Homework. Set a practice task for a whole class or     */
/* chosen children (each family is emailed once), then see per task    */
/* which families have ticked it off. For staff awareness only: no      */
/* scores, no grades. Access: the 'homework' staff permission.          */
/* ------------------------------------------------------------------ */

const setupMessage = 'Homework is not set up yet. Apply supabase/migrations/20260926_homework.sql in the Supabase SQL Editor.'
const friendly = (error) => (/homework_/.test(error?.message || '') ? setupMessage : error?.message || 'Something went wrong.')
const labelStyle = { display: 'block', fontSize: 12.5, fontWeight: 700, color: OPS_COLORS.emerald, marginBottom: 4 }

export function HomeworkPage({ session }) {
  const [tasks, setTasks] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [mode, setMode] = useState('list') // list | new | <task id>

  const load = async () => {
    const [taskResult, assignmentResult, completionResult] = await Promise.all([
      supabase.from('homework_tasks').select('*').order('created_at', { ascending: false }),
      supabase.from('homework_assignments').select('task_id,student_id,student_name,guardian_name,emailed_at,email_error'),
      supabase.from('homework_completions').select('task_id,student_id,marked_at'),
    ])
    const firstError = taskResult.error || assignmentResult.error || completionResult.error
    if (firstError) { setError(friendly(firstError)); setTasks([]); return }
    const done = new Map((completionResult.data || []).map((row) => [`${row.task_id}|${row.student_id}`, row.marked_at]))
    setError('')
    setTasks((taskResult.data || []).map((task) => {
      const assigned = (assignmentResult.data || []).filter((row) => row.task_id === task.id).map((row) => ({ ...row, doneAt: done.get(`${task.id}|${row.student_id}`) || null }))
      return { ...task, assigned, doneCount: assigned.filter((row) => row.doneAt).length }
    }))
  }
  useEffect(() => { load() }, [])

  const open = tasks?.find((task) => task.id === mode)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <h2 style={{ fontFamily: OPS_SERIF, color: OPS_COLORS.emerald, fontWeight: 400, margin: 0 }}>Homework</h2>
        {mode === 'list' ? <OpsButton onClick={() => { setNotice(''); setMode('new') }}>Set homework</OpsButton> : <OpsButton variant="ghost" onClick={() => { setMode('list'); load() }}>← All homework</OpsButton>}
      </div>
      {notice && <p role="status" style={{ background: '#e6f0e9', color: OPS_COLORS.okGreen, padding: '10px 12px', borderRadius: 6, fontSize: 14 }}>{notice}</p>}
      {error && <p role="alert" style={{ color: OPS_COLORS.warn }}>{error}</p>}

      {mode === 'new' && <NewTaskForm session={session} onCancel={() => setMode('list')} onCreated={(result) => { setNotice(summary(result)); load().then(() => setMode(result.task.id)) }} />}
      {open && <TaskDetail task={open} onDeleted={() => { setNotice(`"${open.title}" deleted.`); setMode('list'); load() }} />}
      {mode === 'list' && (tasks === null ? <p style={{ color: OPS_COLORS.muted }}>Loading…</p> : !tasks.length && !error ? (
        <EmptyState icon="📝" title="No homework set yet" body="Set a practice task for a class or chosen children. Families get an email and tick it off from their dashboard." ctaLabel="Set homework" onCta={() => setMode('new')} />
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
          {tasks.map((task) => (
            <li key={task.id}>
              <button type="button" onClick={() => setMode(task.id)} style={{ width: '100%', textAlign: 'left', background: OPS_COLORS.ivory, border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 10, padding: '12px 14px', fontFamily: 'inherit', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 15.5, color: OPS_COLORS.emerald }}>{task.title}</strong>
                  <span style={{ fontSize: 13, color: OPS_COLORS.ink }}><strong>{task.doneCount}</strong> of {task.assigned.length} done</span>
                </div>
                <div style={{ fontSize: 12.5, color: OPS_COLORS.muted, marginTop: 2 }}>
                  {task.class_name ? `${task.class_name} · ` : ''}{task.assigned.length} {task.assigned.length === 1 ? 'child' : 'children'} · set {formatHomeworkDate(task.created_at)}{task.created_by_name ? ` by ${task.created_by_name}` : ''}
                  {task.image_path ? ' · 🖼' : ''}{task.youtube_id ? ' · ▶' : ''}
                </div>
                <div aria-hidden="true" style={{ height: 6, borderRadius: 3, background: '#ebe5d4', marginTop: 8, overflow: 'hidden' }}>
                  <div style={{ width: `${task.assigned.length ? (task.doneCount / task.assigned.length) * 100 : 0}%`, height: '100%', background: OPS_COLORS.emerald }} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      ))}
    </div>
  )
}

function summary(result) {
  const failed = result.emailFailures?.length ? ` ${result.emailFailures.length} ${result.emailFailures.length === 1 ? 'family' : 'families'} couldn't be emailed (${result.emailFailures.map((item) => `${item.children}: ${item.reason}`).join('; ')}).` : ''
  return `Homework set for ${result.assigned} ${result.assigned === 1 ? 'child' : 'children'}; ${result.familiesEmailed} ${result.familiesEmailed === 1 ? 'family' : 'families'} emailed.${failed}`
}

function NewTaskForm({ session, onCancel, onCreated }) {
  const [form, setForm] = useState({ title: '', description: '', youtubeUrl: '' })
  const [image, setImage] = useState(null) // { blob, preview }
  const [classes, setClasses] = useState(null)
  const [className, setClassName] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [showPast, setShowPast] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const pickClass = (name, list = classes) => {
    setClassName(name)
    setSelected(new Set((list.find((item) => item.name === name)?.children || []).filter((child) => child.current).map((child) => child.id)))
  }

  useEffect(() => {
    fetch('/api/homework/children', { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Children could not be loaded.')
        setClasses(result.classes)
        if (result.classes[0]) pickClass(result.classes[0].name, result.classes)
      })
      .catch((loadError) => { setError(loadError.message); setClasses([]) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const children = classes?.find((item) => item.name === className)?.children || []
  const visibleChildren = children.filter((child) => showPast || child.current || selected.has(child.id))
  const currentChildren = children.filter((child) => child.current)
  const wholeClass = currentChildren.length > 0 && currentChildren.every((child) => selected.has(child.id)) && selected.size === currentChildren.length
  const videoId = form.youtubeUrl.trim() ? youtubeId(form.youtubeUrl) : ''
  const videoInvalid = form.youtubeUrl.trim() && !videoId

  const toggle = (id) => setSelected((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const pickImage = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const dataUrl = await fileToDataUrl(file, { maxWidth: 1400, format: 'jpeg', quality: 0.85 })
      setImage({ blob: await (await fetch(dataUrl)).blob(), preview: dataUrl })
      setError('')
    } catch (imageError) {
      setError(imageError.message)
    }
  }

  const submit = async () => {
    if (!form.title.trim()) { setError('Give the task a title.'); return }
    if (videoInvalid) { setError("That doesn't look like a YouTube video link."); return }
    if (!selected.size) { setError('Choose at least one child.'); return }
    setSaving(true)
    setError('')
    let imagePath = ''
    try {
      if (image) {
        imagePath = `${crypto.randomUUID()}/reference.jpg`
        const { error: uploadError } = await supabase.storage.from('homework-images').upload(imagePath, image.blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })
        if (uploadError) throw new Error(`The image could not be uploaded: ${uploadError.message}`)
      }
      const response = await fetch('/api/homework', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ ...form, imagePath, className: wholeClass || selected.size > 1 ? className : '', studentIds: [...selected] }) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'The homework could not be set.')
      onCreated(result)
    } catch (submitError) {
      if (imagePath) await supabase.storage.from('homework-images').remove([imagePath])
      setError(submitError.message)
      setSaving(false)
    }
  }

  return (
    <div className="panel" style={{ maxWidth: 720 }}>
      <div style={{ display: 'grid', gap: 14 }}>
        <label style={labelStyle}>Title<input value={form.title} maxLength={120} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Practise the chorus routine" style={{ ...opsInputStyle, marginTop: 4, fontSize: 16 }} /></label>
        <label style={labelStyle}>Instructions<textarea value={form.description} maxLength={4000} rows={5} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What to practise, how often, anything to look out for…" style={{ ...opsInputStyle, marginTop: 4, fontSize: 15, resize: 'vertical', fontWeight: 400 }} /></label>

        <div>
          <span style={labelStyle}>Reference image (optional)</span>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {image && <img src={image.preview} alt="Reference preview" style={{ width: 160, height: 100, objectFit: 'cover', borderRadius: 8, border: `1px solid ${OPS_COLORS.rule}` }} />}
            <label style={{ fontSize: 13, color: OPS_COLORS.emerald, fontWeight: 700, cursor: 'pointer', border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 6, padding: '8px 12px', background: OPS_COLORS.ivory }}>
              {image ? 'Replace image' : 'Upload image'}
              <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Reference image" onChange={pickImage} style={{ display: 'none' }} />
            </label>
            {image && <button type="button" onClick={() => setImage(null)} style={{ border: 0, background: 'none', color: OPS_COLORS.warn, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>Remove</button>}
          </div>
          <span style={{ fontSize: 11.5, color: OPS_COLORS.muted }}>A photo of a move or formation. Resized before upload; shown to families in the email and their dashboard.</span>
        </div>

        <label style={labelStyle}>YouTube link (optional)<input value={form.youtubeUrl} onChange={(event) => setForm({ ...form, youtubeUrl: event.target.value })} placeholder="https://youtu.be/…" inputMode="url" style={{ ...opsInputStyle, marginTop: 4, borderColor: videoInvalid ? OPS_COLORS.warn : OPS_COLORS.rule }} /></label>
        {videoInvalid && <span style={{ fontSize: 12.5, color: OPS_COLORS.warn, marginTop: -8 }}>That doesn't look like a YouTube video link. Use the link from the video's Share button.</span>}
        {videoId && <img src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`} alt="Video preview" style={{ width: 200, borderRadius: 8, marginTop: -6 }} />}

        <div>
          <span style={labelStyle}>Who is it for?</span>
          {classes === null ? <p style={{ color: OPS_COLORS.muted, margin: 0 }}>Loading children…</p> : !classes.length ? <p style={{ color: OPS_COLORS.muted, margin: 0 }}>No active children yet.</p> : (
            <>
              <select aria-label="Class" value={className} onChange={(event) => pickClass(event.target.value)} style={{ ...opsInputStyle, fontSize: 15 }}>
                {classes.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
              </select>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0 4px', fontSize: 13 }}>
                <strong style={{ color: OPS_COLORS.ink }}>{wholeClass ? `Whole class (${selected.size})` : `${selected.size} ${selected.size === 1 ? 'child' : 'children'} chosen`}</strong>
                <button type="button" onClick={() => setSelected(new Set(currentChildren.map((child) => child.id)))} style={linkButton}>Whole class</button>
                <button type="button" onClick={() => setSelected(new Set())} style={linkButton}>Clear</button>
                {children.some((child) => !child.current) && <label style={{ display: 'flex', gap: 6, alignItems: 'center', color: OPS_COLORS.muted }}><input type="checkbox" checked={showPast} onChange={(event) => setShowPast(event.target.checked)} />Show past Day Pass children</label>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 4 }}>
                {visibleChildren.map((child) => (
                  <label key={child.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 8, background: selected.has(child.id) ? '#e6f0e9' : OPS_COLORS.ivory, border: `1px solid ${OPS_COLORS.rule}`, fontSize: 14, cursor: 'pointer' }}>
                    <input type="checkbox" checked={selected.has(child.id)} onChange={() => toggle(child.id)} />
                    <span style={{ overflowWrap: 'anywhere' }}>{child.name}{!child.current && <span style={{ color: OPS_COLORS.muted, fontSize: 11.5 }}> · past Day Pass</span>}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        {error && <p role="alert" style={{ color: OPS_COLORS.warn, margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <OpsButton disabled={saving} onClick={submit}>{saving ? 'Setting homework…' : `Set homework & email ${selected.size ? 'families' : ''}`.trim()}</OpsButton>
          <OpsButton variant="ghost" onClick={onCancel}>Cancel</OpsButton>
        </div>
      </div>
    </div>
  )
}

const linkButton = { border: 0, background: 'none', padding: 0, color: OPS_COLORS.emerald, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }

function TaskDetail({ task, onDeleted }) {
  const [filter, setFilter] = useState('all')
  const rows = useMemo(() => [...task.assigned].sort((a, b) => Number(Boolean(a.doneAt)) - Number(Boolean(b.doneAt)) || a.student_name.localeCompare(b.student_name)), [task])
  const shown = rows.filter((row) => filter === 'all' || (filter === 'done' ? row.doneAt : !row.doneAt))

  const remove = async () => {
    if (!window.confirm(`Delete "${task.title}"? It disappears from every family's dashboard.`)) return
    const { error } = await supabase.from('homework_tasks').delete().eq('id', task.id)
    if (error) { window.alert(error.message); return }
    if (task.image_path) await supabase.storage.from('homework-images').remove([task.image_path])
    onDeleted()
  }

  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
      <div className="panel">
        <h3 style={{ margin: '0 0 2px', fontFamily: OPS_SERIF, fontWeight: 400, fontSize: 22, color: OPS_COLORS.emerald }}>{task.title}</h3>
        <p style={{ margin: '0 0 12px', fontSize: 12.5, color: OPS_COLORS.muted }}>{task.class_name ? `${task.class_name} · ` : ''}set {formatHomeworkDate(task.created_at)}{task.created_by_name ? ` by ${task.created_by_name}` : ''}</p>
        <HomeworkContent task={task} />
        <div style={{ marginTop: 16 }}><OpsButton small variant="danger" onClick={remove}>Delete task</OpsButton></div>
      </div>
      <div className="panel">
        <div className="panel-head" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h3>Who's done it</h3>
          <strong style={{ fontSize: 15 }}>{task.doneCount} of {task.assigned.length} done</strong>
        </div>
        <div role="tablist" aria-label="Filter" style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {[['all', 'Everyone'], ['todo', `Not yet (${task.assigned.length - task.doneCount})`], ['done', `Done (${task.doneCount})`]].map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)} style={{ borderRadius: 20, padding: '6px 12px', border: `1px solid ${filter === key ? OPS_COLORS.emerald : OPS_COLORS.rule}`, background: filter === key ? OPS_COLORS.emerald : OPS_COLORS.ivory, color: filter === key ? OPS_COLORS.ivory : OPS_COLORS.emerald, fontFamily: 'inherit', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>{label}</button>
          ))}
        </div>
        <table className="ops-table">
          <thead><tr><th>Child</th><th>Family</th><th>Status</th></tr></thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.student_id}>
                <td><strong>{row.student_name}</strong></td>
                <td>{row.guardian_name || 'Unknown'}{row.email_error && <div style={{ fontSize: 11.5, color: OPS_COLORS.warn }}>Not emailed: {row.email_error}</div>}</td>
                <td>{row.doneAt ? <span><Pill text="Done" tone="green" /> <span style={{ fontSize: 12, color: OPS_COLORS.muted }}>{new Date(row.doneAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></span> : <Pill text="Not yet" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
