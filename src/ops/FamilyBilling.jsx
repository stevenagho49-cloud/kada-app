import { useEffect, useMemo, useState } from 'react'
import { OpsButton, OPS_COLORS, OPS_SERIF, opsInputStyle } from './ui'

/* ------------------------------------------------------------------ */
/* Family billing (Sales > Arrears and Sales > Subscriptions):          */
/*  - Create arrears: bill a parent directly for an amount, a reason    */
/*    and the month(s) it covers. Emailed with Pay now, then it behaves */
/*    like any other unpaid invoice.                                    */
/*  - Send subscription request: email an existing parent a link        */
/*    straight to Stripe Checkout for a recurring plan.                 */
/* ------------------------------------------------------------------ */

const money = (pence) => `£${(Number(pence || 0) / 100).toFixed(2)}`
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Same wording as the server: "September, October 2026".
export function monthsLabel(months = []) {
  const sorted = [...new Set(months)].sort()
  const name = (month) => MONTH_NAMES[Number(month.slice(5, 7)) - 1]
  if (new Set(sorted.map((month) => month.slice(0, 4))).size <= 1) return sorted.length ? `${sorted.map(name).join(', ')} ${sorted[0].slice(0, 4)}` : ''
  return sorted.map((month) => `${name(month)} ${month.slice(0, 4)}`).join(', ')
}

const hasLiveSubscription = (family) => Boolean(family?.stripe_subscription_id) && family.membership_status === 'active'
const familyOption = (family) => `${family.guardian_name || 'Family'} · ${family.guardian_email || 'no email'}`
const sortedFamilies = (families) => [...families].sort((a, b) => String(a.guardian_name || '').localeCompare(String(b.guardian_name || '')))

export function useAuthedFetch(session) {
  return async (path, options = {}) => {
    const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...(options.headers || {}) } })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || 'Request failed.')
    return result
  }
}

function BillingModal({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, padding: 16, overflowY: 'auto', background: 'rgba(20,18,10,.45)' }}>
      <div role="dialog" aria-label={title} onClick={(event) => event.stopPropagation()} style={{ maxWidth: 560, margin: '24px auto', background: '#fffdf8', borderRadius: 10, border: `1px solid ${OPS_COLORS.rule}`, boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${OPS_COLORS.rule}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontFamily: OPS_SERIF, color: OPS_COLORS.emerald, fontWeight: 400 }}>{title}</h3>
          <button type="button" aria-label="Close" onClick={onClose} style={{ border: 0, background: 'none', cursor: 'pointer', fontSize: 18, color: OPS_COLORS.muted }}>×</button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: OPS_COLORS.ink, marginBottom: 5 }}>{label}</span>
      {children}
      {hint && <span style={{ display: 'block', fontSize: 11.5, color: OPS_COLORS.muted, marginTop: 4 }}>{hint}</span>}
    </label>
  )
}

