import React, { useState } from "react";
import { COLORS, FONT_SERIF, BORDER_STRONG } from "../theme";
import { PageHeader, StatTile, PrimaryButton, StatusBadge, Card, Modal, FormField, TextInput, SecondaryButton } from "../shared/ui";

const INITIAL_ORDERS = [
  { id: "#10060", customer: "Maria Omoigui", date: "Feb 28, 2026", total: 25, payment: "Paid", fulfillment: "Fulfilled" },
  { id: "#10059", customer: "Nessa Nelson", date: "Feb 17, 2026", total: 25, payment: "Paid", fulfillment: "Fulfilled" },
  { id: "#10058", customer: "Melissa Lewis", date: "Feb 15, 2026", total: 20, payment: "Paid", fulfillment: "Fulfilled" },
  { id: "#10057", customer: "Maria Omoigui", date: "Jan 31, 2026", total: 25, payment: "Paid", fulfillment: "Fulfilled" },
  { id: "#10056", customer: "Nessa Nelson", date: "Jan 17, 2026", total: 25, payment: "Paid", fulfillment: "Fulfilled" },
];

export default function OrdersPage({ breadcrumb }) {
  const [orders, setOrders] = useState(INITIAL_ORDERS);
  const [addOpen, setAddOpen] = useState(false);
  const [active, setActive] = useState(null);
  const [form, setForm] = useState({ customer: "", total: "" });

  const addOrder = () => {
    if (!form.customer.trim() || !form.total) { alert("Add a customer name and total first."); return; }
    setOrders((prev) => [
      { id: `#${10061 + prev.length}`, customer: form.customer, date: "Sep 15, 2026", total: Number(form.total), payment: "Paid", fulfillment: "Fulfilled" },
      ...prev,
    ]);
    setAddOpen(false);
    setForm({ customer: "", total: "" });
  };

  return (
    <div>
      <PageHeader breadcrumb={breadcrumb} title="Orders" subtitle="Day Pass and Monthly Membership purchases from Stripe Checkout."
        right={<PrimaryButton onClick={() => setAddOpen(true)}>+ Add new order</PrimaryButton>} />

      <div className="flex gap-4 mb-6">
        <StatTile label="Sales (30 days)" value={orders.reduce((s, o) => s + o.total, 0)} />
        <StatTile label="Orders" value={orders.length} prefix="" />
        <StatTile label="Avg. order value" value={Math.round(orders.reduce((s, o) => s + o.total, 0) / orders.length)} />
      </div>

      <Card noPadding className="overflow-hidden">
        <div className="grid text-[13px] px-4 py-2" style={{ gridTemplateColumns: "1fr 1.4fr 1.2fr 1fr 1fr 1fr", color: COLORS.inkSoft, borderBottom: `1px solid ${BORDER_STRONG}` }}>
          <div>Order</div><div>Customer</div><div>Date created</div><div>Payment</div><div>Fulfillment</div><div className="text-right">Total</div>
        </div>
        {orders.map((o, i) => (
          <button
            key={o.id}
            onClick={() => setActive(o)}
            className="grid items-center px-4 py-3 text-[15px] w-full text-left"
            style={{ gridTemplateColumns: "1fr 1.4fr 1.2fr 1fr 1fr 1fr", borderBottom: i < orders.length - 1 ? `1px solid ${BORDER_STRONG}` : "none", color: COLORS.ink }}
          >
            <div style={{ fontFamily: FONT_SERIF, fontWeight: 600 }}>{o.id}</div>
            <div>{o.customer}</div>
            <div style={{ color: COLORS.inkSoft }}>{o.date}</div>
            <div><StatusBadge status={o.payment} /></div>
            <div><StatusBadge status={o.fulfillment} /></div>
            <div className="text-right" style={{ fontWeight: 500 }}>£{o.total.toFixed(2)}</div>
          </button>
        ))}
      </Card>

      {addOpen && (
        <Modal title="Add new order" onClose={() => setAddOpen(false)}
          footer={<><SecondaryButton onClick={() => setAddOpen(false)}>Cancel</SecondaryButton><PrimaryButton onClick={addOrder}>Add order</PrimaryButton></>}>
          <FormField label="Customer name"><TextInput value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} placeholder="e.g. Grace Adeyemi" /></FormField>
          <FormField label="Total (£)"><TextInput type="number" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} placeholder="25" /></FormField>
        </Modal>
      )}

      {active && (
        <Modal title={`Order ${active.id}`} onClose={() => setActive(null)} footer={<PrimaryButton onClick={() => setActive(null)}>Done</PrimaryButton>}>
          <p className="text-[15px] mb-1" style={{ color: COLORS.inkSoft }}>Customer: <span style={{ color: COLORS.ink }}>{active.customer}</span></p>
          <p className="text-[15px] mb-1" style={{ color: COLORS.inkSoft }}>Date: <span style={{ color: COLORS.ink }}>{active.date}</span></p>
          <p className="text-[15px]" style={{ color: COLORS.inkSoft }}>Total: <span style={{ color: COLORS.ink }}>£{active.total.toFixed(2)}</span></p>
        </Modal>
      )}
    </div>
  );
}
