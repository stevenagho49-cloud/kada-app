import { useEffect, useRef, useState } from 'react'

/* Discount code input for the booking forms. Checks the code with the server
   (/api/discount-codes/check), which works the price out itself, and reports
   the result through onApplied ({ code, label, subtotalPence, discountPence,
   totalPence } or null). The checkout endpoints check the code again, so this
   is only ever a preview. `request` carries what the price depends on (plan,
   ticket tier and quantity, or a school quote) and re-checks when it changes. */
export function DiscountCodeField({ scope, request = {}, value, onChange, onApplied, inputStyle, buttonStyle, labelStyle, label = 'Discount code (optional)' }) {
  const [state, setState] = useState({ status: 'idle', message: '' })
  const appliedCode = useRef('')
  const requestKey = JSON.stringify(request)

  const check = async (code) => {
    const clean = String(code || '').trim()
    if (!clean) {
      appliedCode.current = ''
      setState({ status: 'idle', message: '' })
      onApplied(null)
      return
    }
    setState({ status: 'checking', message: '' })
    try {
      const response = await fetch('/api/discount-codes/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: clean, scope, ...request }) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'That code could not be checked.')
      appliedCode.current = clean
      const membershipNote = scope === 'class' && request.planType === 'monthly_membership' ? (result.membershipDuration === 'forever' ? ', every month' : ', first month') : ''
      setState({ status: 'applied', message: `${result.code}: ${result.label}${membershipNote}. You save £${(result.discountPence / 100).toFixed(2)}.` })
      onApplied(result)
    } catch (error) {
      appliedCode.current = ''
      setState({ status: 'error', message: error.message })
      onApplied(null)
    }
  }

  // The discount depends on the price, so re-check an applied code when it changes.
  useEffect(() => {
    if (appliedCode.current) void check(appliedCode.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey])

  return (
    <div>
      <span className="label" style={labelStyle}>{label}</span>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          aria-label="Discount code"
          style={{ ...inputStyle, textTransform: 'uppercase' }}
          value={value}
          placeholder="e.g. FAMILY10"
          onChange={(event) => {
            onChange(event.target.value)
            if (appliedCode.current || state.status === 'error') { appliedCode.current = ''; setState({ status: 'idle', message: '' }); onApplied(null) }
          }}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void check(value) } }}
        />
        <button type="button" style={buttonStyle} disabled={!String(value || '').trim() || state.status === 'checking'} onClick={() => check(value)}>{state.status === 'checking' ? 'Checking…' : 'Apply'}</button>
      </div>
      {state.message && <p role="status" style={{ margin: '6px 0 0', fontSize: 12.5, color: state.status === 'applied' ? '#2e6b47' : '#a3401f' }}>{state.message}</p>}
    </div>
  )
}

export const poundsFromPence = (pence) => `£${(Number(pence || 0) / 100).toFixed(2)}`
