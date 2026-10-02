import React, { useEffect, useMemo, useState } from 'react'
import { DataTable, EditableText, StatusMenu, EmptyState, OpsButton, Pill, OPS_COLORS, OPS_SERIF } from './ui'
import { CreateArrearsModal, SubscriptionRequestModal, useAuthedFetch } from './FamilyBilling'

/* ------------------------------------------------------------------ */
/* Sales > Subscriptions. The main table is real subscription activity  */
/* only (a Stripe subscription, or a family on the Monthly Membership). */
/* Every other parent account sits in a separate, collapsed list that   */
/* says plainly where they are: awaiting email confirmation, confirmed  */
/* with no plan chosen yet, or added by staff with no login.            */
/* ------------------------------------------------------------------ */

const shortDate = (value) => (value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '')
const longDate = (value) => (value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '')
const money = (pence) => `£${(Number(pence || 0) / 100).toFixed(2)}`

const isSubscription = (family) => Boolean(family.stripe_subscription_id) || family.plan_type === 'monthly_membership'

// Subscription status in plain words.
function subscriptionStatus(family) {
  if (family.membership_status === 'active') return family.paused_at ? { label: 'Paused', tone: 'gold' } : { label: 'Active', tone: 'green' }
  if (family.membership_status === 'cancelled') return { label: 'Cancelled', tone: 'red' }
  if (family.membership_status === 'inactive') return { label: 'Payment problem', tone: 'red' }
  return { label: 'Checkout not finished', tone: 'gold' }
}

// Where a parent without a subscription is.
function accountStatus(family, account) {
  if (account?.state === 'awaiting_confirmation') return { key: 'awaiting', label: 'Awaiting email confirmation', tone: 'gold', detail: `Signed up ${shortDate(account.signedUpAt)}, hasn't clicked the confirmation link yet` }
  if (account?.state === 'no_login') return { key: 'no_login', label: 'No login yet', tone: 'default', detail: 'Added by staff; the parent has not created an account' }
  if (!account) return { key: 'unknown', label: 'Checking…', tone: 'default', detail: '' }
  return family.plan_type === 'day_pass'
    ? { key: 'no_plan', label: 'Confirmed · pays per class', tone: 'default', detail: `Confirmed ${shortDate(account.confirmedAt)}; buys day passes, no subscription` }
    : { key: 'no_plan', label: 'Confirmed · no plan yet', tone: 'default', detail: `Confirmed ${shortDate(account.confirmedAt)}; hasn't chosen a plan` }
}

const ACCOUNT_ORDER = { awaiting: 0, no_plan: 1, no_login: 2, unknown: 3 }

