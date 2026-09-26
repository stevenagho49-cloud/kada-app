import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { useSiteLogo } from './lib/useSiteLogo'
import { formatTierPrice } from './ops/EventsPage'
import { normalizePaymentLink } from './ops/PaymentLinksPage'

const emerald = '#0b3d2e'
const emeraldLight = '#145c40'
const gold = '#c9a227'
const cream = '#f6f3ea'
const ivory = '#fffdf8'
const ink = '#232323'
const muted = '#767066'
const rule = '#e4ddc9'
const serif = "'Iowan Old Style', 'Georgia', 'Times New Roman', serif"
const sans = "'Inter', -apple-system, 'Helvetica Neue', Arial, sans-serif"

const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '11px 12px', fontFamily: 'inherit', fontSize: 14,
  color: ink, border: `1px solid ${rule}`, borderRadius: 8, outline: 'none', background: ivory,
}
const labelStyle = { display: 'block', fontSize: 12, fontWeight: 700, color: emerald, marginBottom: 4 }

// Public payment page at /pay/<slug>: item, price, the admin's custom questions,
// then Stripe Checkout. Mirrors EventTicketPage's layout and success polling.
export function PaymentLinkPage({ slug, onBack }) {
  const logoUrl = useSiteLogo()
  const [link, setLink] = useState(null)
  const [loading, setLoading] = useState(true)
  const [buyerName, setBuyerName] = useState('')
  const [buyerEmail, setBuyerEmail] = useState('')
  const [answers, setAnswers] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // successState: 'loading' | 'found' | 'pending'
  const [successState, setSuccessState] = useState(null)
  const [successOrder, setSuccessOrder] = useState(null)

  const params = new URLSearchParams(window.location.search)
  const purchaseSuccess = params.get('purchase') === 'success'
  const sessionId = params.get('session_id') || ''

  useEffect(() => {
    let mounted = true
    if (!supabase) { setLoading(false); return undefined }
    // RLS only exposes active links, so a paused or unknown slug comes back empty.
    supabase.from('payment_links').select('*').eq('slug', slug).maybeSingle().then(({ data }) => {
      if (!mounted) return
      setLink(data ? normalizePaymentLink(data) : null)
      setLoading(false)
    })
    return () => { mounted = false }
  }, [slug])

  // After the Stripe redirect, poll for the webhook-recorded payment.
  useEffect(() => {
    if (!purchaseSuccess || !sessionId) return undefined
    setSuccessState('loading')
    let cancelled = false
    let attempts = 0
    const poll = async () => {
      attempts += 1
      try {
        const response = await fetch(`/api/stripe/payment-link-order/${encodeURIComponent(sessionId)}`)
        if (response.ok) {
          const result = await response.json()
          if (!cancelled) { setSuccessOrder(result.order); setSuccessState('found') }
          return
        }
      } catch { /* retry below */ }
      if (!cancelled && attempts < 10) window.setTimeout(poll, 1500)
      else if (!cancelled) setSuccessState('pending')
    }
    poll()
    return () => { cancelled = true }
  }, [purchaseSuccess, sessionId])

  const fields = (link?.fields || []).filter((field) => field.label.trim())
  const missing = fields.filter((field) => field.required && !String(answers[field.id] || '').trim())
  const canPay = Boolean(link && buyerName.trim() && /.+@.+\..+/.test(buyerEmail) && missing.length === 0 && !busy)

  const startCheckout = async (submitEvent) => {
    submitEvent.preventDefault()
    if (!canPay) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/stripe/create-payment-link-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, buyerName: buyerName.trim(), buyerEmail: buyerEmail.trim(), answers }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Checkout could not be started.')
      window.location.assign(result.url)
    } catch (checkoutError) {
      setError(checkoutError.message)
      setBusy(false)
    }
  }

  const shell = (children) => (
    <div style={{ minHeight: '100vh', background: cream, fontFamily: sans, color: ink }}>
      <header style={{ background: emerald, color: ivory }}>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={logoUrl} alt="King's Ark Dance Academy logo" style={{ width: 34, height: 34, objectFit: 'contain' }} />
            <div>
              <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 700, lineHeight: 1.1 }}>King's Ark</div>
              <div style={{ fontSize: 11.5, color: '#d5a443', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Dance Academy</div>
            </div>
          </div>
          <button type="button" onClick={onBack} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.35)', color: ivory, borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>← Back to site</button>
        </div>
      </header>
      <main style={{ maxWidth: 560, margin: '0 auto', padding: '32px 16px 64px' }}>{children}</main>
    </div>
  )
  const card = { background: ivory, border: `1px solid ${rule}`, borderRadius: 14, padding: 24 }

  if (purchaseSuccess) {
    return shell(
      <div style={card}>
        <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 10 }}>{successState === 'pending' ? '⏳' : '✅'}</div>
        <h1 style={{ fontFamily: serif, fontSize: 30, margin: '0 0 10px', textAlign: 'center', color: emerald }}>Payment received</h1>
        {successState === 'loading' && <p style={{ color: muted, textAlign: 'center' }}>Confirming your payment…</p>}
        {successState === 'pending' && <p style={{ color: muted, textAlign: 'center' }}>Thank you. Your payment is being finalised and a confirmation email is on its way.</p>}
        {successState === 'found' && successOrder && (
          <>
            <p style={{ color: muted, textAlign: 'center', marginTop: 0 }}>Thank you, {successOrder.buyerName.split(' ')[0]}. Here's what we've got down for you.</p>
            <div style={{ background: cream, border: `1px solid ${rule}`, borderRadius: 10, padding: 18, marginTop: 14 }}>
              <SummaryRow label="Item" value={successOrder.linkName} />
              {successOrder.answers.map((answer) => <SummaryRow key={answer.fieldId || answer.label} label={answer.label} value={answer.value} />)}
              <SummaryRow label="Amount paid" value={formatTierPrice(successOrder.amountPence)} bold />
              <SummaryRow label="Confirmation to" value={successOrder.buyerEmail} />
            </div>
          </>
        )}
      </div>,
    )
  }

  if (loading) return shell(<p style={{ color: muted }}>Loading…</p>)
  if (!link) {
    return shell(
      <div style={{ ...card, textAlign: 'center' }}>
        <div style={{ fontSize: 34, marginBottom: 8 }}>💳</div>
        <h1 style={{ fontFamily: serif, fontSize: 26, margin: '0 0 8px' }}>This payment page isn't available</h1>
        <p style={{ color: muted, margin: 0 }}>Payments may have closed, or the link is incorrect. Please contact King's Ark Dance Academy if you think this is a mistake.</p>
      </div>,
    )
  }

  return shell(
    <div style={card}>
      <h1 style={{ fontFamily: serif, fontSize: 34, lineHeight: 1.1, margin: '0 0 8px', color: emerald }}>{link.name}</h1>
      <div style={{ fontFamily: serif, fontSize: 26, fontWeight: 700, color: emerald, marginBottom: 12 }}>{formatTierPrice(link.pricePence)}</div>
      {link.description && <p style={{ lineHeight: 1.65, fontSize: 15, whiteSpace: 'pre-line', margin: '0 0 18px' }}>{link.description}</p>}
      <form onSubmit={startCheckout} style={{ borderTop: `1px solid ${rule}`, paddingTop: 18 }}>
        {fields.map((field) => (
          <label key={field.id} style={{ display: 'block', marginBottom: 12 }}>
            <span style={labelStyle}>{field.label}{field.required ? '' : <span style={{ color: muted, fontWeight: 500 }}> (optional)</span>}</span>
            {field.type === 'select' ? (
              <select style={inputStyle} value={answers[field.id] || ''} onChange={(inputEvent) => setAnswers({ ...answers, [field.id]: inputEvent.target.value })} required={field.required}>
                <option value="">Choose…</option>
                {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            ) : (
              <input style={inputStyle} maxLength={500} value={answers[field.id] || ''} onChange={(inputEvent) => setAnswers({ ...answers, [field.id]: inputEvent.target.value })} required={field.required} />
            )}
          </label>
        ))}
        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={labelStyle}>Your name</span>
          <input style={inputStyle} value={buyerName} onChange={(inputEvent) => setBuyerName(inputEvent.target.value)} placeholder="Full name" autoComplete="name" required />
        </label>
        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={labelStyle}>Email for confirmation</span>
          <input type="email" style={inputStyle} value={buyerEmail} onChange={(inputEvent) => setBuyerEmail(inputEvent.target.value)} placeholder="you@example.com" autoComplete="email" required />
        </label>
        {error && <p style={{ color: '#a3401f', fontSize: 13, margin: '0 0 10px' }}>{error}</p>}
        <button
          type="submit"
          disabled={!canPay}
          style={{ width: '100%', border: 'none', borderRadius: 10, padding: '13px 18px', fontFamily: 'inherit', fontSize: 15, fontWeight: 700, background: canPay ? gold : '#ddd6c2', color: emeraldLight, cursor: canPay ? 'pointer' : 'not-allowed' }}
        >
          {busy ? 'Taking you to secure checkout…' : `Pay ${formatTierPrice(link.pricePence)}`}
        </button>
        <p style={{ fontSize: 11.5, color: muted, textAlign: 'center', margin: '10px 0 0' }}>Secure payment by Stripe. A confirmation is emailed to you after payment.</p>
      </form>
    </div>,
  )
}

function SummaryRow({ label, value, bold = false }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: `1px solid ${rule}`, fontSize: 14 }}>
      <span style={{ color: muted, flexShrink: 0 }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 600, textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  )
}

export default PaymentLinkPage