// Month chips: the last 12 months and the next 3, grouped by year.
function MonthPicker({ value, onChange }) {
  const years = useMemo(() => {
    const now = new Date()
    const months = []
    for (let offset = -12; offset <= 3; offset += 1) {
      const date = new Date(now.getFullYear(), now.getMonth() + offset, 1)
      months.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`)
    }
    return [...new Set(months.map((month) => month.slice(0, 4)))].map((year) => [year, months.filter((month) => month.startsWith(year))])
  }, [])
  const toggle = (month) => onChange(value.includes(month) ? value.filter((item) => item !== month) : [...value, month].sort())
  return (
    <div>
      {years.map(([year, months]) => (
        <div key={year} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ width: 38, fontSize: 12, color: OPS_COLORS.muted, fontWeight: 700 }}>{year}</span>
          {months.map((month) => {
            const selected = value.includes(month)
            return (
              <button key={month} type="button" aria-pressed={selected} aria-label={`${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${year}`} onClick={() => toggle(month)} style={{ border: `1px solid ${selected ? OPS_COLORS.emerald : OPS_COLORS.rule}`, background: selected ? OPS_COLORS.emerald : '#fff', color: selected ? '#fffdf8' : OPS_COLORS.ink, borderRadius: 999, padding: '4px 10px', fontSize: 12.5, cursor: 'pointer', fontWeight: selected ? 700 : 400 }}>
                {MONTH_NAMES[Number(month.slice(5, 7)) - 1].slice(0, 3)}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export function CreateArrearsModal({ session, families, initialFamilyId = '', onClose, onCreated }) {
  const authedFetch = useAuthedFetch(session)
  const defaultDue = useMemo(() => new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), [])
  const [form, setForm] = useState({ familyId: initialFamilyId, amount: '', reason: '', months: [], dueDate: defaultDue })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const family = families.find((item) => item.id === form.familyId)
  const amountPence = Math.round(Number(form.amount) * 100)
  const ready = family?.guardian_email && amountPence >= 30 && form.reason.trim() && form.months.length

  const submit = async (event) => {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await authedFetch('/api/invoices/arrears/manual', { method: 'POST', body: JSON.stringify({ familyId: form.familyId, amount: Number(form.amount), reason: form.reason.trim(), months: form.months, dueDate: form.dueDate }) })
      onCreated(result)
    } catch (submitError) {
      setError(submitError.message)
      setBusy(false)
    }
  }

  return (
    <BillingModal title="Create arrears" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Parent / family">
          <select style={opsInputStyle} value={form.familyId} onChange={(event) => setForm({ ...form, familyId: event.target.value })} required>
            <option value="">Choose a family…</option>
            {sortedFamilies(families).map((item) => <option key={item.id} value={item.id} disabled={!item.guardian_email}>{familyOption(item)}</option>)}
          </select>
        </Field>
        <Field label="Amount owed (£)">
          <input style={opsInputStyle} type="number" inputMode="decimal" min="0.30" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="50.00" required />
        </Field>
        <Field label="Reason" hint="Shown to the parent in the email, on the invoice and in their account.">
          <textarea style={{ ...opsInputStyle, minHeight: 70, resize: 'vertical' }} maxLength={300} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="e.g. Unpaid class fees" required />
        </Field>
        <div style={{ marginBottom: 14 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: OPS_COLORS.ink, marginBottom: 6 }}>Months covered</span>
          <MonthPicker value={form.months} onChange={(months) => setForm({ ...form, months })} />
          <span style={{ display: 'block', fontSize: 11.5, color: form.months.length ? OPS_COLORS.ink : OPS_COLORS.muted, marginTop: 2 }}>{form.months.length ? monthsLabel(form.months) : 'Choose one or more months.'}</span>
        </div>
        <Field label="Due date" hint="Automatic reminders go out 3 and 10 days after this date if it's still unpaid.">
          <input style={opsInputStyle} type="date" min={new Date().toISOString().slice(0, 10)} value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} required />
        </Field>
        {ready && (
          <p style={{ background: '#faf6ec', border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 6, padding: '9px 12px', fontSize: 13, margin: '0 0 12px' }}>
            {family.guardian_name || 'The parent'} ({family.guardian_email}) will be emailed <strong>{money(amountPence)}</strong> for {monthsLabel(form.months)}, with a Pay now link and the invoice attached.
          </p>
        )}
        {error && <p style={{ color: OPS_COLORS.warn, fontSize: 13, margin: '0 0 12px' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <OpsButton variant="ghost" onClick={onClose}>Cancel</OpsButton>
          <OpsButton type="submit" disabled={!ready || busy}>{busy ? 'Sending…' : 'Create and email parent'}</OpsButton>
        </div>
      </form>
    </BillingModal>
  )
}

export function SubscriptionRequestModal({ session, families, initialFamilyId = '', onClose, onSent }) {
  const authedFetch = useAuthedFetch(session)
  const [plans, setPlans] = useState(null)
  const [discountCodes, setDiscountCodes] = useState([])
  const [form, setForm] = useState({ familyId: initialFamilyId, planType: '', discountCode: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    authedFetch('/api/admin/subscription-requests')
      .then((result) => { setPlans(result.plans); setDiscountCodes(result.discountCodes || []); setForm((current) => ({ ...current, planType: current.planType || result.plans?.[0]?.planType || '' })) })
      .catch((loadError) => { setPlans([]); setError(loadError.message) })
  }, [])

  // Priced per child: how many children this family has on file, and the
  // total with the chosen discount code (worked out by the server).
  const [quote, setQuote] = useState(null)
  useEffect(() => {
    if (!form.familyId) return
    setError('')
    authedFetch(`/api/admin/subscription-requests/quote?familyId=${encodeURIComponent(form.familyId)}&discountCode=${encodeURIComponent(form.discountCode)}`)
      .then((result) => setQuote({ familyId: form.familyId, discountCode: form.discountCode, children: result.children, plans: result.plans }))
      .catch((loadError) => setError(loadError.message))
  }, [form.familyId, form.discountCode])

  const family = families.find((item) => item.id === form.familyId)
  const plan = (plans || []).find((item) => item.planType === form.planType)
  const current = quote?.familyId === form.familyId && quote.discountCode === form.discountCode ? quote : null
  const children = current ? current.children : null
  const priced = current?.plans?.find((item) => item.planType === form.planType)
  const ready = family?.guardian_email && !hasLiveSubscription(family) && plan?.available && children > 0 && priced
  const childrenLabel = (count) => `${count} ${count === 1 ? 'child' : 'children'}`

  const submit = async (event) => {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError('')
    try {
      onSent(await authedFetch('/api/admin/subscription-requests', { method: 'POST', body: JSON.stringify(form) }))
    } catch (submitError) {
      setError(submitError.message)
      setBusy(false)
    }
  }

  return (
    <BillingModal title="Send subscription request" onClose={onClose}>
      <form onSubmit={submit}>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: OPS_COLORS.muted }}>For a parent already in the system who hasn't set up recurring billing. They get an email with a button that goes straight to Stripe's secure checkout; once they finish, their membership shows as active here.</p>
        <Field label="Parent / family">
          <select style={opsInputStyle} value={form.familyId} onChange={(event) => setForm({ ...form, familyId: event.target.value })} required>
            <option value="">Choose a family…</option>
            {sortedFamilies(families).map((item) => <option key={item.id} value={item.id} disabled={!item.guardian_email || hasLiveSubscription(item)}>{familyOption(item)}{hasLiveSubscription(item) ? ' (already subscribed)' : ''}</option>)}
          </select>
        </Field>
        <div style={{ marginBottom: 14 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: OPS_COLORS.ink, marginBottom: 6 }}>Plan</span>
          {plans === null ? <span style={{ fontSize: 13, color: OPS_COLORS.muted }}>Loading plans…</span> : plans.map((item) => (
            <label key={item.planType} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, marginBottom: 4 }}>
              <input type="radio" name="plan" checked={form.planType === item.planType} disabled={!item.available} onChange={() => setForm({ ...form, planType: item.planType })} />
              <span><strong>{item.label}</strong> · {money(item.pricePence)}/{item.interval} per child{children > 0 ? ` · ${childrenLabel(children)} = ${money(item.pricePence * children)}/${item.interval}` : ''}{!item.available ? ' (Stripe not configured)' : ''}</span>
            </label>
          ))}
        </div>
        <Field label="Discount code (optional)">
          <select style={opsInputStyle} value={form.discountCode} onChange={(event) => setForm({ ...form, discountCode: event.target.value })}>
            <option value="">No discount</option>
            {discountCodes.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.label}{item.membershipDuration === 'forever' ? ' every month' : ' first month'}{item.description ? ` · ${item.description}` : ''}</option>)}
          </select>
        </Field>
        {family && children === 0 && <p style={{ color: OPS_COLORS.warn, fontSize: 13, margin: '0 0 12px' }}>This family has no children on their account yet. The membership is priced per child, so add their children first.</p>}
        {ready && (
          <p style={{ background: '#faf6ec', border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 6, padding: '9px 12px', fontSize: 13, margin: '0 0 12px' }}>
            {family.guardian_name || 'The parent'} ({family.guardian_email}) will be emailed a link to start the <strong>{plan.label}</strong> for {childrenLabel(children)} at <strong>{money(priced.subtotalPence)}/{plan.interval}</strong> ({money(plan.pricePence)} per child).
            {priced.discount && priced.discountPence > 0 && <> With <strong>{priced.discount.code}</strong> ({priced.discount.label}) they pay <strong>{money(priced.totalPence)}</strong> {priced.discount.membershipDuration === 'forever' ? `a ${plan.interval}` : `for the first ${plan.interval}, then ${money(priced.laterPence)}/${plan.interval}`}. The code is already applied when they open Stripe checkout.</>}
          </p>
        )}
        {error && <p style={{ color: OPS_COLORS.warn, fontSize: 13, margin: '0 0 12px' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <OpsButton variant="ghost" onClick={onClose}>Cancel</OpsButton>
          <OpsButton type="submit" disabled={!ready || busy}>{busy ? 'Sending…' : 'Send request'}</OpsButton>
        </div>
      </form>
    </BillingModal>
  )
}
