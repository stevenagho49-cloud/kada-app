import React from 'react'
import { DataTable, EditableText, StatusMenu, EmptyState, OPS_COLORS } from './ui'

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

export default function SubscriptionsPage({ families, busyId, onAction, onSaveFamily }) {
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
        <span style={{ color: OPS_COLORS.muted, fontSize: 12.5 }}>{family.created_at ? new Date(family.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</span>
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
  ]

  return (
    <div className="panel">
      <div className="panel-head"><h3>Subscriptions</h3></div>
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
