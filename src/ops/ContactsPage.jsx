import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { DataTable, EmptyState, OpsButton, Pill, OPS_COLORS, opsInputStyle } from './ui'

/* ------------------------------------------------------------------ */
/* Operations > Contacts — the KADA CRM. Every school, parent, client  */
/* and partner in one place, fed by manual entry, Excel/CSV imports,   */
/* website enquiries and the inbound-email webhook.                    */
/* ------------------------------------------------------------------ */

const KIND_OPTIONS = [
  { value: 'school', label: 'School' },
  { value: 'parent', label: 'Parent' },
  { value: 'client', label: 'Client' },
  { value: 'partner', label: 'Partner' },
  { value: 'other', label: 'Other' },
]
const KIND_TONES = { school: 'green', parent: 'gold', client: 'default', partner: 'gold', other: 'default' }
const SOURCE_LABELS = { manual: 'Manual', import: 'Import', email: 'Email', website: 'Website' }

const emptyContact = { id: '', kind: 'school', name: '', organisation: '', email: '', phone: '', address: '', tags: [], notes: '' }

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 700, color: OPS_COLORS.emerald, marginBottom: 4 }
const overlayStyle = { position: 'fixed', inset: 0, background: 'rgba(35,35,35,0.45)', zIndex: 60, display: 'grid', placeItems: 'center', padding: 20 }
const modalStyle = { background: OPS_COLORS.cream, borderRadius: 12, padding: 22, width: '100%', maxWidth: 620, maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 18px 60px rgba(0,0,0,0.3)' }

function normalizeKind(value) {
  const v = String(value || '').toLowerCase()
  if (v.includes('school') || v.includes('academy') || v.includes('college')) return 'school'
  if (v.includes('parent') || v.includes('mum') || v.includes('dad') || v.includes('guardian')) return 'parent'
  if (v.includes('partner') || v.includes('sponsor')) return 'partner'
  if (v.includes('client') || v.includes('customer') || v.includes('organisation') || v.includes('organization')) return 'client'
  return KIND_OPTIONS.some((option) => option.value === v) ? v : 'other'
}

/* RFC-4180-ish delimited parser — handles quoted cells, commas/tabs and     */
/* embedded newlines, so pasted Excel ranges and exported CSVs both work.    */
function parseDelimited(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  const source = String(text || '')
  const delimiter = source.slice(0, 2000).includes('\t') ? '\t' : ','
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { cell += '"'; i += 1 } else quoted = false
      } else cell += char
    } else if (char === '"') quoted = true
    else if (char === delimiter) { row.push(cell); cell = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1
      row.push(cell); cell = ''
      if (row.some((value) => value.trim() !== '')) rows.push(row)
      row = []
    } else cell += char
  }
  row.push(cell)
  if (row.some((value) => value.trim() !== '')) rows.push(row)
  return rows
}

/* Guess which spreadsheet column feeds which contact field. */
const IMPORT_FIELDS = [
  { key: 'name', label: 'Name *', hints: ['name', 'contact', 'full name', 'contact name'] },
  { key: 'organisation', label: 'Organisation / school', hints: ['org', 'organisation', 'organization', 'school', 'company', 'business'] },
  { key: 'email', label: 'Email', hints: ['email', 'e-mail', 'mail'] },
  { key: 'phone', label: 'Phone', hints: ['phone', 'tel', 'mobile', 'number'] },
  { key: 'kind', label: 'Type (school/parent/client)', hints: ['type', 'kind', 'category', 'group'] },
  { key: 'address', label: 'Address', hints: ['address', 'location', 'postcode', 'post code'] },
  { key: 'tags', label: 'Tags', hints: ['tag', 'labels'] },
  { key: 'notes', label: 'Notes', hints: ['note', 'comment', 'detail'] },
]
function guessMapping(headers) {
  const mapping = {}
  IMPORT_FIELDS.forEach((field) => {
    const index = headers.findIndex((header) => field.hints.some((hint) => String(header || '').toLowerCase().includes(hint)))
    mapping[field.key] = index >= 0 ? index : ''
  })
  return mapping
}

