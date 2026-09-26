import { Fragment, useEffect, useMemo, useState } from 'react'
import { OpsButton, Pill, EmptyState, Toggle, OPS_COLORS, OPS_SERIF, opsInputStyle } from './ui'

/* ------------------------------------------------------------------ */
/* Arrears (Sales > Arrears). Everyone with an unpaid, sent invoice,    */
/* grouped by who owes it. The server emails a friendly reminder on day */
/* 3 overdue and a firmer one on day 10, then stops; anything past day  */
/* 10 is flagged here for personal follow-up. Overdue invoices never    */
/* pause, cancel or block a booking ,  that decision stays with staff.  */
/* ------------------------------------------------------------------ */

const money = (pence) => `£${(Number(pence || 0) / 100).toFixed(2)}`
const formatDate = (value) => (value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const formatDateTime = (value) => (value ? new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
const REMINDER_LABELS = { auto_friendly: 'Auto · friendly', auto_firm: 'Auto · firm', manual: 'Manual' }

function OverdueLabel({ days }) {
  if (days === null || days === undefined) return <span style={{ color: OPS_COLORS.muted }}>No due date</span>
  if (days <= 0) return <span style={{ color: OPS_COLORS.muted }}>{days === 0 ? 'Due today' : `Due in ${-days} day${days === -1 ? '' : 's'}`}</span>
  return <strong style={{ color: days > 10 ? OPS_COLORS.warn : days >= 3 ? '#8a6d10' : OPS_COLORS.ink }}>{days} day{days === 1 ? '' : 's'} overdue</strong>
}

export function ArrearsPage({ session }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [sortBy, setSortBy] = useState('overdue')
  const [followUpOnly, setFollowUpOnly] = useState(false)
  const [openKey, setOpenKey] = useState('')
  const [busy, setBusy] = useState('')
  const [reminderChoice, setReminderChoice] = useState({})
  const [showTemplates, setShowTemplates] = useState(false)

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
    try {
      setData(await authedFetch('/api/invoices/arrears'))
      setError('')
    } catch (loadError) {
      setError(loadError.message)
      setData((current) => current || { payers: [] })
    }
  }
  useEffect(() => { load() }, [])

  const payers = useMemo(() => {
    const list = (data?.payers || []).filter((payer) => !followUpOnly || payer.needsFollowUp)
    const overdue = (payer) => payer.maxDaysOverdue ?? -1e9
    return [...list].sort(sortBy === 'amount'
      ? (a, b) => b.amountPence - a.amountPence || overdue(b) - overdue(a)
      : (a, b) => overdue(b) - overdue(a) || b.amountPence - a.amountPence)
  }, [data, sortBy, followUpOnly])

  const totals = useMemo(() => {
    const all = data?.payers || []
    return {
      owed: all.reduce((sum, payer) => sum + payer.amountPence, 0),
      overdue: all.reduce((sum, payer) => sum + payer.overdueAmountPence, 0),
      payers: all.length,
      followUp: all.filter((payer) => payer.needsFollowUp).length,
    }
  }, [data])

  const sendReminder = async (invoice) => {
    const template = reminderChoice[invoice.id] || (invoice.daysOverdue >= (data?.schedule?.firmDay || 10) ? 'firm' : 'friendly')
    if (!window.confirm(`Email a ${template} reminder for ${invoice.invoiceNumber || 'this invoice'} to ${invoice.recipient}?`)) return
    setBusy(invoice.id)
    try {
      const result = await authedFetch(`/api/invoices/${encodeURIComponent(invoice.id)}/remind`, { method: 'POST', body: JSON.stringify({ template }) })
      setNotice(`Reminder sent to ${result.recipient}.`)
      await load()
    } catch (sendError) {
      setNotice(sendError.message)
    }
    setBusy('')
  }

  const runCheck = async () => {
    setBusy('run')
    try {
      const result = await authedFetch('/api/invoices/reminders/run', { method: 'POST' })
      const sent = (result.sent || []).filter((item) => item.sent).length
      const failed = (result.sent || []).filter((item) => !item.sent).length
      setNotice(result.error ? result.error : `Reminder check done: ${sent} reminder${sent === 1 ? '' : 's'} sent${failed ? `, ${failed} failed` : ''}.`)
      await load()
    } catch (runError) {
      setNotice(runError.message)
    }
    setBusy('')
  }

  const copyPayLink = async (invoice) => {
    try { await navigator.clipboard.writeText(invoice.payUrl) } catch { window.prompt('Copy this pay link:', invoice.payUrl) }
    setNotice(`Pay link for ${invoice.invoiceNumber || 'the invoice'} copied.`)
  }

  const sortHeader = (key, label) => (
    <button type="button" onClick={() => setSortBy(key)} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', textTransform: 'inherit', letterSpacing: 'inherit', cursor: 'pointer', fontWeight: sortBy === key ? 800 : 'inherit' }}>
      {label} {sortBy === key ? '↓' : ''}
    </button>
  )

  const schedule = data?.schedule || { friendlyFromDay: 3, firmDay: 10 }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontFamily: OPS_SERIF, color: OPS_COLORS.emerald, fontWeight: 400, margin: '0 0 4px' }}>Arrears</h2>
          <p style={{ color: OPS_COLORS.muted, margin: '0 0 14px', maxWidth: 640, fontSize: 13.5 }}>
            Unpaid invoices by who owes them. Reminders go out automatically on day {schedule.friendlyFromDay} overdue (friendly) and day {schedule.firmDay} (firmer), then stop; anything later is flagged for a personal follow-up. Being overdue never pauses or cancels a booking.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <OpsButton small variant="ghost" onClick={() => setShowTemplates((value) => !value)}>{showTemplates ? 'Hide reminder emails' : 'Reminder emails'}</OpsButton>
          <OpsButton small variant="ghost" disabled={busy === 'run'} onClick={runCheck}>{busy === 'run' ? 'Checking…' : 'Run reminder check now'}</OpsButton>
        </div>
      </div>

      {error && <p style={{ color: OPS_COLORS.warn }}>{error}</p>}
      {notice && <p style={{ background: '#faf1d9', color: '#6b5310', padding: '8px 12px', borderRadius: 6, fontSize: 13.5 }}>{notice} <button type="button" onClick={() => setNotice('')} style={{ border: 0, background: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 700 }}>×</button></p>}

      {showTemplates && <ReminderTemplates authedFetch={authedFetch} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, margin: '6px 0 16px' }}>
        {[
          ['Outstanding', money(totals.owed)],
          ['Overdue', money(totals.overdue)],
          ['Owing', `${totals.payers} ${totals.payers === 1 ? 'account' : 'accounts'}`],
          ['Needs personal follow-up', String(totals.followUp)],
        ].map(([label, value]) => (
          <div key={label} style={{ background: OPS_COLORS.ivory, border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: OPS_COLORS.muted, fontWeight: 700 }}>{label}</div>
            <div style={{ fontFamily: OPS_SERIF, fontSize: 22, color: label.startsWith('Needs') && totals.followUp ? OPS_COLORS.warn : OPS_COLORS.emerald }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="panel">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <label style={{ fontSize: 13, color: OPS_COLORS.muted }}>Sort by{' '}
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} style={{ ...opsInputStyle, width: 'auto', padding: '6px 9px' }}>
              <option value="overdue">Most overdue</option>
              <option value="amount">Highest amount</option>
            </select>
          </label>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: OPS_COLORS.muted }}><Toggle label="Needs follow-up only" checked={followUpOnly} onChange={setFollowUpOnly} />Needs follow-up only</span>
        </div>
        {data === null ? <p style={{ color: OPS_COLORS.muted }}>Loading…</p> : !payers.length ? (
          <EmptyState icon="✅" title={followUpOnly ? 'Nobody needs following up' : 'No outstanding invoices'} body={followUpOnly ? 'No invoice is more than 10 days overdue.' : 'Every sent invoice has been paid.'} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Who owes</th>
                  <th>{sortHeader('amount', 'Amount owed')}</th>
                  <th>{sortHeader('overdue', 'Days overdue')}</th>
                  <th>Reminders sent</th>
                  <th>Follow-up</th>
                </tr>
              </thead>
              <tbody>
                {payers.map((payer) => (
                  <Fragment key={payer.key}>
                    <tr onClick={() => setOpenKey(openKey === payer.key ? '' : payer.key)} style={{ cursor: 'pointer' }}>
                      <td>
                        <div style={{ fontWeight: 700, color: OPS_COLORS.emerald }}>{openKey === payer.key ? '▾' : '▸'} {payer.name}</div>
                        <div style={{ fontSize: 11.5, color: OPS_COLORS.muted }}>{payer.kind === 'school' ? 'School' : payer.kind === 'family' ? 'Family' : 'Contact'}{payer.email ? ` · ${payer.email}` : ' · no email'} · {payer.invoices.length} invoice{payer.invoices.length === 1 ? '' : 's'}</div>
                      </td>
                      <td><strong>{money(payer.amountPence)}</strong>{payer.overdueAmountPence > 0 && payer.overdueAmountPence !== payer.amountPence && <div style={{ fontSize: 11.5, color: OPS_COLORS.muted }}>{money(payer.overdueAmountPence)} overdue</div>}</td>
                      <td><OverdueLabel days={payer.maxDaysOverdue} /></td>
                      <td>{payer.remindersSent}</td>
                      <td>{payer.needsFollowUp ? <Pill text="Needs personal follow-up" tone="red" /> : <span style={{ color: OPS_COLORS.muted }}>No</span>}</td>
                    </tr>
                    {openKey === payer.key && (
                      <tr>
                        <td colSpan={5} style={{ background: '#fbf9f2' }}>
                          {payer.invoices.map((invoice) => (
                            <div key={invoice.id} style={{ borderTop: `1px solid ${OPS_COLORS.rule}`, padding: '10px 0', display: 'grid', gridTemplateColumns: 'minmax(200px, 1.3fr) minmax(200px, 1fr) minmax(220px, auto)', gap: 12, alignItems: 'start' }}>
                              <div>
                                <div style={{ fontWeight: 700 }}>{invoice.invoiceNumber || 'Not numbered'} · {money(invoice.amountPence)}</div>
                                <div style={{ fontSize: 12, color: OPS_COLORS.muted }}>{invoice.description}{invoice.workshopDate ? ` · workshop ${formatDate(invoice.workshopDate)}` : ''}</div>
                                <div style={{ fontSize: 12, marginTop: 2 }}>Sent {formatDate(invoice.sentAt) || 'date unknown'} · due {formatDate(invoice.dueDate) || 'not set'} · <OverdueLabel days={invoice.daysOverdue} /></div>
                                {invoice.needsFollowUp && <div style={{ marginTop: 4 }}><Pill text="Needs personal follow-up" tone="red" /></div>}
                              </div>
                              <div style={{ fontSize: 12 }}>
                                {invoice.reminders.length ? invoice.reminders.map((reminder) => (
                                  <div key={`${reminder.kind}-${reminder.at}`} style={{ color: reminder.status === 'sent' ? OPS_COLORS.ink : OPS_COLORS.warn }}>
                                    {REMINDER_LABELS[reminder.kind]} ({reminder.template}) · {formatDateTime(reminder.at)}{reminder.status !== 'sent' ? ` · ${reminder.status}` : ''}
                                  </div>
                                )) : <span style={{ color: OPS_COLORS.muted }}>No reminders yet</span>}
                              </div>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                <select aria-label="Reminder wording" value={reminderChoice[invoice.id] || (invoice.daysOverdue >= schedule.firmDay ? 'firm' : 'friendly')} onChange={(event) => setReminderChoice((current) => ({ ...current, [invoice.id]: event.target.value }))} style={{ ...opsInputStyle, width: 'auto', padding: '5px 8px', fontSize: 12 }}>
                                  <option value="friendly">Friendly</option>
                                  <option value="firm">Firm</option>
                                </select>
                                <OpsButton small disabled={busy === invoice.id || !invoice.recipient} onClick={() => sendReminder(invoice)}>{busy === invoice.id ? 'Sending…' : 'Send reminder'}</OpsButton>
                                <OpsButton small variant="ghost" onClick={() => copyPayLink(invoice)}>Copy pay link</OpsButton>
                              </div>
                            </div>
                          ))}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function ReminderTemplates({ authedFetch }) {
  const [state, setState] = useState(null)
  const [draft, setDraft] = useState(null)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    authedFetch('/api/invoices/reminder-templates')
      .then((result) => { setState(result); setDraft(result.templates) })
      .catch((loadError) => setMessage(loadError.message))
  }, [])

  if (!draft) return <div className="panel"><p style={{ color: message ? OPS_COLORS.warn : OPS_COLORS.muted }}>{message || 'Loading reminder emails…'}</p></div>
  const edit = (key, field) => (event) => setDraft((current) => ({ ...current, [key]: { ...current[key], [field]: event.target.value } }))
  const save = async () => {
    setSaving(true)
    try {
      const result = await authedFetch('/api/invoices/reminder-templates', { method: 'POST', body: JSON.stringify(draft) })
      setDraft(result.templates)
      setMessage('Reminder wording saved.')
    } catch (saveError) {
      setMessage(saveError.message)
    }
    setSaving(false)
  }

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>Reminder emails</h3>
      <p style={{ color: OPS_COLORS.muted, fontSize: 13, marginTop: 0 }}>
        Placeholders: {state.placeholders.map((key) => <code key={key} style={{ marginRight: 6 }}>{`{{${key}}}`}</code>)}. A “Pay now” button and the invoice PDF are always added.{!state.canEdit && ' Only admins can change the wording.'}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        {[['friendly', 'Friendly (auto on day 3)'], ['firm', 'Firm (auto on day 10)']].map(([key, label]) => (
          <div key={key}>
            <h4 style={{ margin: '0 0 6px', color: OPS_COLORS.emerald }}>{label}</h4>
            <input aria-label={`${label} subject`} style={{ ...opsInputStyle, marginBottom: 8 }} value={draft[key].subject} onChange={edit(key, 'subject')} disabled={!state.canEdit} />
            <textarea aria-label={`${label} body`} rows={11} style={{ ...opsInputStyle, resize: 'vertical', lineHeight: 1.5 }} value={draft[key].body} onChange={edit(key, 'body')} disabled={!state.canEdit} />
            {state.canEdit && <button type="button" onClick={() => setDraft((current) => ({ ...current, [key]: state.defaults[key] }))} style={{ border: 0, background: 'none', padding: 0, marginTop: 4, color: OPS_COLORS.muted, cursor: 'pointer', fontSize: 12 }}>Reset to default wording</button>}
          </div>
        ))}
      </div>
      {state.canEdit && <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}><OpsButton disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save reminder wording'}</OpsButton>{message && <span style={{ fontSize: 13, color: OPS_COLORS.muted }}>{message}</span>}</div>}
    </div>
  )
}
