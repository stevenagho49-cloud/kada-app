import React, { useState } from "react";
import { COLORS, BORDER_STRONG } from "../theme";
import { PageHeader, StatTile, Avatar, StatusBadge, PrimaryButton, SecondaryButton, Card, Modal } from "../shared/ui";

const INITIAL_SUBS = [
  { id: 1, customer: "Maria Omoigui", plan: "Monthly plan", status: "Paused", start: "Jan 31, 2026", lastPayment: "Paid" },
  { id: 2, customer: "Malaiyah Nelson-...", plan: "Monthly plan", status: "Paused", start: "Nov 17, 2025", lastPayment: "Paid" },
  { id: 3, customer: "N Spence", plan: "Monthly plan", status: "Canceled", start: "Nov 14, 2025", lastPayment: "Failed" },
];

export default function SubscriptionsPage({ breadcrumb }) {
  const [subs, setSubs] = useState(INITIAL_SUBS);
  const [active, setActive] = useState(null);
  const activeCount = subs.filter((s) => s.status !== "Canceled").length;

  const setStatus = (status) => {
    setSubs((prev) => prev.map((s) => (s.id === active.id ? { ...s, status } : s)));
    setActive((a) => ({ ...a, status }));
  };

  return (
    <div>
      <PageHeader breadcrumb={breadcrumb} title="Subscriptions" subtitle="Every Monthly Membership sold through Stripe."
        right={<PrimaryButton onClick={() => alert("New plans are created in your real Stripe/Wix dashboard, not previewed here.")}>+ Sell a pricing plan</PrimaryButton>} />

      <div className="flex gap-4 mb-6">
        <StatTile label="Total subscriptions" value={subs.length} prefix="" />
        <StatTile label="Active" value={activeCount} prefix="" tone="paid" />
      </div>

      <Card noPadding className="overflow-hidden">
        <div className="grid text-[13px] px-4 py-2" style={{ gridTemplateColumns: "1.6fr 1.2fr 1fr 1fr 1fr", color: COLORS.inkSoft, borderBottom: `1px solid ${BORDER_STRONG}` }}>
          <div>Customer</div><div>Plan</div><div>Status</div><div>Start date</div><div>Last payment</div>
        </div>
        {subs.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setActive(s)}
            className="grid items-center px-4 py-3 text-[15px] w-full text-left"
            style={{ gridTemplateColumns: "1.6fr 1.2fr 1fr 1fr 1fr", borderBottom: i < subs.length - 1 ? `1px solid ${BORDER_STRONG}` : "none", color: COLORS.ink }}
          >
            <div className="flex items-center gap-2"><Avatar name={s.customer} />{s.customer}</div>
            <div style={{ color: COLORS.inkSoft }}>{s.plan}</div>
            <div><StatusBadge status={s.status} /></div>
            <div style={{ color: COLORS.inkSoft }}>{s.start}</div>
            <div><StatusBadge status={s.lastPayment} /></div>
          </button>
        ))}
      </Card>

      {active && (
        <Modal
          title={active.customer}
          onClose={() => setActive(null)}
          footer={
            active.status === "Canceled" ? (
              <PrimaryButton onClick={() => setActive(null)}>Done</PrimaryButton>
            ) : active.status === "Paused" ? (
              <>
                <SecondaryButton onClick={() => setStatus("Canceled")}>Cancel plan</SecondaryButton>
                <PrimaryButton onClick={() => setStatus("Confirmed")}>Resume subscription</PrimaryButton>
              </>
            ) : (
              <>
                <SecondaryButton onClick={() => setStatus("Canceled")}>Cancel plan</SecondaryButton>
                <PrimaryButton onClick={() => setStatus("Paused")}>Pause subscription</PrimaryButton>
              </>
            )
          }
        >
          <p className="text-[15px] mb-1" style={{ color: COLORS.inkSoft }}>Plan: <span style={{ color: COLORS.ink }}>{active.plan}</span></p>
          <p className="text-[15px] mb-1" style={{ color: COLORS.inkSoft }}>Status: <StatusBadge status={active.status} /></p>
          <p className="text-[15px]" style={{ color: COLORS.inkSoft }}>Started: <span style={{ color: COLORS.ink }}>{active.start}</span></p>
        </Modal>
      )}
    </div>
  );
}