/* Parse a pasted raw email (headers + body) into a contact draft. */
function parseEmailText(text) {
  const source = String(text || '')
  const fromHeader = source.match(/^From:\s*(.+)$/im)?.[1] || ''
  const subject = source.match(/^Subject:\s*(.+)$/im)?.[1]?.trim() || ''
  const dateHeader = source.match(/^Date:\s*(.+)$/im)?.[1]?.trim() || ''
  const angleMatch = fromHeader.match(/^(.*?)\s*<([^>]+)>/)
  const bareMatch = fromHeader.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || source.match(/[\w.+-]+@[\w-]+\.[\w.]+/)
  const email = (angleMatch ? angleMatch[2] : bareMatch?.[0] || '').trim().toLowerCase()
  const name = (angleMatch ? angleMatch[1].replace(/^["']|["']$/g, '').trim() : '') || (email ? email.split('@')[0].replace(/[._-]+/g, ' ') : '')
  return { name, email, subject, dateHeader }
}

function toDbRow(draft) {
  return {
    kind: draft.kind,
    name: draft.name.trim(),
    organisation: draft.organisation?.trim() || null,
    email: draft.email?.trim().toLowerCase() || null,
    phone: draft.phone?.trim() || null,
    address: draft.address?.trim() || null,
    tags: Array.isArray(draft.tags) ? draft.tags.map((tag) => tag.trim()).filter(Boolean) : [],
    notes: draft.notes?.trim() || null,
    updated_at: new Date().toISOString(),
  }
}

export function ContactsPage() {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState('')
  const [editing, setEditing] = useState(null) // draft object or null
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [showEmailAdd, setShowEmailAdd] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [notice, setNotice] = useState('')

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase.from('contacts').select('*').order('created_at', { ascending: false })
    if (error) setLoadError(error.message)
    else setContacts(data || [])
    setLoading(false)
  }
  useEffect(() => { void load() }, [])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return contacts.filter((contact) => {
      if (kindFilter && contact.kind !== kindFilter) return false
      if (!query) return true
      return [contact.name, contact.organisation, contact.email, contact.phone, (contact.tags || []).join(' ')]
        .filter(Boolean).some((value) => value.toLowerCase().includes(query))
    })
  }, [contacts, search, kindFilter])

  /* Shared dedupe path: match by email, else by name+organisation. Updates  */
  /* only fill fields the new data actually provides — imports never blank   */
  /* out existing notes or details.                                          */
  const upsertOne = async (draft, source) => {
    const row = toDbRow(draft)
    if (!row.name && !row.email) return { status: 'skipped' }
    const email = row.email
    const existing = (email && contacts.find((contact) => contact.email === email))
      || contacts.find((contact) => contact.name.toLowerCase() === row.name.toLowerCase()
        && (contact.organisation || '').toLowerCase() === (row.organisation || '').toLowerCase())
    if (existing) {
      const fill = {}
      Object.entries(row).forEach(([key, value]) => {
        if (value === null || value === '' || (Array.isArray(value) && !value.length)) return
        if (key === 'notes' && existing.notes && String(existing.notes).includes(String(value))) return
        if (key === 'notes' && existing.notes) { fill.notes = `${existing.notes}\n${value}`; return }
        if (key === 'tags') { fill.tags = [...new Set([...(existing.tags || []), ...value])]; return }
        fill[key] = value
      })
      fill.updated_at = new Date().toISOString()
      if (source === 'email' || source === 'website') fill.last_contacted_at = new Date().toISOString()
      const { error } = await supabase.from('contacts').update(fill).eq('id', existing.id)
      return error ? { status: 'error', error } : { status: 'updated' }
    }
    const { error } = await supabase.from('contacts').insert({ ...row, source, last_contacted_at: source === 'email' ? new Date().toISOString() : null })
    return error ? { status: 'error', error } : { status: 'added' }
  }

  const saveForm = async () => {
    if (!editing.name.trim()) { setFormError('A name is required.'); return }
    setSaving(true)
    setFormError('')
    const row = toDbRow(editing)
    const duplicate = row.email && contacts.find((contact) => contact.email === row.email && contact.id !== editing.id)
    if (duplicate) { setFormError(`${duplicate.name} already uses this email address.`); setSaving(false); return }
    const query = editing.id
      ? await supabase.from('contacts').update(row).eq('id', editing.id)
      : await supabase.from('contacts').insert({ ...row, source: 'manual' })
    setSaving(false)
    if (query.error) { setFormError(query.error.message); return }
    setEditing(null)
    await load()
  }

  const remove = async (contact) => {
    if (!window.confirm(`Delete ${contact.name} from contacts? This cannot be undone.`)) return
    await supabase.from('contacts').delete().eq('id', contact.id)
    await load()
  }

  const exportCsv = () => {
    const header = ['Name', 'Type', 'Organisation', 'Email', 'Phone', 'Address', 'Tags', 'Source', 'Notes']
    const escapeCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
    const lines = [header.map(escapeCell).join(',')]
    filtered.forEach((contact) => {
      lines.push([contact.name, contact.kind, contact.organisation, contact.email, contact.phone, contact.address, (contact.tags || []).join('; '), SOURCE_LABELS[contact.source] || contact.source, contact.notes].map(escapeCell).join(','))
    })
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `kada-contacts-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const columns = [
    { key: 'name', label: 'Name', render: (row) => <div><div style={{ fontWeight: 700 }}>{row.name}</div>{row.organisation && <div style={{ fontSize: 12, color: OPS_COLORS.muted }}>{row.organisation}</div>}</div> },
    { key: 'kind', label: 'Type', render: (row) => <Pill text={row.kind} tone={KIND_TONES[row.kind]} /> },
    { key: 'email', label: 'Email', render: (row) => row.email ? <a href={`mailto:${row.email}`} style={{ color: OPS_COLORS.emerald }}>{row.email}</a> : <span style={{ color: OPS_COLORS.muted }}>—</span> },
    { key: 'phone', label: 'Phone', render: (row) => row.phone || <span style={{ color: OPS_COLORS.muted }}>—</span> },
    { key: 'tags', label: 'Tags', render: (row) => (row.tags || []).length ? row.tags.map((tag) => <Pill key={tag} text={tag} />) : <span style={{ color: OPS_COLORS.muted }}>—</span> },
    { key: 'source', label: 'Source', render: (row) => <span style={{ fontSize: 12, color: OPS_COLORS.muted }}>{SOURCE_LABELS[row.source] || row.source}</span> },
    { key: 'actions', label: '', render: (row) => (
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <OpsButton small variant="ghost" onClick={() => { setFormError(''); setEditing({ ...emptyContact, ...row, tags: row.tags || [] }) }}>Edit</OpsButton>
        <OpsButton small variant="danger" onClick={() => remove(row)}>Delete</OpsButton>
      </div>
    ) },
  ]

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Contacts</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <OpsButton small variant="ghost" onClick={exportCsv} disabled={!contacts.length}>Export CSV</OpsButton>
          <OpsButton small variant="ghost" onClick={() => setShowEmailAdd(true)}>Add from email</OpsButton>
          <OpsButton small variant="ghost" onClick={() => setShowImport(true)}>Import Excel / CSV</OpsButton>
          <OpsButton small variant="gold" onClick={() => { setFormError(''); setEditing({ ...emptyContact }) }}>+ Add contact</OpsButton>
        </div>
      </div>
      <p style={{ color: OPS_COLORS.muted, fontSize: 13, margin: '0 0 14px' }}>
        Every school, parent, client and partner in one organised database. Add records manually, import old spreadsheets,
        or let website enquiries and forwarded emails file themselves here automatically.
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <input style={{ ...opsInputStyle, maxWidth: 280 }} placeholder="Search name, email, phone, tag…" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select style={{ ...opsInputStyle, maxWidth: 170 }} value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
          <option value="">All types</option>
          {KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>

      {notice && <p style={{ color: OPS_COLORS.okGreen, fontSize: 13 }}>{notice}</p>}
      {loadError && <p style={{ color: OPS_COLORS.warn, fontSize: 13 }}>Contacts could not be loaded ({loadError}). Has the 20260921_crm_contacts.sql migration been applied in Supabase?</p>}
      {loading ? <p style={{ color: OPS_COLORS.muted }}>Loading contacts…</p> : (
        <DataTable
          columns={columns}
          rows={filtered}
          expanded={expanded}
          onToggleExpand={() => setExpanded((current) => !current)}
          pageSize={10}
          emptyState={<EmptyState icon="📇" title="No contacts yet" body="Add your first contact, or import your old business spreadsheet to bring everything across in one go." ctaLabel="Import Excel / CSV" onCta={() => setShowImport(true)} />}
        />
      )}

      {editing && (
        <div style={overlayStyle} onClick={(event) => { if (event.target === event.currentTarget) setEditing(null) }}>
          <div style={modalStyle}>
            <h3 style={{ margin: '0 0 14px', fontFamily: "'Iowan Old Style', Georgia, serif", color: OPS_COLORS.emerald, fontWeight: 400 }}>{editing.id ? 'Edit contact' : 'Add contact'}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={{ display: 'block' }}><span style={labelStyle}>Name *</span><input style={opsInputStyle} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
              <label style={{ display: 'block' }}><span style={labelStyle}>Type</span>
                <select style={opsInputStyle} value={editing.kind} onChange={(event) => setEditing({ ...editing, kind: event.target.value })}>
                  {KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label style={{ display: 'block' }}><span style={labelStyle}>Organisation / school</span><input style={opsInputStyle} value={editing.organisation || ''} onChange={(event) => setEditing({ ...editing, organisation: event.target.value })} /></label>
              <label style={{ display: 'block' }}><span style={labelStyle}>Email</span><input type="email" style={opsInputStyle} value={editing.email || ''} onChange={(event) => setEditing({ ...editing, email: event.target.value })} /></label>
              <label style={{ display: 'block' }}><span style={labelStyle}>Phone</span><input style={opsInputStyle} value={editing.phone || ''} onChange={(event) => setEditing({ ...editing, phone: event.target.value })} /></label>
              <label style={{ display: 'block' }}><span style={labelStyle}>Tags (comma separated)</span><input style={opsInputStyle} placeholder="e.g. bhm, workshop, vip" value={editing.tags.join(', ')} onChange={(event) => setEditing({ ...editing, tags: event.target.value.split(',') })} /></label>
            </div>
            <label style={{ display: 'block', marginTop: 10 }}><span style={labelStyle}>Address</span><input style={opsInputStyle} value={editing.address || ''} onChange={(event) => setEditing({ ...editing, address: event.target.value })} /></label>
            <label style={{ display: 'block', marginTop: 10 }}><span style={labelStyle}>Notes</span><textarea style={{ ...opsInputStyle, minHeight: 70 }} value={editing.notes || ''} onChange={(event) => setEditing({ ...editing, notes: event.target.value })} /></label>
            {formError && <p style={{ color: OPS_COLORS.warn, fontSize: 13 }}>{formError}</p>}
            <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'flex-end' }}>
              <OpsButton variant="ghost" onClick={() => setEditing(null)}>Cancel</OpsButton>
              <OpsButton disabled={saving} onClick={saveForm}>{saving ? 'Saving…' : 'Save contact'}</OpsButton>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <ImportWizard
          existingCount={contacts.length}
          onClose={() => setShowImport(false)}
          onDone={async (summary) => { setShowImport(false); setNotice(`Import complete — ${summary.added} added, ${summary.updated} updated, ${summary.skipped} skipped.`); await load() }}
          upsertOne={upsertOne}
        />
      )}

      {showEmailAdd && (
        <EmailQuickAdd
          onClose={() => setShowEmailAdd(false)}
          onDone={async (name) => { setShowEmailAdd(false); setNotice(`${name} filed from email.`); await load() }}
          upsertOne={upsertOne}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Import wizard — .xlsx/.csv upload or paste-from-Excel, then column  */
/* mapping, preview and dedupe-on-import.                              */
/* ------------------------------------------------------------------ */
function ImportWizard({ existingCount, onClose, onDone, upsertOne }) {
  const [headers, setHeaders] = useState([])
  const [rows, setRows] = useState([])
  const [mapping, setMapping] = useState({})
  const [parseError, setParseError] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [importing, setImporting] = useState(false)

  const acceptRows = (grid) => {
    if (!grid.length) { setParseError('No rows found in that data.'); return }
    const [first, ...rest] = grid
    setHeaders(first.map((header, index) => String(header || '').trim() || `Column ${index + 1}`))
    setRows(rest)
    setMapping(guessMapping(first))
    setParseError('')
  }

  const handleFile = async (file) => {
    if (!file) return
    setParseError('')
    try {
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        const XLSX = await import('xlsx')
        const workbook = XLSX.read(await file.arrayBuffer())
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        acceptRows(XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }))
      } else {
        acceptRows(parseDelimited(await file.text()))
      }
    } catch (error) {
      setParseError(`That file could not be read (${error.message}). Try saving it as CSV and uploading again.`)
    }
  }

  const runImport = async () => {
    if (mapping.name === '' && mapping.email === '') { setParseError('Map at least the Name or Email column before importing.'); return }
    setImporting(true)
    const summary = { added: 0, updated: 0, skipped: 0, errors: 0 }
    const seenEmails = new Set() // catch duplicates inside the file itself
    for (const row of rows) {
      const pick = (key) => (mapping[key] === '' ? '' : String(row[mapping[key]] ?? '').trim())
      const draft = {
        kind: normalizeKind(pick('kind')),
        name: pick('name') || (pick('email') ? pick('email').split('@')[0].replace(/[._-]+/g, ' ') : ''),
        organisation: pick('organisation'),
        email: pick('email'),
        phone: pick('phone'),
        address: pick('address'),
        tags: pick('tags') ? pick('tags').split(/[;,]/) : [],
        notes: pick('notes'),
      }
      const emailKey = draft.email.toLowerCase()
      if (!draft.name && !emailKey) { summary.skipped += 1; continue }
      if (emailKey && seenEmails.has(emailKey)) { summary.skipped += 1; continue }
      if (emailKey) seenEmails.add(emailKey)
      const result = await upsertOne(draft, 'import') // eslint-disable-line no-await-in-loop
      summary[result.status === 'error' ? 'errors' : result.status] += 1
    }
    setImporting(false)
    onDone(summary)
  }

  return (
    <div style={overlayStyle} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div style={{ ...modalStyle, maxWidth: 720 }}>
        <h3 style={{ margin: '0 0 6px', fontFamily: "'Iowan Old Style', Georgia, serif", color: OPS_COLORS.emerald, fontWeight: 400 }}>Import contacts</h3>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: OPS_COLORS.muted }}>
          Bring across your old business records. Upload an Excel (.xlsx) or CSV file, or copy cells in Excel and paste them straight in.
          Existing contacts ({existingCount}) are matched by email and updated — never duplicated.
        </p>

        {!headers.length && (
          <>
            <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" onChange={(event) => handleFile(event.target.files?.[0])} style={{ marginBottom: 14 }} />
            <label style={{ display: 'block' }}>
              <span style={labelStyle}>…or paste rows copied from Excel</span>
              <textarea style={{ ...opsInputStyle, minHeight: 110, fontFamily: 'monospace', fontSize: 12.5 }} placeholder={'Name\tSchool\tEmail\tPhone\nJane Doe\tOakridge School\tjane@oakridge.uk\t0121 555 1234'} value={pasteText} onChange={(event) => setPasteText(event.target.value)} />
            </label>
            <div style={{ marginTop: 10 }}>
              <OpsButton small disabled={!pasteText.trim()} onClick={() => acceptRows(parseDelimited(pasteText))}>Use pasted rows</OpsButton>
            </div>
          </>
        )}

        {headers.length > 0 && (
          <>
            <p style={{ fontSize: 13, color: OPS_COLORS.ink }}><strong>{rows.length}</strong> rows found. Match each field to a column:</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              {IMPORT_FIELDS.map((field) => (
                <label key={field.key} style={{ display: 'block' }}>
                  <span style={labelStyle}>{field.label}</span>
                  <select style={opsInputStyle} value={mapping[field.key]} onChange={(event) => setMapping({ ...mapping, [field.key]: event.target.value === '' ? '' : Number(event.target.value) })}>
                    <option value="">— skip —</option>
                    {headers.map((header, index) => <option key={index} value={index}>{header}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div style={{ border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 8, overflowX: 'auto', marginBottom: 14 }}>
              <table className="ops-table">
                <thead><tr>{IMPORT_FIELDS.filter((field) => mapping[field.key] !== '').map((field) => <th key={field.key}>{field.label}</th>)}</tr></thead>
                <tbody>
                  {rows.slice(0, 5).map((row, rowIndex) => (
                    <tr key={rowIndex}>{IMPORT_FIELDS.filter((field) => mapping[field.key] !== '').map((field) => <td key={field.key}>{String(row[mapping[field.key]] ?? '')}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 5 && <p style={{ fontSize: 12, color: OPS_COLORS.muted, marginTop: -8, marginBottom: 12 }}>Preview shows the first 5 of {rows.length} rows.</p>}
          </>
        )}

        {parseError && <p style={{ color: OPS_COLORS.warn, fontSize: 13 }}>{parseError}</p>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <OpsButton variant="ghost" onClick={onClose}>Cancel</OpsButton>
          {headers.length > 0 && <OpsButton disabled={importing} onClick={runImport}>{importing ? 'Importing…' : `Import ${rows.length} rows`}</OpsButton>}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Add from email — paste a raw email (or just a From line) and the    */
/* sender is filed as a contact, matched by email if they exist.       */
/* ------------------------------------------------------------------ */
function EmailQuickAdd({ onClose, onDone, upsertOne }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const parsed = parseEmailText(text)

  const file = async () => {
    if (!parsed.email) { setError('No email address found in what you pasted. Include the From line, e.g. From: Jane <jane@school.uk>'); return }
    setBusy(true)
    const note = [parsed.subject && `Email: ${parsed.subject}`, parsed.dateHeader && `Received: ${parsed.dateHeader}`].filter(Boolean).join(' · ')
    const result = await upsertOne({ ...emptyContact, kind: 'other', name: parsed.name || parsed.email, email: parsed.email, notes: note }, 'email')
    setBusy(false)
    if (result.status === 'error') { setError(result.error.message); return }
    onDone(parsed.name || parsed.email)
  }

  return (
    <div style={overlayStyle} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div style={modalStyle}>
        <h3 style={{ margin: '0 0 6px', fontFamily: "'Iowan Old Style', Georgia, serif", color: OPS_COLORS.emerald, fontWeight: 400 }}>Add from email</h3>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: OPS_COLORS.muted }}>
          Paste an email you received (in most email apps: open the message → View source / Show original → copy everything, or just copy the From and Subject lines).
        </p>
        <textarea style={{ ...opsInputStyle, minHeight: 130, fontFamily: 'monospace', fontSize: 12.5 }} placeholder={'From: Jane Doe <jane@oakridge.uk>\nSubject: Workshop enquiry\n…'} value={text} onChange={(event) => setText(event.target.value)} />
        {text.trim() && (
          <p style={{ fontSize: 13, color: OPS_COLORS.ink, background: OPS_COLORS.ivory, border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 8, padding: '8px 12px' }}>
            {parsed.email ? <>Found <strong>{parsed.name || 'Unknown'}</strong> &lt;{parsed.email}&gt;{parsed.subject ? ` — “${parsed.subject}”` : ''}</> : 'No email address detected yet…'}
          </p>
        )}
        {error && <p style={{ color: OPS_COLORS.warn, fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}>
          <OpsButton variant="ghost" onClick={onClose}>Cancel</OpsButton>
          <OpsButton disabled={busy || !text.trim()} onClick={file}>{busy ? 'Filing…' : 'File as contact'}</OpsButton>
        </div>
      </div>
    </div>
  )
}
