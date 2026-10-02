import { useEffect, useState } from 'react'

/* Class prices (per child), read from the server, which takes them from the
   Stripe prices checkout actually charges. One request per page load. Returns
   null until loaded, so nothing shows a price that might not be the real one. */
let cached = null
let pending = null

export function useClassPrices() {
  const [prices, setPrices] = useState(cached)
  useEffect(() => {
    if (cached) return undefined
    let live = true
    pending ||= fetch('/api/public/class-prices')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('prices'))))
      .then((result) => { cached = result; return result })
      .catch(() => { pending = null; return null })
    pending.then((result) => { if (live && result) setPrices(result) })
    return () => { live = false }
  }, [])
  return prices
}

// "£25", or "£25.50" when there are pence; "£…" while the price is loading.
export const priceLabel = (pence) => (pence === null || pence === undefined ? '£…' : `£${pence % 100 ? (pence / 100).toFixed(2) : pence / 100}`)
