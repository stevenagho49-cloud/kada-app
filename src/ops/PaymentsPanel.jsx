import { useEffect, useState } from 'react'
import { OpsButton, Pill, OPS_COLORS, opsInputStyle } from './ui'

/* ------------------------------------------------------------------ */
/* Operations dashboard > Payments. Two tabs, each with its count and   */
/* total: PENDING (invoices sent but not confirmed paid, e.g. a bank    */
/* transfer nobody has checked off yet) and PAID. Staff with the sales  */
/* permission confirm a pending payment here; admins also see class,    */
/* ticket and payment-link card payments under Paid.                    */
/* ------------------------------------------------------------------ */

const money = (pence) => `£${(Number(pence || 0) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const dateLabel = (value) => (value ? new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
const PERIODS = [{ days: 30, label: 'Last 30 days' }, { days: 90, label: 'Last 90 days' }, { days: 365, label: 'Last 12 months' }, { days: 0, label: 'All time' }]

export function PaymentsPanel({ session, onChanged }) {
  const [tab, setTab] = useState('pending')
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [marking, setMarking] = useState(null) // { item, amount, paidOn, method, note }
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)

  const request = async (path, body) => {
    const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${session.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || 'Request failed.')
    return result
  }

  useEffect(() => {
    let mounted = true
    request(`/api/payments?days=${days}`).then((result) => { if (mounted) { setData(result); setError('') } }).catch((loadError) => { if (mounted) setError(loadError.message) })
    return () => { mounted = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, refresh])

  const confirmPaid = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await request(`/api/payments/invoices/${encodeURIComponent(marking.item.id)}/mark-paid`, { amountPence: Math.round(Number(marking.amount) * 100), paidOn: marking.paidOn, method: marking.method, note: marking.note })
      setNotice(`${marking.item.reference} marked as paid (${money(result.amountPence)})${result.shortBy ? `, ${money(result.shortBy)} less than invoiced` : ''}.`)
      setMarking(null)
      setRefresh((value) => value + 1)
      onChanged?.()
    } catch (saveError) {
      setError(saveError.message)
    }
    setBusy(false)
  }

  const undo = async (item) => {
    if (!window.confirm(`Move ${item.reference} back to pending? Use this if it was marked paid by mistake.`)) return
    try {
      await request(`/api/payments/invoices/${encodeURIComponent(item.id)}/mark-unpaid`, {})
      setNotice(`${item.reference} moved back to pending.`)
      setRefresh((value) => value + 1)
      onChanged?.()
    } catch (undoError) {
      setError(undoError.message)
    }
  }

  const list = data ? data[tab] : null
  const tabButton = (key, label, summary) => (
    <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} style={{ flex: 1, textAlign: 'left', border: `1px solid ${tab === key ? OPS_COLORS.emerald : OPS_COLORS.rule}`, background: tab === key ? '#eef6f1' : OPS_COLORS.ivory, borderRadius: 10, padding: '12px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: OPS_COLORS.muted, fontWeight: 700 }}>{label}</div>
      <strong style={{ display: 'block', fontSize: 22, color: key === 'pending' ? '#8a6d10' : OPS_COLORS.emerald }}>{summary ? money(summary.totalPence) : '…'}</strong>
      <span style={{ fontSize: 12.5, color: OPS_COLORS.muted }}>{summary ? `${summary.count} payment${summary.count === 1 ? '' : 's'}` : 'Loading'}</span>
    </button>
  )

  return (
    <div className="panel" data-panel="payments">
      <div className="panel-head">
        <h3>Payments</h3>
        {tab === 'paid' && <select aria-label="Paid period" style={{ ...opsInputStyle, width: 'auto' }} value={days} onChange={(event) => setDays(Number(event.target.value))}>{PERIODS.map((period) => <option key={period.days} value={period.days}>{period.label}</option>)}</select>}
      </div>
      <div role="tablist" style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        {tabButton('pending', 'Pending: not yet confirmed', data?.pending)}
        {tabButton('paid', `Paid${days ? ` · ${PERIODS.find((period) => period.days === days)?.label.toLowerCase()}` : ' · all time'}`, data?.paid)}
      </div>
      {error && <p role="alert" style={{ color: OPS_COLORS.warn, fontSize: 13 }}>{error}</p>}
      {notice && <p role="status" style={{ color: '#2e6b47', fontSize: 13 }}>{notice}</p>}
      <p style={{ fontSize: 12.5, color: OPS_COLORS.muted, margin: '0 0 10px' }}>
        {tab === 'pending'
          ? 'Invoices sent and not yet confirmed as paid. When a bank transfer (or other payment) arrives, mark it paid here. Card payments through Pay now confirm themselves.'
          : data?.paid.scope === 'invoices' ? 'Invoice payments confirmed online or by your team.' : 'Confirmed payments: invoices (online or marked paid), class bookings, event tickets and payment links.'}
      </p>

      {marking && (
        <div style={{ border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 8, padding: 14, marginBottom: 12, background: '#fffdf8' }}>
          <strong style={{ color: OPS_COLORS.emerald }}>Confirm payment: {marking.item.reference} · {marking.item.payer}</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 10 }}>
            <label><span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, marginBottom: 4 }}>Amount received (£)</span><input type="number" min="0" step="0.01" style={opsInputStyle} value={marking.amount} onChange={(event) => setMarking({ ...marking, amount: event.target.value })} /></label>
            <label><span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, marginBottom: 4 }}>Date received</span><input type="date" max={todayIso()} style={opsInputStyle} value={marking.paidOn} onChange={(event) => setMarking({ ...marking, paidOn: event.target.value })} /></label>
            <label><span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, marginBottom: 4 }}>Paid by</span><select style={opsInputStyle} value={marking.method} onChange={(event) => setMarking({ ...marking, method: event.target.value })}>{Object.entries(data?.methods || {}).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label><span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, marginBottom: 4 }}>Note (optional)</span><input style={opsInputStyle} placeholder="e.g. bank ref" value={marking.note} onChange={(event) => setMarking({ ...marking, note: event.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <OpsButton small disabled={busy || marking.amount === '' || !marking.paidOn} onClick={confirmPaid}>{busy ? 'Saving…' : 'Confirm as paid'}</OpsButton>
            <OpsButton small variant="ghost" onClick={() => setMarking(null)}>Cancel</OpsButton>
          </div>
        </div>
      )}

      {!list ? <p style={{ color: OPS_COLORS.muted, fontSize: 13 }}>{error ? '' : 'Loading…'}</p> : list.items.length === 0 ? <p style={{ color: OPS_COLORS.muted, fontSize: 13 }}>{tab === 'pending' ? 'Nothing waiting. Every sent invoice is paid.' : 'No payments in this period.'}</p> : (
        <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
          <table className="ops-table">
            <thead><tr><th>Payment</th><th>From</th><th>Amount</th><th>{tab === 'pending' ? 'Due' : 'Paid'}</th><th /></tr></thead>
            <tbody>
              {list.items.map((item) => (
                <tr key={`${item.source}-${item.id}`} data-payment={item.id}>
                  <td><strong style={{ color: OPS_COLORS.emerald }}>{item.reference}</strong><div style={{ fontSize: 12, color: OPS_COLORS.muted }}>{item.description}</div></td>
                  <td style={{ fontSize: 13 }}>{item.payer}</td>
                  <td style={{ fontWeight: 700 }}>{money(item.amountPence)}</td>
                  <td style={{ fontSize: 12.5 }}>
                    {tab === 'pending'
                      ? <>{dateLabel(item.dueDate)}{' '}<Pill text={item.daysOverdue > 0 ? `${item.daysOverdue}d overdue` : 'Not due yet'} tone={item.daysOverdue > 0 ? 'red' : 'gold'} /></>
                      : <>{dateLabel(item.paidAt)}<div style={{ color: OPS_COLORS.muted }}>{item.method}{item.markedBy ? ` · by ${item.markedBy}` : ''}{item.note ? ` · ${item.note}` : ''}</div></>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {tab === 'pending' && <OpsButton small onClick={() => { setNotice(''); setMarking({ item, amount: (item.amountPence / 100).toFixed(2), paidOn: todayIso(), method: 'bank_transfer', note: '' }) }}>Mark as paid</OpsButton>}
                    {tab === 'paid' && item.canUndo && <OpsButton small variant="ghost" onClick={() => undo(item)}>Undo</OpsButton>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default PaymentsPanel
