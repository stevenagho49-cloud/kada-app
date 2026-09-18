import React, { useState } from "react";
import { COLORS, FONT_SERIF } from "./theme";

// Every item Wix's sidebar has. Items with a `key` route to a real page;
// items without one are structural (match the layout exactly) and just
// give feedback on click since we haven't built that section's page yet.
const NAV = [
  { label: "Home", icon: "🏠" },
  { label: "AI Agents", icon: "✨", badge: "NEW" },
  {
    label: "Booking calendar",
    icon: "🗓",
    children: [
      { key: "calendar", label: "Calendar" },
      { key: "booking-list", label: "Booking list" },
      { key: "work-schedule", label: "Work schedule" },
      { key: "bookings-analytics", label: "Bookings analytics" },
    ],
  },
  {
    label: "Events",
    icon: "🎟",
    children: [
      { key: "events-published", label: "Published" },
      { key: "events-drafts", label: "Drafts" },
      { key: "events-categories", label: "Categories" },
      { key: "events-staff", label: "Staff" },
    ],
  },
  {
    label: "Sales",
    icon: "💷",
    children: [
      { key: "orders", label: "Orders" },
      { key: "subscriptions", label: "Subscriptions" },
    ],
  },
  { label: "Catalog", icon: "📚" },
  { label: "Staff List", icon: "👥" },
  { label: "Blog", icon: "📝" },
  { label: "Apps", icon: "🧩", badge: "1" },
];

const NAV_LOWER = [
  { label: "Site & Mobile App", icon: "🖥" },
  { label: "Marketing", icon: "📣" },
  { label: "Getting Paid", icon: "💳" },
  { label: "Inbox", icon: "📥", badge: "17" },
  { label: "Customers & Leads", icon: "🧑‍🤝‍🧑" },
  { label: "Analytics", icon: "📈" },
];

function StubRow({ label, icon, badge }) {
  return (
    <button
      onClick={() => alert(`${label} isn't built yet in this preview — it's here to match the layout.`)}
      className="w-full text-left px-3 py-2 rounded-md text-[15px] flex items-center justify-between"
      style={{ color: "#C9C3D9" }}
    >
      <span><span className="mr-2">{icon}</span>{label}</span>
      {badge && (
        <span className="text-[12px] px-1.5 py-0.5 rounded-full" style={{ background: COLORS.gold, color: COLORS.ink, fontWeight: 700 }}>
          {badge}
        </span>
      )}
    </button>
  );
}

export default function Sidebar({ active, onSelect }) {
  const [openGroups, setOpenGroups] = useState(new Set(["Booking calendar", "Events", "Sales"]));

  const toggleGroup = (label) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  };

  return (
    <div className="flex flex-col w-64 shrink-0 h-full py-6 overflow-y-auto" style={{ background: COLORS.ink }}>
      <div className="px-5 pb-5">
        <p className="text-[17px] tracking-tight" style={{ fontFamily: FONT_SERIF, color: COLORS.gold, fontWeight: 600 }}>
          King's Ark
        </p>
        <p className="text-[13px] mt-0.5" style={{ color: COLORS.inkFaint }}>Dance Academy</p>
      </div>

      <nav className="flex flex-col gap-1 px-3">
        {NAV.map((item) =>
          item.children ? (
            <div key={item.label}>
              <button
                onClick={() => toggleGroup(item.label)}
                className="w-full text-left px-3 py-2 rounded-md text-[15px] flex items-center justify-between"
                style={{ color: COLORS.inkFaint, fontWeight: 500 }}
              >
                <span><span className="mr-2">{item.icon}</span>{item.label}</span>
                <span className="text-[12px]">{openGroups.has(item.label) ? "▾" : "▸"}</span>
              </button>
              {openGroups.has(item.label) && (
                <div className="flex flex-col gap-0.5 pl-4 mb-1">
                  {item.children.map((child) => {
                    const isActive = child.key === active;
                    return (
                      <button
                        key={child.key}
                        onClick={() => onSelect(child.key)}
                        className="text-left px-3 py-1.5 rounded-md text-[15px]"
                        style={{
                          background: isActive ? "rgba(242,169,59,0.14)" : "transparent",
                          color: isActive ? COLORS.gold : "#C9C3D9",
                          fontWeight: isActive ? 600 : 400,
                          borderLeft: isActive ? "2px solid #F2A93B" : "2px solid transparent",
                          paddingLeft: isActive ? 13 : 15,
                        }}
                      >
                        {child.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <StubRow key={item.label} {...item} />
          )
        )}
      </nav>

      <div className="mx-3 my-3" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }} />

      <nav className="flex flex-col gap-1 px-3">
        {NAV_LOWER.map((item) => <StubRow key={item.label} {...item} />)}
      </nav>

      <div className="mt-auto px-3 pt-4">
        <button
          onClick={() => alert("Edit Site isn't part of this dashboard preview.")}
          className="w-full text-left px-3 py-2 rounded-md text-[15px]"
          style={{ color: "#C9C3D9" }}
        >
          ✏️ Edit Site
        </button>
      </div>
    </div>
  );
}
