/* Parent dashboard homework. Tasks, assignments and done-marks are read and
   written with the parent's own login: row-level security only returns tasks
   set for their own children and only lets them tick those. */
import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { HomeworkContent, formatHomeworkDate } from './ops/homeworkShared'

const emerald = '#0b3d2e'
const muted = '#767066'
const serif = "'Iowan Old Style', Georgia, 'Times New Roman', serif"
const firstName = (name) => (name || '').split(' ')[0]

export function useParentHomework(enabled = true) {
  const [state, setState] = useState({ tasks: null, error: '' })
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!enabled) return undefined
    let active = true
    Promise.all([
      supabase.from('homework_tasks').select('id,title,description,image_path,youtube_id,class_name,created_at').order('created_at', { ascending: false }),
      supabase.from('homework_assignments').select('task_id,student_id,student_name'),
      supabase.from('homework_completions').select('task_id,student_id,marked_at'),
    ]).then(([tasks, assignments, completions]) => {
      if (!active) return
      if (tasks.error || assignments.error || completions.error) { setState({ tasks: [], error: 'Homework could not be loaded right now.' }); return }
      const done = new Map((completions.data || []).map((row) => [`${row.task_id}|${row.student_id}`, row.marked_at]))
      setState({
        error: '',
        tasks: (tasks.data || []).map((task) => ({
          ...task,
          children: (assignments.data || []).filter((row) => row.task_id === task.id).map((row) => ({ id: row.student_id, name: row.student_name, doneAt: done.get(`${task.id}|${row.student_id}`) || null })),
        })).filter((task) => task.children.length),
      })
    })
    return () => { active = false }
  }, [enabled, version])
  return { ...state, reload: () => setVersion((value) => value + 1) }
}

export const outstandingHomework = (tasks) => (tasks || []).filter((task) => task.children.some((child) => !child.doneAt))

export function HomeworkDuePanel({ tasks, onOpen }) {
  const todo = outstandingHomework(tasks)
  if (!todo.length) return null
  return (
    <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <div aria-hidden="true" style={{ fontSize: 30 }}>📝</div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontFamily: serif, fontSize: 20, color: emerald }}>{todo.length} practice {todo.length === 1 ? 'task' : 'tasks'} to do</div>
        <div style={{ fontSize: 13, color: muted }}>Latest: {todo[0].title}</div>
      </div>
      <button type="button" onClick={onOpen} style={{ border: `1px solid ${emerald}`, background: 'transparent', color: emerald, borderRadius: 8, padding: '9px 14px', fontFamily: 'inherit', fontWeight: 700, cursor: 'pointer' }}>Open homework</button>
    </div>
  )
}

export function HomeworkList({ tasks, error, session, onChanged }) {
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  if (tasks === null) return <div className="panel"><p style={{ color: muted }}>Loading homework…</p></div>
  if (error) return <div className="panel"><p style={{ color: '#a3401f' }}>{error}</p></div>
  if (!tasks.length) {
    return (
      <div className="panel" style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div aria-hidden="true" style={{ fontSize: 36 }}>📝</div>
        <h3 style={{ fontFamily: serif, fontWeight: 400, color: emerald, fontSize: 22, margin: '10px 0 6px' }}>No homework yet</h3>
        <p style={{ color: muted, maxWidth: 420, margin: '0 auto', lineHeight: 1.6 }}>When a teacher sets something to practise at home, it appears here and we'll email you too.</p>
      </div>
    )
  }

  const setDone = async (task, child, done) => {
    const key = `${task.id}|${child.id}`
    setBusy(key)
    setMessage('')
    const { error: saveError } = done
      ? await supabase.from('homework_completions').insert({ task_id: task.id, student_id: child.id, marked_by: session.user.id })
      : await supabase.from('homework_completions').delete().match({ task_id: task.id, student_id: child.id })
    setBusy('')
    if (saveError && saveError.code !== '23505') setMessage(`That couldn't be saved: ${saveError.message}`)
    onChanged()
  }

  const todo = outstandingHomework(tasks)
  const finished = tasks.filter((task) => !todo.includes(task))
  const section = (title, list) => list.length > 0 && (
    <section style={{ marginBottom: 22 }}>
      <h3 style={{ fontFamily: serif, fontWeight: 400, color: emerald, fontSize: 22, margin: '0 0 10px' }}>{title}</h3>
      <div style={{ display: 'grid', gap: 14 }}>
        {list.map((task) => (
          <article key={task.id} className="panel" style={{ margin: 0 }}>
            <div style={{ fontSize: 12, color: muted }}>Set {formatHomeworkDate(task.created_at)}{task.class_name ? ` · ${task.class_name}` : ''}{task.children.length === 1 ? ` · for ${firstName(task.children[0].name)}` : ''}</div>
            <h4 style={{ fontFamily: serif, fontWeight: 500, color: emerald, fontSize: 22, margin: '4px 0 12px', lineHeight: 1.25 }}>{task.title}</h4>
            <HomeworkContent task={task} />
            <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
              {task.children.map((child) => {
                const key = `${task.id}|${child.id}`
                const who = task.children.length > 1 ? ` for ${firstName(child.name)}` : ''
                return child.doneAt ? (
                  <div key={child.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#e6f0e9', borderRadius: 10, padding: '10px 14px' }}>
                    <strong style={{ color: '#2e6b47' }}>✓ Done{who}</strong>
                    <span style={{ fontSize: 13, color: muted }}>{new Date(child.doneAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}</span>
                    <button type="button" disabled={busy === key} onClick={() => setDone(task, child, false)} style={{ marginLeft: 'auto', border: 0, background: 'none', color: muted, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, minHeight: 36 }}>Undo</button>
                  </div>
                ) : (
                  <button key={child.id} type="button" disabled={busy === key} onClick={() => setDone(task, child, true)} style={{ minHeight: 52, borderRadius: 10, border: 0, background: emerald, color: '#fffdf8', fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer', opacity: busy === key ? 0.6 : 1 }}>
                    {busy === key ? 'Saving…' : `Mark as done${who}`}
                  </button>
                )
              })}
            </div>
          </article>
        ))}
      </div>
    </section>
  )

  return (
    <div>
      {message && <p role="alert" style={{ color: '#a3401f' }}>{message}</p>}
      {section('To do', todo)}
      {section('Done', finished)}
    </div>
  )
}
