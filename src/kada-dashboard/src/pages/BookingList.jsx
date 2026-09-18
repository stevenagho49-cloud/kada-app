import React, { useMemo, useState } from "react";
import { COLORS, BORDER_STRONG } from "../theme";
import { PageHeader, StatTile, FilterChip, StatusBadge, Card, Tabs, EmptyState } from "../shared/ui";

const MOCK_BOOKINGS = [
  { id: "B-1042", customer: "Myatt Garden Primary", session: "School workshop", status: "Confirmed", amount: 180, paid: true, date: "Invoice sent", contact: "Mrs. Adebayo", email: "head@myattgarden.org", location: "Birmingham", notes: "Primary enrichment, 22 students." },
  { id: "B-1041", customer: "Cambridge School SEND", session: "School workshop", status: "Confirmed", amount: 490, paid: false, date: "14 Oct 2026", contact: "Mr. Collins", email: "admin@cambridgeschool.org", location: "Solihull", notes: "Accessible mobility session with 2 staff recommended." },
  { id: "B-1040", customer: "University of Birmingham", session: "Term sessions (29)", status: "Confirmed", amount: 3132, paid: true, date: "Ongoing", contact: "Aisha Rahman", email: "a.rahman@bham.ac.uk", location: "Birmingham", notes: "Weekly cohort booking, invoice already settled." },
  { id: "B-1039", customer: "St Stephen's C of E Primary", session: "8 sessions — Black History Month", status: "Confirmed", amount: 720, paid: false, date: "Scheduled", contact: "Ms. Lewis", email: "office@ststephens.org", location: "Birmingham", notes: "School festival package, 8 sessions booked." },
  { id: "B-1038", customer: "Oakfield Primary", session: "2 sessions", status: "Pending", amount: 780, paid: false, date: "Urgent — school chasing", contact: "Mr. Singh", email: "hello@oakfieldprimary.org", location: "West Midlands", notes: "Awaiting final confirmation and payment terms." },
  { id: "B-1037", customer: "Shacklewell Primary", session: "TBC", status: "Pending", amount: 0, paid: false, date: "Not yet invoiced", contact: "Mrs. Grant", email: "bookings@shacklewell.org", location: "London", notes: "Needs a quote before final commitment." },
];

function ToolbarButton({ active, children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: `1px solid ${active ? COLORS.ink : BORDER_STRONG}`,
        background: active ? COLORS.ink : COLORS.white,
        color: active ? COLORS.white : COLORS.ink,
        borderRadius: 10,
        padding: "8px 12px",
        fontSize: 14,
        fontWeight: 600,
      }}
    >
      {children}
    </button>
  );
}

