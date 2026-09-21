/* Address autocomplete backed by the server's /api/address-lookup endpoint.
   Type a postcode or the start of a street; results filter as you type
   (debounced). Arrow keys + Enter or click to pick. onChange fires with the
   raw text on every keystroke AND with the chosen label on pick; onSelect
   additionally receives { label, mapUrl } so callers can store a precise
   map link. Provider attribution (required by Google/OSM terms) is shown
   under the results. */
import { useEffect, useRef, useState } from 'react'

export function AddressAutocomplete({ value, onChange, onSelect, placeholder = 'Postcode or start of address…', style = {}, disabled = false }) {
  const [results, setResults] = useState([])
  const [provider, setProvider] = useState(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const boxRef = useRef(null)
  const abortRef = useRef(null)
  const justSelectedRef = useRef(false)

  useEffect(() => {
    const onDocClick = (event) => { if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  useEffect(() => {
    if (justSelectedRef.current) { justSelectedRef.current = false; return undefined } // pick set the text; do not re-query it
    const q = value.trim()
    if (q.length < 3) { setResults([]); setOpen(false); return undefined }
    const timer = setTimeout(async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setLoading(true)
      try {
        const response = await fetch(`/api/address-lookup?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        const data = await response.json().catch(() => ({}))
        setResults(data.results || [])
        setProvider(data.provider || null)
        setOpen(true)
        setHighlight(-1)
      } catch { /* aborted or offline: keep whatever list we had */ }
      setLoading(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [value])

  const choose = (result) => {
    justSelectedRef.current = true
    onChange(result.label)
    if (onSelect) onSelect(result)
    setOpen(false)
    setResults([])
  }

  const onKeyDown = (event) => {
    if (!open || !results.length) return
    if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight((current) => Math.min(current + 1, results.length - 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight((current) => Math.max(current - 1, 0)) }
    else if (event.key === 'Enter' && highlight >= 0) { event.preventDefault(); choose(results[highlight]) }
    else if (event.key === 'Escape') setOpen(false)
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <input
        style={style}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => { if (results.length) setOpen(true) }}
        onKeyDown={onKeyDown}
        autoComplete="off"
      />
      {loading && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#767066', pointerEvents: 'none' }}>Searching…</span>}
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', zIndex: 40, top: 'calc(100% + 4px)', left: 0, right: 0, background: '#fff', border: '1px solid #e4ddc9', borderRadius: 8, boxShadow: '0 12px 30px rgba(0,0,0,0.16)', overflow: 'hidden' }}>
          {results.map((result, index) => (
            <button
              type="button"
              key={result.label}
              onMouseDown={(event) => { event.preventDefault(); choose(result) }}
              onMouseEnter={() => setHighlight(index)}
              style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid #f1ead8', padding: '9px 12px', fontSize: 13, background: index === highlight ? '#f6f1e2' : '#fff', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit' }}
            >{result.label}</button>
          ))}
          <div style={{ padding: '5px 12px', fontSize: 10.5, color: '#767066', background: '#fbf8ee' }}>
            {provider === 'google' ? 'Powered by Google' : provider === 'osm' ? 'Data © OpenStreetMap contributors' : ''}
          </div>
        </div>
      )}
    </div>
  )
}
