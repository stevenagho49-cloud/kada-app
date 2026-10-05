import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export function useTicketStock(eventIds) {
  const idsKey = JSON.stringify([...new Set(eventIds)].sort())
  const [snapshot, setSnapshot] = useState({ key: '', stock: {}, error: '' })
  useEffect(() => {
    let cancelled = false
    let loading = false
    const ids = JSON.parse(idsKey)
    if (!ids.length) return undefined
    const refresh = async () => {
      if (loading) return
      loading = true
      try {
        if (!supabase) throw new Error('Ticket storage is not configured.')
        const { data, error: loadError } = await supabase.rpc('event_ticket_stock', { p_event_ids: ids })
        if (loadError) throw new Error(loadError.message)
        if (!cancelled) {
          setSnapshot({ key: idsKey, stock: Object.fromEntries(data.map((row) => [`${row.event_id}:${row.tier_id}`, row])), error: '' })
        }
      } catch (loadError) {
        if (!cancelled) setSnapshot((current) => ({
          key: idsKey, stock: current.key === idsKey ? current.stock : {},
          error: `Ticket availability could not be loaded: ${loadError.message}`,
        }))
      } finally {
        loading = false
      }
    }
    refresh()
    const timer = window.setInterval(refresh, 5000)
    window.addEventListener('focus', refresh)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [idsKey])
  return snapshot.key === idsKey ? snapshot : { stock: {}, error: '' }
}