export default function BookingListPage({ breadcrumb }) {
  const [tab, setTab] = useState("Appointments & Classes");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [selectedId, setSelectedId] = useState("B-1042");

  const filtered = useMemo(() => {
    if (tab === "Courses") return [];
    return MOCK_BOOKINGS.filter((b) => statusFilter === "All statuses" || b.status === statusFilter);
  }, [tab, statusFilter]);

  const selectedBooking = useMemo(
    () => filtered.find((b) => b.id === selectedId) || filtered[0] || null,
    [filtered, selectedId]
  );

  const totals = useMemo(() => {
    const total = filtered.reduce((sum, b) => sum + b.amount, 0);
    const paid = filtered.filter((b) => b.paid).reduce((sum, b) => sum + b.amount, 0);
    return { total, paid, unpaid: total - paid };
  }, [filtered]);

  return (
    <div>
      <PageHeader
        breadcrumb={breadcrumb}
        title="Operations"
        subtitle="A cleaner, more organised view of bookings, revenue and school activity."
        right={
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <ToolbarButton active={false}>This month</ToolbarButton>
            <ToolbarButton active>New booking</ToolbarButton>
          </div>
        }
      />

      <div className="grid gap-4 mb-5 md:grid-cols-3">
        <div style={{ padding: "2px 0" }}>
          <StatTile label="Total bookings" value={totals.total} />
        </div>
        <div style={{ padding: "2px 0" }}>
          <StatTile label="Unpaid bookings" value={totals.unpaid} tone="unpaid" />
        </div>
        <div style={{ padding: "2px 0" }}>
          <StatTile label="Paid bookings" value={totals.paid} tone="paid" />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <Tabs tabs={["Appointments & Classes", "Courses"]} active={tab} onChange={setTab} />
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {['All statuses', 'Confirmed', 'Pending'].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              style={{
                borderRadius: 999,
                padding: '7px 12px',
                border: `1px solid ${statusFilter === status ? COLORS.ink : BORDER_STRONG}`,
                background: statusFilter === status ? COLORS.ink : COLORS.white,
                color: statusFilter === status ? COLORS.white : COLORS.ink,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
        <FilterChip onRemove={() => setStatusFilter('All statuses')}>Status: {statusFilter}</FilterChip>
        <FilterChip onRemove={() => setTab('Appointments & Classes')}>Type: {tab}</FilterChip>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No matches found"
          body="Adjust your filters to see more bookings."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[2.3fr_0.9fr]">
          <Card noPadding className="overflow-hidden">
            <div
              className="grid text-[12px] px-4 py-2 uppercase tracking-[0.06em]"
              style={{ gridTemplateColumns: "1.7fr 1.5fr 1fr 1fr 1fr", color: COLORS.inkSoft, borderBottom: `1px solid ${BORDER_STRONG}` }}
            >
              <div>Customer</div>
              <div>Session</div>
              <div>Status</div>
              <div>Date</div>
              <div className="text-right">Amount</div>
            </div>

            {filtered.map((b, i) => {
              const active = b.id === selectedBooking?.id;
              return (
                <button
                  key={b.id}
                  onClick={() => setSelectedId(b.id)}
                  className="grid items-center px-4 py-3 text-[15px] w-full text-left"
                  style={{
                    gridTemplateColumns: "1.7fr 1.5fr 1fr 1fr 1fr",
                    borderBottom: i < filtered.length - 1 ? `1px solid ${BORDER_STRONG}` : "none",
                    color: COLORS.ink,
                    background: active ? "rgba(36, 54, 41, 0.04)" : "transparent",
                    boxShadow: active ? "inset 0 0 0 1px rgba(36,54,41,0.08)" : "none",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{b.customer}</div>
                  <div style={{ color: COLORS.inkSoft }}>{b.session}</div>
                  <div><StatusBadge status={b.status} /></div>
                  <div style={{ color: COLORS.inkSoft }}>{b.date}</div>
                  <div className="text-right" style={{ fontWeight: 700 }}>£{b.amount.toLocaleString()}</div>
                </button>
              );
            })}
          </Card>

          {selectedBooking && (
            <Card className="h-fit" style={{ padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: COLORS.inkSoft }}>Selected booking</div>
                  <div style={{ fontSize: 30, fontWeight: 700, fontFamily: 'Fraunces, Georgia, serif', marginTop: 4 }}>{selectedBooking.id}</div>
                </div>
                <StatusBadge status={selectedBooking.status} />
              </div>

              <div style={{ display: 'grid', gap: 14, fontSize: 14, color: COLORS.inkSoft }}>
                <div>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Customer</div>
                  <div style={{ color: COLORS.ink, fontWeight: 700 }}>{selectedBooking.customer}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Contact</div>
                  <div style={{ color: COLORS.ink }}>{selectedBooking.contact}</div>
                  <div>{selectedBooking.email}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Session</div>
                  <div style={{ color: COLORS.ink }}>{selectedBooking.session}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Location</div>
                  <div style={{ color: COLORS.ink }}>{selectedBooking.location}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Notes</div>
                  <div style={{ color: COLORS.ink }}>{selectedBooking.notes}</div>
                </div>
              </div>

              <div style={{ borderTop: `1px solid ${BORDER_STRONG}`, marginTop: 18, paddingTop: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <span style={{ color: COLORS.inkSoft }}>Total</span>
                  <span style={{ fontSize: 22, fontWeight: 700, color: COLORS.ink, fontFamily: 'Fraunces, Georgia, serif' }}>£{selectedBooking.amount.toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button style={{ borderRadius: 10, background: COLORS.ink, color: COLORS.white, padding: '9px 12px', fontWeight: 700 }}>Send invoice</button>
                  <button style={{ borderRadius: 10, border: `1px solid ${BORDER_STRONG}`, background: COLORS.white, color: COLORS.ink, padding: '9px 12px', fontWeight: 700 }}>View school</button>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