export default function SubscriptionsPage({ session, families, busyId, onAction, onSaveFamily, onRefresh = () => {} }) {
  const authedFetch = useAuthedFetch(session)
  const [requests, setRequests] = useState([])
  const [accounts, setAccounts] = useState(null)
  const [billing, setBilling] = useState(null)
  const [notice, setNotice] = useState('')
  const [showOthers, setShowOthers] = useState(false)
  const loadRequests = () => authedFetch('/api/admin/subscription-requests').then((result) => setRequests(result.requests || [])).catch((error) => setNotice(error.message))
  const loadAccounts = () => authedFetch('/api/admin/family-accounts').then((result) => setAccounts(result.accounts || {})).catch((error) => { setAccounts({}); setNotice(error.message) })
  // Fresh statuses each time the page opens, so a parent who has just confirmed
  // their email or finished a subscription checkout shows in the right place.
  useEffect(() => { loadRequests(); loadAccounts(); onRefresh() }, [])
  const latestRequest = (family) => requests.find((item) => item.familyId === family.id)

  const subscribed = useMemo(() => families.filter(isSubscription), [families])
  const others = useMemo(() => families.filter((family) => !isSubscription(family))
    .map((family) => ({ ...family, account: accountStatus(family, accounts?.[family.id]) }))
    .sort((a, b) => ACCOUNT_ORDER[a.account.key] - ACCOUNT_ORDER[b.account.key] || String(b.created_at || '').localeCompare(String(a.created_at || ''))), [families, accounts])
  const counts = {
    active: subscribed.filter((family) => subscriptionStatus(family).label === 'Active').length,
    paused: subscribed.filter((family) => subscriptionStatus(family).label === 'Paused').length,
    cancelled: subscribed.filter((family) => subscriptionStatus(family).label === 'Cancelled').length,
    awaiting: others.filter((family) => family.account.key === 'awaiting').length,
    noPlan: others.filter((family) => family.account.key === 'no_plan').length,
  }

  const requestNote = (family) => {
    const latest = latestRequest(family)
    if (!latest) return null
    return (
      <div style={{ fontSize: 11.5, marginTop: 4, color: latest.status === 'completed' ? OPS_COLORS.emerald : latest.status === 'failed' ? OPS_COLORS.warn : OPS_COLORS.muted }}>
        {latest.status === 'completed' ? `Subscription request completed ${shortDate(latest.completedAt)}` : latest.status === 'failed' ? `Request email failed ${shortDate(latest.createdAt)}` : `Request sent ${shortDate(latest.createdAt)} · not completed yet`}
      </div>
    )
  }
  const guardianCell = (family) => (
    <div>
      <EditableText value={family.guardian_name} onSave={(value) => onSaveFamily(family, { guardian_name: value })} />
      <div style={{ marginTop: 3 }}>
        <EditableText small value={family.guardian_email} placeholder="Add email" onSave={(value) => onSaveFamily(family, { guardian_email: value })} />
      </div>
    </div>
  )

  const subscriptionColumns = [
    { key: 'guardian', label: 'Guardian', render: guardianCell },
    {
      key: 'plan', label: 'Plan', render: (family) => family.membership_pricing === 'per_child' ? (
        <div>
          <div style={{ color: OPS_COLORS.ink }}>Monthly Membership · {money(family.membership_monthly_pence || 0)}/month</div>
          <div style={{ fontSize: 11.5, color: OPS_COLORS.muted }}>{family.membership_children ? `${family.membership_children} ${family.membership_children === 1 ? 'child' : 'children'} × ${money(Math.round((family.membership_monthly_pence || 0) / family.membership_children))} (per child)` : 'Per child'}</div>
        </div>
      ) : (
        <div>
          <div style={{ color: OPS_COLORS.ink }}>Monthly Membership{family.membership_monthly_pence ? ` · ${money(family.membership_monthly_pence)}/month` : ''}</div>
          <div style={{ fontSize: 11.5, color: OPS_COLORS.muted }}>Old flat rate per family, kept until you switch it</div>
        </div>
      ),
    },
    {
      key: 'status', label: 'Subscription', render: (family) => {
        const { label, tone } = subscriptionStatus(family)
        const hasStripeSub = Boolean(family.stripe_subscription_id)
        const isActiveLike = family.membership_status === 'active'
        const options = []
        if (hasStripeSub && isActiveLike && !family.paused_at) options.push({ value: 'pause', label: 'Pause subscription' })
        if (hasStripeSub && isActiveLike && family.paused_at) options.push({ value: 'resume', label: 'Resume subscription' })
        if (hasStripeSub && isActiveLike && family.membership_pricing !== 'per_child') options.push({ value: 'per-child', label: 'Switch to per-child pricing' })
        if (hasStripeSub && isActiveLike) options.push({ value: 'cancel', label: 'Cancel subscription', danger: true })
        if (!hasStripeSub) {
          if (family.membership_status !== 'active') options.push({ value: 'set:active', label: 'Mark active' })
          if (family.membership_status !== 'cancelled') options.push({ value: 'set:cancelled', label: 'Mark cancelled', danger: true })
        }
        if (!options.length) return <StatusMenu disabled value={label} label={label} tone={tone} options={[]} onChange={() => {}} />
        return (
          <StatusMenu
            value={label}
            label={busyId === family.id ? 'Working…' : label}
            tone={tone}
            options={options}
            onChange={(action) => {
              if (action.startsWith('set:')) onSaveFamily(family, { membership_status: action.slice(4) })
              else if (action === 'per-child') {
                if (window.confirm(`Switch ${family.guardian_name || 'this family'} from their flat rate${family.membership_monthly_pence ? ` (${money(family.membership_monthly_pence)}/month)` : ''} to the Monthly Membership price per child? The new amount starts from their next payment, and they'll be emailed about it.`)) onAction(family, action)
              } else onAction(family, action)
            }}
          />
        )
      },
    },
    {
      key: 'stripe', label: 'Stripe', render: (family) => (
        <span style={{ color: OPS_COLORS.muted, fontSize: 12 }}>{family.stripe_subscription_id ? family.stripe_subscription_id.slice(0, 14) + '…' : 'Managed by hand (no Stripe subscription)'}</span>
      ),
    },
    {
      key: 'billing', label: 'Billing', render: (family) => {
        const live = Boolean(family.stripe_subscription_id) && family.membership_status === 'active'
        return (
          <div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <OpsButton small variant="ghost" disabled={!family.guardian_email} onClick={() => setBilling({ kind: 'arrears', familyId: family.id })}>Arrears…</OpsButton>
              {!live && <OpsButton small variant="ghost" disabled={!family.guardian_email} onClick={() => setBilling({ kind: 'subscription', familyId: family.id })}>Subscription request…</OpsButton>}
            </div>
            {requestNote(family)}
          </div>
        )
      },
    },
  ]

  const accountColumns = [
    { key: 'guardian', label: 'Parent', render: guardianCell },
    {
      key: 'account', label: 'Account', render: (family) => (
        <div>
          <Pill text={family.account.label} tone={family.account.tone} />
          {family.account.detail && <div style={{ fontSize: 11.5, color: OPS_COLORS.muted, marginTop: 4 }}>{family.account.detail}</div>}
        </div>
      ),
    },
    { key: 'since', label: 'Added', render: (family) => <span style={{ color: OPS_COLORS.muted, fontSize: 12.5 }}>{longDate(family.created_at) || 'Not set'}</span> },
    {
      key: 'billing', label: 'Billing', render: (family) => (
        <div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <OpsButton small variant="ghost" disabled={!family.guardian_email} onClick={() => setBilling({ kind: 'arrears', familyId: family.id })}>Arrears…</OpsButton>
            <OpsButton small variant="ghost" disabled={!family.guardian_email} onClick={() => setBilling({ kind: 'subscription', familyId: family.id })}>Subscription request…</OpsButton>
          </div>
          {requestNote(family)}
        </div>
      ),
    },
  ]
  const afterBilling = (message) => { setBilling(null); setNotice(message); loadRequests(); onRefresh() }

  const tile = (label, value, tone) => (
    <div key={label} style={{ background: OPS_COLORS.ivory, border: `1px solid ${OPS_COLORS.rule}`, borderRadius: 8, padding: '10px 14px' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: OPS_COLORS.muted, fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: OPS_SERIF, fontSize: 22, color: tone || OPS_COLORS.emerald }}>{value}</div>
    </div>
  )

  return (
    <div>
      {notice && <p style={{ background: '#faf1d9', color: '#6b5310', padding: '8px 12px', borderRadius: 6, fontSize: 13.5 }}>{notice} <button type="button" onClick={() => setNotice('')} style={{ border: 0, background: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 700 }}>×</button></p>}
      {billing?.kind === 'arrears' && <CreateArrearsModal session={session} families={families} initialFamilyId={billing.familyId} onClose={() => setBilling(null)} onCreated={(result) => afterBilling(`Arrears ${result.invoiceNumber} for ${money(result.amountPence)} (${result.monthsLabel}) created and emailed to ${result.recipient}. It now shows under Arrears.`)} />}
      {billing?.kind === 'subscription' && <SubscriptionRequestModal session={session} families={families} initialFamilyId={billing.familyId} onClose={() => setBilling(null)} onSent={(result) => afterBilling(`Subscription request (${result.plan.label}, ${result.children} ${result.children === 1 ? 'child' : 'children'}, £${(result.totalPence / 100).toFixed(2)}/month) emailed to ${result.recipient}.`)} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        {tile('Active subscriptions', counts.active)}
        {tile('Paused', counts.paused)}
        {tile('Cancelled', counts.cancelled, counts.cancelled ? OPS_COLORS.warn : undefined)}
        {tile('Awaiting email confirmation', accounts ? counts.awaiting : '…')}
        {tile('Confirmed, no plan yet', accounts ? counts.noPlan : '…')}
      </div>

      <div className="panel">
        <div className="panel-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h3>Subscriptions</h3>
          <OpsButton small onClick={() => setBilling({ kind: 'subscription', familyId: '' })}>Send subscription request</OpsButton>
        </div>
        <p style={{ margin: '0 0 10px', fontSize: 13, color: OPS_COLORS.muted }}>Families on the Monthly Membership: active, paused, cancelled, or with a checkout that wasn't finished.</p>
        <DataTable
          columns={subscriptionColumns}
          rows={subscribed}
          expanded
          onToggleExpand={() => {}}
          pageSize={1000}
          emptyState={<EmptyState icon="💳" title="No subscriptions yet" body="Families appear here once they start a Monthly Membership. Use Send subscription request to invite an existing parent." />}
        />
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <button type="button" aria-expanded={showOthers} onClick={() => setShowOthers((value) => !value)} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', width: '100%', font: 'inherit' }}>
          <h3 style={{ margin: 0, fontFamily: OPS_SERIF, color: OPS_COLORS.emerald, fontWeight: 400 }}>{showOthers ? '▾' : '▸'} Parent accounts without a subscription ({others.length})</h3>
          <span style={{ fontSize: 13, color: OPS_COLORS.muted }}>Not subscriptions: parents who are awaiting email confirmation ({accounts ? counts.awaiting : '…'}), confirmed with no plan yet ({accounts ? counts.noPlan : '…'}), or added by staff without a login.</span>
        </button>
        {showOthers && (
          <div style={{ marginTop: 12 }}>
            <DataTable columns={accountColumns} rows={others} expanded onToggleExpand={() => {}} pageSize={1000} emptyState={<EmptyState icon="👪" title="Every parent has a subscription" body="" />} />
          </div>
        )}
      </div>
    </div>
  )
}
