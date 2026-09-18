import React, { useState, useRef, useEffect } from "react";
import { COLORS, FONT_SERIF, SHADOW_CARD, SHADOW_POPOVER, BORDER_STRONG } from "../theme";

// ---------- surfaces ----------
export function Card({ children, className = "", noPadding = false }) {
  return (
    <div
      className={`rounded-xl border ${noPadding ? "" : "p-5"} ${className}`}
      style={{
        borderColor: BORDER_STRONG,
        background: COLORS.white,
        boxShadow: "0 1px 2px rgba(23,19,31,0.03)",
      }}
    >
      {children}
    </div>
  );
}

// ---------- header ----------
export function Breadcrumb({ items }) {
  return (
    <div className="flex items-center gap-1.5 text-[14px] mb-2" style={{ color: COLORS.inkSoft }}>
      {items.map((item, i) => (
        <React.Fragment key={item}>
          {i > 0 && <span style={{ color: COLORS.inkFaint }}>›</span>}
          <span style={{ color: i === items.length - 1 ? COLORS.ink : COLORS.inkSoft, fontWeight: i === items.length - 1 ? 500 : 400 }}>
            {item}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, right, breadcrumb }) {
  return (
    <div className="flex items-start justify-between mb-5 flex-wrap gap-4">
      <div className="min-w-0">
        {breadcrumb && <Breadcrumb items={breadcrumb} />}
        <h1
          className="text-[34px] leading-[1.1] break-words"
          style={{ fontFamily: FONT_SERIF, fontWeight: 600, color: COLORS.ink, letterSpacing: "-0.02em" }}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="text-[15px] mt-1" style={{ color: COLORS.inkSoft }}>
            {subtitle}
          </p>
        )}
      </div>
      {right && <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">{right}</div>}
    </div>
  );
}

// ---------- basic controls ----------
const buttonBase = {
  border: `1px solid ${BORDER_STRONG}`,
  background: COLORS.white,
  boxShadow: "0 1px 2px rgba(23,19,31,0.04)",
  cursor: "pointer",
};

export function IconButton({ children, label, ...props }) {
  return (
    <button
      aria-label={label}
      className="w-8 h-8 flex items-center justify-center rounded-lg text-[16px]"
      style={{ ...buttonBase, color: COLORS.inkSoft }}
      {...props}
    >
      {children}
    </button>
  );
}

export function WeekNav({ label, onToday, onPrev, onNext }) {
  return (
    <div className="flex items-center gap-2.5">
      <button className="text-[14px] px-3.5 py-2 rounded-lg font-medium" style={{ ...buttonBase, color: COLORS.ink }} onClick={onToday}>
        Today
      </button>
      <div className="flex items-center gap-1 text-[15px] px-1 py-2 rounded-lg" style={{ ...buttonBase, color: COLORS.inkSoft }}>
        <button aria-label="Previous" className="px-2 text-[17px]" style={{ color: COLORS.inkSoft }} onClick={onPrev}>‹</button>
        <span style={{ color: COLORS.ink, fontWeight: 500, minWidth: 150, textAlign: "center" }}>{label}</span>
        <button aria-label="Next" className="px-2 text-[17px]" style={{ color: COLORS.inkSoft }} onClick={onNext}>›</button>
      </div>
    </div>
  );
}

export function FilterChip({ children, onRemove }) {
  return (
    <span
      className="text-[14px] px-3 py-1.5 rounded-full inline-flex items-center gap-1.5 font-medium"
      style={{ border: `1px solid ${BORDER_STRONG}`, color: COLORS.inkSoft, background: COLORS.white }}
    >
      {children}
      <span style={{ color: COLORS.inkFaint, cursor: "pointer" }} onClick={onRemove}>✕</span>
    </span>
  );
}

export function PrimaryButton({ children, ...props }) {
  return (
    <button
      className="text-[14px] px-4 py-2 rounded-lg font-medium"
      style={{ background: COLORS.ink, color: COLORS.white, boxShadow: SHADOW_CARD, border: "1px solid transparent" }}
      {...props}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ children, ...props }) {
  return (
    <button
      className="text-[14px] px-4 py-2 rounded-lg font-medium"
      style={{ ...buttonBase, color: COLORS.ink }}
      {...props}
    >
      {children}
    </button>
  );
}

export function Checkbox({ checked, onChange, label, colorDot }) {
  return (
    <label className="flex items-center gap-2 text-[15px] py-1 cursor-pointer" style={{ color: COLORS.ink }}>
      <input type="checkbox" checked={checked} onChange={onChange} className="w-3.5 h-3.5" />
      {colorDot && <span className="inline-block w-2 h-2 rounded-full" style={{ background: colorDot }} />}
      {label}
    </label>
  );
}

// ---------- Menu: a real functioning click-to-open dropdown ----------
export function Menu({ label, options, onSelect, selected }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button
        className="flex items-center gap-2 text-[14px] px-3.5 py-2 rounded-lg font-medium"
        style={{ ...buttonBase, color: COLORS.ink }}
        onClick={() => setOpen((o) => !o)}
      >
        {selected || label} <span style={{ fontSize: 12, color: COLORS.inkSoft }}>▾</span>
      </button>
      {open && (
        <div
          className="absolute right-0 mt-1.5 rounded-lg overflow-hidden z-20"
          style={{ background: COLORS.white, border: `1px solid ${BORDER_STRONG}`, boxShadow: SHADOW_POPOVER, minWidth: 170 }}
        >
          {options.map((opt) => (
            <button
              key={opt}
              className="block w-full text-left px-3.5 py-2 text-[15px]"
              style={{ color: COLORS.ink, background: opt === selected ? COLORS.cream : "transparent" }}
              onClick={() => { onSelect(opt); setOpen(false); }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Modal ----------
export function Modal({ title, onClose, children, footer }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(23,19,31,0.45)" }}
      onClick={onClose}
    >
      <div
        className="rounded-xl w-full max-w-md"
        style={{ background: COLORS.white, boxShadow: SHADOW_POPOVER }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${BORDER_STRONG}` }}>
          <p style={{ fontFamily: FONT_SERIF, fontWeight: 600, fontSize: 18, color: COLORS.ink }}>{title}</p>
          <button onClick={onClose} style={{ color: COLORS.inkSoft, fontSize: 18 }} aria-label="Close">✕</button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 px-5 py-4" style={{ borderTop: `1px solid ${BORDER_STRONG}` }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function FormField({ label, children }) {
  return (
    <div className="mb-3">
      <label className="block text-[14px] mb-1.5" style={{ color: COLORS.inkSoft, fontWeight: 500 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  border: `1px solid ${BORDER_STRONG}`,
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 15,
  color: COLORS.ink,
  background: COLORS.cream,
};
export function TextInput(props) {
  return <input {...props} style={{ ...inputStyle, ...props.style }} />;
}
export function Select({ options, ...props }) {
  return (
    <select {...props} style={{ ...inputStyle, ...props.style }}>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// ---------- Tabs ----------
export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flex items-center gap-6 mb-4" style={{ borderBottom: `1px solid ${BORDER_STRONG}` }}>
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className="text-[15px] pb-2.5"
          style={{
            color: t === active ? COLORS.ink : COLORS.inkSoft,
            fontWeight: t === active ? 600 : 400,
            borderBottom: t === active ? `2px solid ${COLORS.ink}` : "2px solid transparent",
            marginBottom: -1,
            lineHeight: 1.2,
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

// ---------- collapsible filter section ----------
export function CollapsibleSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="py-3" style={{ borderBottom: `1px solid ${BORDER_STRONG}` }}>
      <button className="flex items-center justify-between w-full text-[15px]" style={{ color: COLORS.ink, fontWeight: 500 }} onClick={() => setOpen((o) => !o)}>
        {title}
        <span style={{ fontSize: 12, color: COLORS.inkSoft }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

// ---------- data display ----------
export function StatTile({ label, value, tone, prefix = "£" }) {
  const toneColor = tone === "paid" ? COLORS.green : tone === "unpaid" ? COLORS.coral : COLORS.ink;
  return (
    <Card className="flex-1 min-w-[180px]">
      <p className="text-[14px]" style={{ color: COLORS.inkSoft, fontWeight: 500 }}>{label}</p>
      <p className="text-[22px] mt-1" style={{ fontFamily: FONT_SERIF, fontWeight: 600, color: toneColor, letterSpacing: "-0.03em" }}>
        {prefix}{typeof value === "number" ? value.toLocaleString() : value}
      </p>
    </Card>
  );
}

export function StatusBadge({ status }) {
  const map = {
    Confirmed: { bg: COLORS.greenBg, text: COLORS.green },
    Paid: { bg: COLORS.greenBg, text: COLORS.green },
    Pending: { bg: COLORS.goldBg, text: COLORS.goldDeep },
    Paused: { bg: COLORS.goldBg, text: COLORS.goldDeep },
    Canceled: { bg: COLORS.redBg, text: COLORS.red },
    Failed: { bg: COLORS.redBg, text: COLORS.red },
    Fulfilled: { bg: COLORS.greenBg, text: COLORS.green },
    Draft: { bg: COLORS.purpleBg, text: COLORS.purpleDeep },
    Published: { bg: COLORS.greenBg, text: COLORS.green },
  };
  const tone = map[status] || { bg: COLORS.line, text: COLORS.inkSoft };
  return (
    <span className="text-[13px] px-2.5 py-1 rounded-full inline-block" style={{ background: tone.bg, color: tone.text, fontWeight: 600 }}>
      {status}
    </span>
  );
}

export function EmptyState({ title, body, action }) {
  return (
    <Card className="flex flex-col items-center text-center py-16">
      <div className="w-12 h-12 rounded-full flex items-center justify-center mb-4 text-[22px]" style={{ background: COLORS.purpleBg }}>🗂</div>
      <p className="text-[18px]" style={{ fontFamily: FONT_SERIF, fontWeight: 600, color: COLORS.ink }}>{title}</p>
      {body && <p className="text-[15px] mt-1.5 max-w-xs" style={{ color: COLORS.inkSoft }}>{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </Card>
  );
}

export function Avatar({ name }) {
  return (
    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] shrink-0" style={{ background: COLORS.purpleBg, color: COLORS.purpleDeep, fontWeight: 600 }}>
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

// ---------- promo banner (dismissible, matches Wix's top strip) ----------
export function PromoBanner() {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return (
    <div className="flex items-center justify-between flex-wrap gap-x-4 gap-y-1.5 px-6 py-2 shrink-0" style={{ background: COLORS.gold }}>
      <p className="text-[14px] min-w-0" style={{ color: COLORS.goldDeep, fontWeight: 600 }}>
        It's Time to Rise — 25 Oct, Birmingham. Only 17 of 160 tickets sold.
      </p>
      <div className="flex items-center gap-3 shrink-0">
        <button className="text-[14px] px-3 py-1.5 rounded-md whitespace-nowrap" style={{ background: COLORS.ink, color: COLORS.gold, fontWeight: 700 }}>
          Push tickets
        </button>
        <button aria-label="Dismiss" onClick={() => setVisible(false)} style={{ color: COLORS.goldDeep, fontWeight: 700 }}>✕</button>
      </div>
    </div>
  );
}

// ---------- top bar ----------
export function TopBar({ orgName = "KADA" }) {
  const [query, setQuery] = useState("");
  return (
    <div className="flex items-center justify-between gap-3 px-6 h-14 shrink-0 overflow-hidden" style={{ background: COLORS.white, borderBottom: `1px solid ${BORDER_STRONG}` }}>
      <div className="flex items-center gap-4 shrink-0">
        <span
          className="text-[14px] px-2.5 py-1 rounded-md font-medium whitespace-nowrap"
          style={{ background: COLORS.ink, color: COLORS.gold }}
        >
          {orgName}
        </span>
        <div className="hidden lg:flex items-center gap-4 text-[15px] whitespace-nowrap" style={{ color: COLORS.inkSoft }}>
          <span>Resources</span>
          <span>Community</span>
          <span>Help</span>
        </div>
      </div>
      <div
        className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg text-[15px] w-full max-w-[440px] min-w-0"
        style={{ background: COLORS.cream, color: COLORS.inkSoft, border: `1px solid ${BORDER_STRONG}` }}
      >
        <span aria-hidden="true">🔍</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search bookings, staff, schools…"
          className="bg-transparent outline-none w-full min-w-0 text-[15px]"
        />
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <IconButton label="Notifications">🔔</IconButton>
        <IconButton label="Messages">💬</IconButton>
        <span className="hidden sm:inline-block text-[13px] px-2.5 py-1 rounded-full font-medium whitespace-nowrap" style={{ background: COLORS.goldBg, color: COLORS.goldDeep }}>
          Free plan
        </span>
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[14px] shrink-0" style={{ background: COLORS.ink, color: COLORS.gold, fontWeight: 600 }}>
          SA
        </div>
      </div>
    </div>
  );
}
