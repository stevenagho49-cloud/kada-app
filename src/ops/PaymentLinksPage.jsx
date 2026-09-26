import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { DataTable, Toggle, OpsButton, EmptyState, Pill, OPS_COLORS, OPS_SERIF, opsInputStyle } from './ui'
import { formatTierPrice } from './EventsPage'

/* ------------------------------------------------------------------ */
/* Payment links (Sales > Payment links). Each link is a public page at */
/* /pay/<slug> selling one item at a fixed price, with optional custom  */
/* fields the buyer fills in first (e.g. T-shirt size). The "who's      */
/* paid" view turns those answers into columns.                         */
/* ------------------------------------------------------------------ */

export function slugify(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

export function normalizeField(field = {}) {
  return {
    id: field.id || crypto.randomUUID(),
    label: field.label ?? '',
    type: field.type === 'select' ? 'select' : 'text',
    options: Array.isArray(field.options) ? field.options.map(String) : [],
    required: Boolean(field.required),
  }
}

export function normalizePaymentLink(row = {}) {
  return {
    id: row.id,
    slug: row.slug ?? '',
    name: row.name ?? '',
    description: row.description ?? '',
    pricePence: Math.round(Number(row.price_pence ?? row.pricePence ?? 0)) || 0,
    fields: Array.isArray(row.fields) ? row.fields.map(normalizeField) : [],
    active: row.active ?? true,
    createdAt: row.created_at ?? '',
  }
}

function toDbPaymentLink(link) {
  return {
    id: link.id,
    slug: link.slug,
    name: link.name.trim(),
    description: link.description.trim() || null,
    price_pence: link.pricePence,
    fields: link.fields
      .filter((field) => field.label.trim())
      .map((field) => ({ id: field.id, label: field.label.trim(), type: field.type, options: field.type === 'select' ? field.options.map((option) => option.trim()).filter(Boolean) : [], required: field.required })),
    active: link.active,
    updated_at: new Date().toISOString(),
  }
}

const shareUrl = (link) => `${window.location.origin}/pay/${link.slug}`
const formatDateTime = (value) => (value ? new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

export function PaymentLinksPage({ focusLinkId = '', onFocusHandled }) {
  const [links, setLinks] = useState(null)
  const [stats, setStats] = useState({})
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [viewingId, setViewingId] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [copiedId, setCopiedId] = useState('')

  const load = async () => {
    const [linksResult, ordersResult] = await Promise.all([
      supabase.from('payment_links').select('*').order('created_at', { ascending: false }),
      supabase.from('payment_link_orders').select('payment_link_id,amount_pence,payment_status'),
    ])
    const firstError = linksResult.error || ordersResult.error
    if (firstError) {
      setError(/relation .* does not exist|could not find the table/i.test(firstError.message) ? 'Payment links are not set up yet. Apply supabase/migrations/20260926_payment_links.sql in the Supabase SQL Editor.' : firstError.message)
      setLinks([])
      return
    }
    const nextStats = {}
    ;(ordersResult.data || []).forEach((order) => {
      const entry = nextStats[order.payment_link_id] || (nextStats[order.payment_link_id] = { paid: 0, collected: 0, any: 0 })
      entry.any += 1
      if (order.payment_status === 'paid') { entry.paid += 1; entry.collected += order.amount_pence || 0 }
    })
    setError('')
    setStats(nextStats)
    setLinks((linksResult.data || []).map(normalizePaymentLink))
  }
  useEffect(() => { load() }, [])

  // Deep link from an admin alert email (#ops/payment-links/<id>).
  useEffect(() => {
    if (focusLinkId && links?.some((link) => link.id === focusLinkId)) {
      setViewingId(focusLinkId)
      onFocusHandled?.()
    }
  }, [focusLinkId, links, onFocusHandled])

  const saveLink = async (link) => {
    const { error: saveError } = await supabase.from('payment_links').upsert(toDbPaymentLink(link), { onConflict: 'id' })
    if (saveError) {
      if (saveError.code === '23505') throw new Error(`The web address /pay/${link.slug} is already used by another payment link. Choose a different one.`)
      throw new Error(saveError.message)
    }
    await load()
  }

  const setActive = async (link, active) => {
    setLinks((current) => current.map((item) => (item.id === link.id ? { ...item, active } : item)))
    const { error: saveError } = await supabase.from('payment_links').update({ active, updated_at: new Date().toISOString() }).eq('id', link.id)
    if (saveError) { setError(saveError.message); load() }
  }

  const deleteLink = async (link) => {
    if (!window.confirm(`Delete the "${link.name}" payment link? Its page at /pay/${link.slug} will stop working.`)) return
    const { error: deleteError } = await supabase.from('payment_links').delete().eq('id', link.id)
    if (deleteError) setError(deleteError.code === '23503' ? 'This link has checkout records, so it can be paused but not deleted.' : deleteError.message)
    load()
  }

  const copyLink = async (link) => {
    try { await navigator.clipboard.writeText(shareUrl(link)) } catch { window.prompt('Copy this link:', shareUrl(link)) }
    setCopiedId(link.id)
    window.setTimeout(() => setCopiedId(''), 2000)
  }

  const viewing = links?.find((link) => link.id === viewingId)
  if (viewing) return <PaymentLinkOrdersView link={viewing} onBack={() => { setViewingId(''); load() }} onEdit={() => setEditing(viewing)} editing={editing} onCloseEdit={() => setEditing(null)} onSave={saveLink} />

  const columns = [
    {
      key: 'name', label: 'Payment link', render: (link) => (
        <div style={{ minWidth: 180 }}>
          <button type="button" onClick={() => setViewingId(link.id)} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 14, color: OPS_COLORS.emerald, textAlign: 'left' }}>{link.name}</button>
          <div style={{ fontSize: 11.5, color: OPS_COLORS.muted, marginTop: 2 }}>/pay/{link.slug}{link.fields.length ? ` · ${link.fields.length} question${link.fields.length === 1 ? '' : 's'}` : ''}</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <a href={`/pay/${link.slug}`} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: OPS_COLORS.emerald, fontWeight: 600 }}>View page ↗</a>
            <button type="button" onClick={() => copyLink(link)} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontSize: 11.5, color: OPS_COLORS.muted, fontWeight: 600 }}>{copiedId === link.id ? '✓ Link copied' : '🔗 Copy link'}</button>
          </div>
        </div>
      ),
    },
    { key: 'price', label: 'Price', render: (link) => <strong>{formatTierPrice(link.pricePence)}</strong> },
    { key: 'payments', label: 'Payments', render: (link) => <span>{stats[link.id]?.paid || 0}</span> },
    { key: 'collected', label: 'Collected', render: (link) => <strong style={{ color: OPS_COLORS.okGreen }}>{formatTierPrice(stats[link.id]?.collected || 0)}</strong> },
    {
      key: 'active', label: 'Taking payments', render: (link) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Toggle label={`${link.name} taking payments`} checked={link.active} onChange={(value) => setActive(link, value)} />
          <span style={{ fontSize: 11.5, color: OPS_COLORS.muted }}>{link.active ? 'Live' : 'Paused'}</span>
        </div>
      ),
    },
    {
      key: 'actions', label: '', render: (link) => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <OpsButton small onClick={() => setViewingId(link.id)}>Who's paid</OpsButton>
          <OpsButton small variant="ghost" onClick={() => setEditing(link)}>Edit</OpsButton>
          {!stats[link.id]?.any && <OpsButton small variant="danger" onClick={() => deleteLink(link)}>Delete</OpsButton>}
        </div>
      ),
    },
  ]

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Payment links</h3>
        <OpsButton small onClick={() => setEditing(emptyPaymentLink())}>+ Create payment link</OpsButton>
      </div>
      <p style={{ color: OPS_COLORS.muted, fontSize: 13, margin: '0 0 14px' }}>Sell one thing at a fixed price (T-shirts, trip deposits, costumes) with a shareable page. Add questions like size or name on back and see every answer in the "who's paid" list.</p>
      {error && <p style={{ color: OPS_COLORS.warn, fontSize: 13 }}>{error}</p>}
      {!links && <p style={{ color: OPS_COLORS.muted, fontSize: 13 }}>Loading payment links…</p>}
      {links && (
        <DataTable
          columns={columns}
          rows={links}
          pageSize={10}
          expanded={expanded}
          onToggleExpand={() => setExpanded((current) => !current)}
          emptyState={<EmptyState icon="💳" title="No payment links yet" body="Create a link for anything you want to collect payment for, then share it on WhatsApp, Instagram or email." ctaLabel="+ Create payment link" onCta={() => setEditing(emptyPaymentLink())} />}
        />
      )}
      {editing && <PaymentLinkFormModal link={editing} onClose={() => setEditing(null)} onSave={saveLink} />}
    </div>
  )
}

