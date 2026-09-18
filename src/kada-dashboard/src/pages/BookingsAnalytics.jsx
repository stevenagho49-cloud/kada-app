import React from "react";
import { COLORS, FONT_SERIF } from "../theme";
import { PageHeader, Menu, StatTile, Card } from "../shared/ui";

const BREAKDOWN = [
  { label: "Checked in", pct: 0, color: COLORS.purple },
  { label: "No-show", pct: 0, color: COLORS.coral },
  { label: "Not specified", pct: 100, color: COLORS.line },
];

export default function BookingsAnalyticsPage({ breadcrumb }) {
  return (
    <div>
      <PageHeader
        breadcrumb={breadcrumb}
        title="Bookings analytics"
        subtitle="Performance across clients and staff, last 30 days."
        right={<Menu label="Last 30 days" options={["Last 7 days", "Last 30 days", "Last 90 days"]} onSelect={() => {}} />}
      />

      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[14px]" style={{ color: COLORS.inkSoft, fontWeight: 500 }}>Slots filled</p>
            <Menu label="All staff" options={["All staff", "Chidubem", "Temilade", "Annedrea"]} onSelect={() => {}} />
          </div>
          <p className="text-[24px] mb-4" style={{ fontFamily: FONT_SERIF, fontWeight: 600, color: COLORS.ink }}>0</p>
          <div className="flex h-2 rounded-full overflow-hidden mb-3" style={{ background: COLORS.line }}>
            {BREAKDOWN.map((b) => (
              <div key={b.label} style={{ width: `${b.pct}%`, background: b.color }} />
            ))}
          </div>
          <div className="flex gap-4 text-[14px]" style={{ color: COLORS.inkSoft }}>
            {BREAKDOWN.map((b) => (
              <span key={b.label}>
                <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: b.color }} />
                {b.label} {b.pct}%
              </span>
            ))}
          </div>
        </Card>

        <Card>
          <p className="text-[14px] mb-1" style={{ color: COLORS.inkSoft, fontWeight: 500 }}>Predicted occupancy — next 7 days</p>
          <p className="text-[24px] mb-4" style={{ fontFamily: FONT_SERIF, fontWeight: 600, color: COLORS.ink }}>0</p>
          <p className="text-[15px]" style={{ color: COLORS.inkSoft }}>
            No bookings for this period yet. Predicted occupancy shows once new sessions are scheduled.
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <p className="text-[15px] mb-3" style={{ fontFamily: FONT_SERIF, fontWeight: 600, color: COLORS.ink }}>
            Top class sessions
          </p>
          <p className="text-[15px]" style={{ color: COLORS.inkSoft }}>No sessions booked in this period yet.</p>
        </Card>
        <div className="flex gap-4">
          <StatTile label="Bookings" value={0} prefix="" />
          <StatTile label="Booking sales" value={0} />
        </div>
      </div>
    </div>
  );
}
