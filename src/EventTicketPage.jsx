import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { normalizeEvent, formatTierPrice, formatEventTimeRange, flyerPublicUrl } from './ops/EventsPage'

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

function formatEventDate(value) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'Date to be announced'
}

export function EventTicketPage({ eventId, onBack }) {
  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [selectedTierId, setSelectedTierId] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [buyerName, setBuyerName] = useState('')
  const [buyerEmail, setBuyerEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // successState: null (no redirect) | 'loading' | 'found' | 'pending'
  const [successState, setSuccessState] = useState(null)
  const [successOrder, setSuccessOrder] = useState(null)

  const params = new URLSearchParams(window.location.search)
  const ticketSuccess = params.get('ticket') === 'success'
  const sessionId = params.get('session_id') || ''

  useEffect(() => {
    let mounted = true
    if (!supabase) { setNotFound(true); setLoading(false); return undefined }
    supabase.from('events').select('*').eq('id', eventId).eq('status', 'published').maybeSingle().then(({ data, error: loadError }) => {
      if (!mounted) return
      if (loadError || !data) {
        setNotFound(true)
      } else {
        const normalized = normalizeEvent(data)
        setEvent(normalized)
        if (normalized.ticketTiers.length) setSelectedTierId(normalized.ticketTiers[0].id)
      }
      setLoading(false)
    })
    return () => { mounted = false }
  }, [eventId])

  // After the Stripe redirect, poll for the webhook-recorded order (webhook can lag a second or two).
  useEffect(() => {
    if (!ticketSuccess || !sessionId) return undefined
    setSuccessState('loading')
    let cancelled = false
    let attempts = 0
    const poll = async () => {
      attempts += 1
      try {
        const response = await fetch(`/api/stripe/event-order/${encodeURIComponent(sessionId)}`)
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
  }, [ticketSuccess, sessionId])

  const selectedTier = event?.ticketTiers.find((tier) => tier.id === selectedTierId) || null
  const totalPence = selectedTier ? selectedTier.pricePence * quantity : 0
  const totalTickets = selectedTier ? selectedTier.bundleSize * quantity : 0
  const canBuy = Boolean(event?.ticketingEnabled && selectedTier && buyerName.trim() && /.+@.+\..+/.test(buyerEmail) && !busy)

  const startTicketCheckout = async (submitEvent) => {
    submitEvent.preventDefault()
    if (!canBuy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/stripe/create-event-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, tierId: selectedTierId, quantity, buyerName: buyerName.trim(), buyerEmail: buyerEmail.trim() }),
      })
      const result = await response.json()
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
        <div style={{ maxWidth: 1040, margin: '0 auto', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/images/logo.jpg" alt="King's Ark Dance Academy logo" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover' }} />
            <div>
              <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 700, lineHeight: 1.1 }}>King's Ark</div>
              <div style={{ fontSize: 11.5, color: '#d5a443', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Dance Academy</div>
            </div>
          </div>
          <button type="button" onClick={onBack} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.35)', color: ivory, borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>← Back to site</button>
        </div>
      </header>
      <main style={{ maxWidth: 1040, margin: '0 auto', padding: '36px 20px 64px' }}>{children}</main>
    </div>
  )

  if (loading) return shell(<p style={{ color: muted }}>Loading event…</p>)
  if (notFound || !event) {
    return shell(
      <div style={{ background: ivory, border: `1px solid ${rule}`, borderRadius: 14, padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 34, marginBottom: 8 }}>🎟</div>
        <h1 style={{ fontFamily: serif, fontSize: 26, margin: '0 0 8px' }}>This event isn't available</h1>
        <p style={{ color: muted, margin: 0 }}>It may have sold out, been taken down, or the link is incorrect.</p>
      </div>,
    )
  }

  if (ticketSuccess) {
    return shell(
      <div style={{ background: ivory, border: `1px solid ${rule}`, borderRadius: 14, padding: 32, maxWidth: 640, margin: '0 auto' }}>
        <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 10 }}>{successState === 'pending' ? '⏳' : '✅'}</div>
        <h1 style={{ fontFamily: serif, fontSize: 30, margin: '0 0 10px', textAlign: 'center', color: emerald }}>You're booked in!</h1>
        {successState === 'loading' && <p style={{ color: muted, textAlign: 'center' }}>Confirming your payment…</p>}
        {successState === 'pending' && (
          <p style={{ color: muted, textAlign: 'center' }}>Payment received — your confirmation is being finalised. A receipt will arrive by email from Stripe.</p>
        )}
        {successState === 'found' && successOrder && (
          <div>
            <p style={{ color: muted, textAlign: 'center', marginTop: 0 }}>Thank you, {successOrder.buyerName.split(' ')[0]}. Your tickets are confirmed.</p>
            <div style={{ background: cream, border: `1px solid ${rule}`, borderRadius: 10, padding: 18, marginTop: 14 }}>
              <SummaryRow label="Event" value={successOrder.eventTitle} />
              {successOrder.eventDate && <SummaryRow label="Date" value={formatEventDate(successOrder.eventDate)} />}
              {successOrder.location && <SummaryRow label="Venue" value={successOrder.location} />}
              <SummaryRow label="Ticket type" value={successOrder.tierName} />
              <SummaryRow label="Tickets" value={`${successOrder.tickets}`} />
              <SummaryRow label="Total paid" value={formatTierPrice(successOrder.totalPence)} bold />
              <SummaryRow label="Confirmation to" value={successOrder.buyerEmail} />
            </div>
          </div>
        )}
      </div>,
    )
  }

  return shell(
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr)', gap: 28, alignItems: 'start' }}>
      <div>
        {event.flyerPath && (
          <img src={flyerPublicUrl(event.flyerPath)} alt={`${event.title} flyer`} style={{ width: '100%', maxHeight: 380, objectFit: 'cover', borderRadius: 14, border: `1px solid ${rule}`, marginBottom: 18, display: 'block' }} />
        )}
        <div style={{ color: gold, fontSize: 12.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
          {formatEventDate(event.eventDate)}{formatEventTimeRange(event.eventTime, event.eventEndTime) ? ` · ${formatEventTimeRange(event.eventTime, event.eventEndTime)}` : ''}
        </div>
        <h1 style={{ fontFamily: serif, fontSize: 44, lineHeight: 1.05, margin: '0 0 14px', color: emerald }}>{event.title}</h1>
        {event.guestArtists && (
          <p style={{ fontSize: 15.5, margin: '0 0 12px' }}>Featuring <strong>{event.guestArtists}</strong></p>
        )}
        {event.location && (
          <p style={{ color: muted, margin: '0 0 14px', fontSize: 14.5 }}>
            📍 {event.location}
            {(event.mapUrl || event.location) && (
              <a href={event.mapUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`} target="_blank" rel="noreferrer" style={{ marginLeft: 10, color: emerald, fontWeight: 600, fontSize: 13 }}>
                Get directions ↗
              </a>
            )}
          </p>
        )}
        {event.description && <p style={{ color: ink, lineHeight: 1.65, fontSize: 15, whiteSpace: 'pre-line' }}>{event.description}</p>}
      </div>

      <div style={{ background: ivory, border: `1px solid ${rule}`, borderRadius: 14, padding: 22, position: 'sticky', top: 20 }}>
        <h2 style={{ fontFamily: serif, fontSize: 22, margin: '0 0 4px', color: emerald }}>Tickets</h2>
        {!event.ticketingEnabled || event.ticketTiers.length === 0 ? (
          <p style={{ color: muted, margin: '8px 0 0' }}>Tickets for this event are not on sale yet — check back soon.</p>
        ) : (
          <form onSubmit={startTicketCheckout}>
            <div style={{ display: 'grid', gap: 10, margin: '14px 0' }} role="radiogroup" aria-label="Ticket types">
              {event.ticketTiers.map((tier) => {
                const selected = tier.id === selectedTierId
                return (
                  <button
                    key={tier.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setSelectedTierId(tier.id)}
                    style={{
                      textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 10, padding: '12px 14px',
                      border: `2px solid ${selected ? emerald : rule}`, background: selected ? '#eef4ef' : ivory,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14.5 }}>{tier.name || 'Ticket'}</div>
                      {tier.bundleSize > 1 && <div style={{ fontSize: 12, color: emeraldLight, fontWeight: 600, marginTop: 2 }}>Includes {tier.bundleSize} tickets per purchase</div>}
                      {tier.description && <div style={{ fontSize: 12, color: muted, marginTop: 2 }}>{tier.description}</div>}
                    </div>
                    <div style={{ fontFamily: serif, fontSize: 19, fontWeight: 700, color: emerald, whiteSpace: 'nowrap' }}>{formatTierPrice(tier.pricePence)}</div>
                  </button>
                )
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{selectedTier?.bundleSize > 1 ? 'Bundles' : 'Quantity'}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button type="button" aria-label="Decrease quantity" onClick={() => setQuantity((current) => Math.max(1, current - 1))} style={stepperStyle}>−</button>
                <span style={{ minWidth: 22, textAlign: 'center', fontWeight: 700 }}>{quantity}</span>
                <button type="button" aria-label="Increase quantity" onClick={() => setQuantity((current) => Math.min(20, current + 1))} style={stepperStyle}>+</button>
              </div>
            </div>

            <label style={{ display: 'block', marginBottom: 10 }}>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: emerald, marginBottom: 4 }}>Your name</span>
              <input style={inputStyle} value={buyerName} onChange={(inputEvent) => setBuyerName(inputEvent.target.value)} placeholder="Full name" required />
            </label>
            <label style={{ display: 'block', marginBottom: 14 }}>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: emerald, marginBottom: 4 }}>Email for confirmation</span>
              <input type="email" style={inputStyle} value={buyerEmail} onChange={(inputEvent) => setBuyerEmail(inputEvent.target.value)} placeholder="you@example.com" required />
            </label>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: `1px solid ${rule}`, paddingTop: 12, marginBottom: 14 }}>
              <span style={{ fontSize: 13, color: muted }}>{totalTickets} ticket{totalTickets === 1 ? '' : 's'} total</span>
              <span style={{ fontFamily: serif, fontSize: 24, fontWeight: 700, color: emerald }}>{formatTierPrice(totalPence)}</span>
            </div>

            {error && <p style={{ color: '#a3401f', fontSize: 13, margin: '0 0 10px' }}>{error}</p>}
            <button
              type="submit"
              disabled={!canBuy}
              style={{
                width: '100%', border: 'none', borderRadius: 10, padding: '13px 18px', fontFamily: 'inherit', fontSize: 15, fontWeight: 700,
                background: canBuy ? gold : '#ddd6c2', color: emeraldLight, cursor: canBuy ? 'pointer' : 'not-allowed',
              }}
            >
              {busy ? 'Taking you to secure checkout…' : 'Buy tickets'}
            </button>
            <p style={{ fontSize: 11.5, color: muted, textAlign: 'center', margin: '10px 0 0' }}>Secure payment by Stripe. A receipt is emailed to you after payment.</p>
          </form>
        )}
      </div>
    </div>,
  )
}

const stepperStyle = {
  width: 32, height: 32, borderRadius: 8, border: `1px solid ${rule}`, background: ivory,
  fontSize: 17, fontWeight: 700, cursor: 'pointer', color: emerald, fontFamily: 'inherit',
}

function SummaryRow({ label, value, bold = false }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: `1px solid ${rule}`, fontSize: 14 }}>
      <span style={{ color: muted }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 600, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

export default EventTicketPage