function emptyPaymentLink() {
  return { id: crypto.randomUUID(), slug: '', name: '', description: '', pricePence: 0, fields: [], active: true, isNew: true }
}

/* ------------------------------------------------------------------ */
/* Create / edit form with the custom field builder.                    */
/* ------------------------------------------------------------------ */
function PaymentLinkFormModal({ link, onClose, onSave }) {
  const [form, setForm] = useState(link)
  // Dropdown options are edited as comma-separated text so commas can be typed freely.
  const [optionText, setOptionText] = useState(() => Object.fromEntries(link.fields.map((field) => [field.id, field.options.join(', ')])))
  const [slugTouched, setSlugTouched] = useState(!link.isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const setName = (name) => setForm((current) => ({ ...current, name, slug: slugTouched ? current.slug : slugify(name) }))
  const updateField = (fieldId, changes) => setForm((current) => ({ ...current, fields: current.fields.map((field) => (field.id === fieldId ? { ...field, ...changes } : field)) }))
  const moveField = (index, delta) => setForm((current) => {
    const fields = [...current.fields]
    const target = index + delta
    if (target < 0 || target >= fields.length) return current
    ;[fields[index], fields[target]] = [fields[target], fields[index]]
    return { ...current, fields }
  })
  const addField = (type) => {
    const field = normalizeField({ type })
    setForm((current) => ({ ...current, fields: [...current.fields, field] }))
    if (type === 'select') setOptionText((current) => ({ ...current, [field.id]: '' }))
  }
  const removeField = (fieldId) => setForm((current) => ({ ...current, fields: current.fields.filter((field) => field.id !== fieldId) }))

  const submit = async (submitEvent) => {
    submitEvent.preventDefault()
    setError('')
    const fields = form.fields.map((field) => (field.type === 'select' ? { ...field, options: String(optionText[field.id] || '').split(',').map((option) => option.trim()).filter(Boolean) } : field))
    const blankDropdown = fields.find((field) => field.label.trim() && field.type === 'select' && field.options.length < 1)
    if (!form.name.trim()) return setError('Give the payment link a name.')
    if (!form.slug) return setError('The web address needs at least one letter or number.')
    if (form.pricePence < 30) return setError('The price must be at least £0.30 (Stripe minimum).')
    if (blankDropdown) return setError(`Add some options for the "${blankDropdown.label}" dropdown, separated by commas.`)
    setSaving(true)
    try {
      await onSave({ ...form, fields })
      onClose()
    } catch (saveError) {
      setError(saveError.message)
      setSaving(false)
    }
  }

  const labelStyle = { display: 'block', fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, marginBottom: 4 }
  const smallLabel = { display: 'block', fontSize: 11, fontWeight: 700, color: OPS_COLORS.muted, marginBottom: 3 }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,8,0.45)', display: 'grid', placeItems: 'center', zIndex: 1000, padding: 16 }}>
      <form onSubmit={submit} onClick={(clickEvent) => clickEvent.stopPropagation()} style={{ background: OPS_COLORS.ivory, borderRadius: 12, border: `1px solid ${OPS_COLORS.rule}`, width: '100%', maxWidth: 640, maxHeight: '90vh', overflow: 'auto', padding: 20, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontFamily: OPS_SERIF, color: OPS_COLORS.emerald }}>{link.isNew ? 'Create payment link' : `Edit ${link.name}`}</h3>
          <button type="button" aria-label="Close" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: OPS_COLORS.muted }}>×</button>
        </div>
        <div className="plink-form-row">
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={labelStyle}>Name</span>
            <input style={opsInputStyle} value={form.name} onChange={(inputEvent) => setName(inputEvent.target.value)} placeholder="T-shirts" required />
          </label>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={labelStyle}>Price (£)</span>
            <input type="number" min="0.30" step="0.01" style={opsInputStyle} value={form.pricePence ? (form.pricePence / 100).toString() : ''} onChange={(inputEvent) => setForm({ ...form, pricePence: Math.round(Number(inputEvent.target.value || 0) * 100) })} placeholder="15.00" required />
          </label>
        </div>
        <label style={{ display: 'block', marginBottom: 12 }}>
          <span style={labelStyle}>Web address</span>
          <div style={{ display: 'flex', alignItems: 'center', border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 6, background: OPS_COLORS.ivory, overflow: 'hidden' }}>
            <span style={{ padding: '9px 0 9px 11px', fontSize: 13, color: OPS_COLORS.muted, whiteSpace: 'nowrap' }}>{window.location.host}/pay/</span>
            <input style={{ ...opsInputStyle, border: 'none', paddingLeft: 2 }} value={form.slug} onChange={(inputEvent) => { setSlugTouched(true); setForm({ ...form, slug: slugify(inputEvent.target.value) }) }} placeholder="t-shirts" required />
          </div>
          {!link.isNew && form.slug !== link.slug && <span style={{ display: 'block', fontSize: 11, color: OPS_COLORS.warn, marginTop: 4 }}>Links you already shared with the old address (/pay/{link.slug}) will stop working.</span>}
        </label>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={labelStyle}>Description (optional)</span>
          <textarea style={{ ...opsInputStyle, minHeight: 70 }} value={form.description} onChange={(inputEvent) => setForm({ ...form, description: inputEvent.target.value })} placeholder="Official KADA show T-shirt. Collect from class on Saturday." />
        </label>

        <div style={{ border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 8, padding: 12, marginBottom: 14, background: OPS_COLORS.cream }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, marginBottom: 2 }}>Questions for the buyer (optional)</div>
          <div style={{ fontSize: 11.5, color: OPS_COLORS.muted, marginBottom: 10 }}>Asked before payment. Each one becomes a column in the "who's paid" list. Name and email are always collected.</div>
          {form.fields.map((field, index) => (
            <div key={field.id} style={{ background: OPS_COLORS.ivory, border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 8, padding: 10, marginBottom: 8 }}>
              <div className="plink-field-row">
                <label>
                  <span style={smallLabel}>Question</span>
                  <input style={opsInputStyle} value={field.label} onChange={(inputEvent) => updateField(field.id, { label: inputEvent.target.value })} placeholder={field.type === 'select' ? 'Size' : 'Name on back'} />
                </label>
                <label>
                  <span style={smallLabel}>Answer type</span>
                  <select style={opsInputStyle} value={field.type} onChange={(inputEvent) => updateField(field.id, { type: inputEvent.target.value })}>
                    <option value="text">Text box</option>
                    <option value="select">Dropdown</option>
                  </select>
                </label>
              </div>
              {field.type === 'select' && (
                <label style={{ display: 'block', marginTop: 8 }}>
                  <span style={smallLabel}>Dropdown options, separated by commas</span>
                  <input style={opsInputStyle} value={optionText[field.id] ?? ''} onChange={(inputEvent) => setOptionText((current) => ({ ...current, [field.id]: inputEvent.target.value }))} placeholder="S, M, L, XL" />
                </label>
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={field.required} onChange={(inputEvent) => updateField(field.id, { required: inputEvent.target.checked })} />
                  Required
                </label>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => moveField(index, -1)} style={iconButton}>↑</button>
                  <button type="button" aria-label="Move down" disabled={index === form.fields.length - 1} onClick={() => moveField(index, 1)} style={iconButton}>↓</button>
                  <button type="button" aria-label={`Remove ${field.label || 'question'}`} onClick={() => removeField(field.id)} style={{ ...iconButton, color: OPS_COLORS.warn }}>Remove</button>
                </div>
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <OpsButton small variant="ghost" onClick={() => addField('select')}>+ Dropdown question</OpsButton>
            <OpsButton small variant="ghost" onClick={() => addField('text')}>+ Text question</OpsButton>
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, cursor: 'pointer' }}>
          <Toggle label="Taking payments" checked={form.active} onChange={(value) => setForm({ ...form, active: value })} />
          <span style={{ fontSize: 13 }}>{form.active ? 'Live: people can pay now' : 'Paused: the page says payments are closed'}</span>
        </label>
        {error && <p style={{ color: OPS_COLORS.warn, fontSize: 13, margin: '0 0 10px' }}>{error}</p>}
        <OpsButton type="submit" disabled={saving}>{saving ? 'Saving…' : link.isNew ? 'Create payment link' : 'Save changes'}</OpsButton>
      </form>
    </div>
  )
}

