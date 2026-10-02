import React, { useEffect, useState } from 'react'
import { DataTable, EditableText, StatusMenu, EmptyState, OpsButton, OPS_COLORS } from './ui'
import { CreateArrearsModal, SubscriptionRequestModal, useAuthedFetch } from './FamilyBilling'

const shortDate = (value) => (value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '')
const money = (pence) => `£${(Number(pence || 0) / 100).toFixed(2)}`

function planLabel(planType) {
  return planType === 'monthly_membership' ? '£25 / month' : planType === 'day_pass' ? 'Day pass' : 'No plan'
}

function statusOf(family) {
  if (family.paused_at && family.membership_status === 'active') return 'Paused'
  return family.membership_status || 'pending'
}

function statusTone(label) {
  const value = label.toLowerCase()
  return value === 'active' ? 'green' : value === 'cancelled' ? 'red' : 'gold'
}

export default function SubscriptionsPage({ session, families, busyId, onAction, onSaveFamily, onRefresh = () => {} }) {
  const authedFetch = useAuthedFetch(session)
  const [requests, setRequests] = useState([])
  const [billing, setBilling] = useState(null)
  const [notice, setNotice] = useState('')
  const loadRequests = () => authedFetch('/api/admin/subscription-requests').then((result) => setRequests(result.requests || [])).catch((error) => setNotice(error.message))
  // Fresh family statuses and requests each time the page opens, so a parent who
  // has just finished a subscription checkout shows as active.
  useEffect(() => { loadRequests(); onRefresh() }, [])
  const latestRequest = (family) => requests.find((item) => item.familyId === family.id)

  const columns = [
    {
      key: 'guardian', label: 'Guardian', render: (family) => (
        <div>
          <EditableText value={family.guardian_name} onSave={(value) => onSaveFamily(family, { guardian_name: value })} />
          <div style={{ marginTop: 3 }}>
            <EditableText small value={family.guardian_email} placeholder="Add email" onSave={(value) => onSaveFamily(family, { guardian_email: value })} />
          </div>
        </div>
      ),
    },
    { key: 'plan', label: 'Plan', render: (family) => <span style={{ color: OPS_COLORS.ink }}>{planLabel(family.plan_type)}</span> },
    {
      key: 'since', label: 'Since', render: (family) => (
        <span style={{ color: OPS_COLORS.muted, fontSize: 12.5 }}>{family.created_at ? new Date(family.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Not set'}</span>
      ),
    },
    {
      key: 'status', label: 'Status', render: (family) => {
        const label = statusOf(family)
        const hasStripeSub = Boolean(family.stripe_subscription_id)
        const isActiveLike = family.membership_status === 'active'
        const options = []
        if (hasStripeSub && isActiveLike && !family.paused_at) options.push({ value: 'pause', label: 'Pause subscription' })
        if (hasStripeSub && isActiveLike && family.paused_at) options.push({ value: 'resume', label: 'Resume subscription' })
        if (hasStripeSub && isActiveLike) options.push({ value: 'cancel', label: 'Cancel subscription', danger: true })
        if (!hasStripeSub) {
          if (family.membership_status !== 'active') options.push({ value: 'set:active', label: 'Mark active' })
          if (family.membership_status !== 'inactive') options.push({ value: 'set:inactive', label: 'Mark inactive' })
          if (family.membership_status !== 'cancelled') options.push({ value: 'set:cancelled', label: 'Mark cancelled', danger: true })
        }
        if (!options.length) return <StatusMenu disabled value={label} label={label} tone={statusTone(label)} options={[]} onChange={() => {}} />
        return (
          <StatusMenu
            value={label}
            label={busyId === family.id ? 'Working…' : label}
            tone={statusTone(label)}
            options={options}
            onChange={(action) => {
              if (action.startsWith('set:')) onSaveFamily(family, { membership_status: action.slice(4) })
              else onAction(family, action)
            }}
          />
        )
      },
    },
    {
      key: 'stripe', label: 'Stripe', render: (family) => (
        <span style={{ color: OPS_COLORS.muted, fontSize: 12 }}>{family.stripe_subscription_id ? family.stripe_subscription_id.slice(0, 14) + '…' : 'No subscription'}</span>
      ),
    },
    {
      key: 'billing', label: 'Billing', render: (family) => {
        const latest = latestRequest(family)
        const live = Boolean(family.stripe_subscription_id) && family.membership_status === 'active'
        return (
          <div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <OpsButton small variant="ghost" disabled={!family.guardian_email} onClick={() => setBilling({ kind: 'arrears', familyId: family.id })}>Arrears…</OpsButton>
              {!live && <OpsButton small variant="ghost" disabled={!family.guardian_email} onClick={() => setBilling({ kind: 'subscription', familyId: family.id })}>Subscription request…</OpsButton>}
            </div>
            {latest && (
              <div style={{ fontSize: 11.5, marginTop: 4, color: latest.status === 'completed' ? OPS_COLORS.emerald : latest.status === 'failed' ? OPS_COLORS.warn : OPS_COLORS.muted }}>
                {latest.status === 'completed' ? `Subscription request completed ${shortDate(latest.completedAt)}` : latest.status === 'failed' ? `Request email failed ${shortDate(latest.createdAt)}` : `Request sent ${shortDate(latest.createdAt)} · not completed yet`}
              </div>
            )}
          </div>
        )
      },
    },
  ]
  const afterBilling = (message) => { setBilling(null); setNotice(message); loadRequests(); onRefresh() }

  return (
    <div className="panel">
      <div className="panel-head"><h3>Subscriptions</h3></div>
      {notice && <p style={{ background: '#faf1d9', color: '#6b5310', padding: '8px 12px', borderRadius: 6, fontSize: 13.5 }}>{notice} <button type="button" onClick={() => setNotice('')} style={{ border: 0, background: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 700 }}>×</button></p>}
      {billing?.kind === 'arrears' && <CreateArrearsModal session={session} families={families} initialFamilyId={billing.familyId} onClose={() => setBilling(null)} onCreated={(result) => afterBilling(`Arrears ${result.invoiceNumber} for ${money(result.amountPence)} (${result.monthsLabel}) created and emailed to ${result.recipient}. It now shows under Arrears.`)} />}
      {billing?.kind === 'subscription' && <SubscriptionRequestModal session={session} families={families} initialFamilyId={billing.familyId} onClose={() => setBilling(null)} onSent={(result) => afterBilling(`Subscription request (${result.plan.label}, ${result.children} ${result.children === 1 ? "child" : "children"}, £${(result.totalPence / 100).toFixed(2)}/month) emailed to ${result.recipient}.`)} />}
      <DataTable
        columns={columns}
        rows={families}
        expanded
        onToggleExpand={() => {}}
        pageSize={1000}
        emptyState={
          <EmptyState
            icon="💳"
            title="No subscriptions yet"
            body="Family memberships and day passes appear here after a parent completes checkout."
          />
        }
      />
    </div>
  )
}