const iconButton = { border: `1px solid ${OPS_COLORS.rule}`, background: 'transparent', color: OPS_COLORS.emerald, borderRadius: 6, padding: '4px 9px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }

/* ------------------------------------------------------------------ */
/* Who's paid: one row per payment, one column per question.            */
/* ------------------------------------------------------------------ */
function PaymentLinkOrdersView({ link, onBack, onEdit, editing, onCloseEdit, onSave }) {
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [copied, setCopied] = useState('')

  useEffect(() => {
    let mounted = true
    supabase.from('payment_link_orders').select('*').eq('payment_link_id', link.id).eq('payment_status', 'paid').order('paid_at', { ascending: false })
      .then(({ data, error: loadError }) => {
        if (!mounted) return
        if (loadError) setError(loadError.message)
        else setOrders(data || [])
      })
    return () => { mounted = false }
  }, [link.id])

  // Columns: the link's current questions in order, then any question that has
  // since been removed but still has answers on older payments.
  const answerColumns = useMemo(() => {
    const columns = link.fields.filter((field) => field.label.trim()).map((field) => ({ id: field.id, label: field.label, type: field.type, options: field.options }))
    ;(orders || []).forEach((order) => (order.answers || []).forEach((answer) => {
      if (answer?.fieldId && !columns.some((column) => column.id === answer.fieldId)) columns.push({ id: answer.fieldId, label: `${answer.label} (removed)`, type: 'text', options: [] })
    }))
    return columns
  }, [link.fields, orders])

  const rows = useMemo(() => (orders || []).map((order) => ({
    id: order.id,
    name: order.buyer_name,
    email: order.buyer_email,
    amountPence: order.amount_pence,
    paidAt: order.paid_at || order.created_at,
    answers: Object.fromEntries((order.answers || []).filter((answer) => answer?.fieldId).map((answer) => [answer.fieldId, answer.value || ''])),
  })), [orders])

  const query = search.trim().toLowerCase()
  const visible = rows.filter((row) => !query || [row.name, row.email, ...Object.values(row.answers)].some((value) => String(value).toLowerCase().includes(query)))
  const collected = rows.reduce((sum, row) => sum + (row.amountPence || 0), 0)

  // Tallies for dropdown questions: the order-sheet view (e.g. S × 3, M × 5).
  const tallies = answerColumns.filter((column) => column.type === 'select').map((column) => {
    const counts = {}
    rows.forEach((row) => { const value = row.answers[column.id]; if (value) counts[value] = (counts[value] || 0) + 1 })
    const ordered = [...column.options.filter((option) => counts[option]), ...Object.keys(counts).filter((value) => !column.options.includes(value))]
    return { column, entries: ordered.map((value) => [value, counts[value]]) }
  }).filter((tally) => tally.entries.length)

  const exportCsv = () => {
    const escapeCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
    const lines = [['Name', 'Email', ...answerColumns.map((column) => column.label), 'Amount', 'Paid on'].map(escapeCell).join(',')]
    rows.forEach((row) => lines.push([row.name, row.email, ...answerColumns.map((column) => row.answers[column.id] || ''), (row.amountPence / 100).toFixed(2), formatDateTime(row.paidAt)].map(escapeCell).join(',')))
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' })
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(blob)
    anchor.download = `${link.slug}-payments.csv`
    anchor.click()
    URL.revokeObjectURL(anchor.href)
  }

  const copyText = async (key, text) => {
    try { await navigator.clipboard.writeText(text) } catch { window.prompt('Copy:', text) }
    setCopied(key)
    window.setTimeout(() => setCopied(''), 2000)
  }

  const linkButton = { border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontSize: 12.5, color: OPS_COLORS.emerald, fontWeight: 600, fontFamily: 'inherit' }
  return (
    <div className="panel">
      <button type="button" onClick={onBack} style={{ ...linkButton, marginBottom: 10 }}>← All payment links</button>
      <div className="panel-head" style={{ alignItems: 'flex-start' }}>
        <div>
          <h3 style={{ margin: 0 }}>{link.name}: who's paid</h3>
          <div style={{ fontSize: 12.5, color: OPS_COLORS.muted, marginTop: 4 }}>
            {formatTierPrice(link.pricePence)} each · <a href={`/pay/${link.slug}`} target="_blank" rel="noreferrer" style={{ color: OPS_COLORS.emerald }}>{window.location.host}/pay/{link.slug}</a> · <Pill text={link.active ? 'Live' : 'Paused'} tone={link.active ? 'green' : 'default'} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <OpsButton small variant="ghost" onClick={() => copyText('link', shareUrl(link))}>{copied === 'link' ? '✓ Copied' : '🔗 Copy link'}</OpsButton>
          <OpsButton small variant="ghost" onClick={onEdit}>Edit</OpsButton>
        </div>
      </div>

      <div className="plink-stats">
        <div><div className="plink-stat-value">{rows.length}</div><div className="plink-stat-label">payment{rows.length === 1 ? '' : 's'}</div></div>
        <div><div className="plink-stat-value" style={{ color: OPS_COLORS.okGreen }}>{formatTierPrice(collected)}</div><div className="plink-stat-label">collected</div></div>
        {tallies.map(({ column, entries }) => (
          <div key={column.id} style={{ minWidth: 0 }}>
            <div className="plink-stat-label" style={{ marginBottom: 4 }}>{column.label}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {entries.map(([value, count]) => <span key={value} style={{ background: OPS_COLORS.ivory, border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 6, padding: '3px 8px', fontSize: 12.5 }}><strong>{value}</strong> × {count}</span>)}
            </div>
          </div>
        ))}
      </div>

      {error && <p style={{ color: OPS_COLORS.warn, fontSize: 13 }}>{error}</p>}
      {!orders && !error && <p style={{ color: OPS_COLORS.muted, fontSize: 13 }}>Loading payments…</p>}
      {orders && rows.length === 0 && !error && (
        <EmptyState icon="🧾" title="No payments yet" body="Share the link and everyone who pays will appear here with their answers." ctaLabel={copied === 'link' ? '✓ Link copied' : 'Copy link'} onCta={() => copyText('link', shareUrl(link))} />
      )}
      {rows.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
            <input style={{ ...opsInputStyle, flex: '1 1 220px', width: 'auto' }} placeholder="Search name, email or answer…" value={search} onChange={(searchEvent) => setSearch(searchEvent.target.value)} />
            <button type="button" onClick={() => copyText('emails', rows.map((row) => row.email).join(', '))} style={linkButton}>{copied === 'emails' ? '✓ Copied' : '📋 Copy emails'}</button>
            <button type="button" onClick={exportCsv} style={linkButton}>Export CSV</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  {answerColumns.map((column) => <th key={column.id}>{column.label}</th>)}
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th>Paid on</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id}>
                    <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{row.name}</td>
                    <td><a href={`mailto:${row.email}`} style={{ color: OPS_COLORS.emerald }}>{row.email}</a></td>
                    {answerColumns.map((column) => (
                      <td key={column.id} style={{ fontWeight: column.type === 'select' ? 700 : 400 }}>{row.answers[column.id] || <span style={{ color: OPS_COLORS.muted }}>none</span>}</td>
                    ))}
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatTierPrice(row.amountPence)}</td>
                    <td style={{ whiteSpace: 'nowrap', color: OPS_COLORS.muted, fontSize: 12.5 }}>{formatDateTime(row.paidAt)}</td>
                  </tr>
                ))}
                {visible.length === 0 && <tr><td colSpan={answerColumns.length + 4} style={{ color: OPS_COLORS.muted }}>No payments match "{search}".</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
      {editing && <PaymentLinkFormModal link={editing} onClose={onCloseEdit} onSave={onSave} />}
    </div>
  )
}
