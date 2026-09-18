import React, { useState } from "react";
import { COLORS, CLASS_TYPES, BORDER_STRONG } from "../theme";
import {
  PageHeader, WeekNav, Avatar, PrimaryButton, Card, Menu,
  Modal, FormField, Select, SecondaryButton,
} from "../shared/ui";

const WEEK_DAYS = [
  { date: 14, label: "Mon" }, { date: 15, label: "Tue" }, { date: 16, label: "Wed" },
  { date: 17, label: "Thu" }, { date: 18, label: "Fri" }, { date: 19, label: "Sat" },
  { date: 20, label: "Sun" },
];
const MOCK_STAFF = ["Chidubem", "Temilade", "Annedrea"];
const HOURS = Array.from({ length: 6 }, (_, i) => 9 + i);
const TYPE_KEYS = Object.keys(CLASS_TYPES);
const INITIAL_SESSIONS = [
  { id: 1, type: "age-5-10", day: 19, startHour: 11, endHour: 12.5, staff: "Temilade" },
  { id: 2, type: "age-11-16", day: 19, startHour: 11, endHour: 12.5, staff: "Chidubem" },
  { id: 3, type: "workshop", day: 17, startHour: 10, endHour: 11.5, staff: "Annedrea" },
  { id: 4, type: "age-5-10", day: 20, startHour: 12, endHour: 13, staff: "Temilade" },
];

export default function WorkSchedulePage({ breadcrumb }) {
  const [sessions, setSessions] = useState(INITIAL_SESSIONS);
  const [addOpen, setAddOpen] = useState(false);
  const [activePill, setActivePill] = useState(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [form, setForm] = useState({ staff: MOCK_STAFF[0], day: 14, startHour: 9, endHour: 10, type: "age-5-10" });

  const days = WEEK_DAYS.map((d) => ({ ...d, date: d.date + weekOffset * 7, baseDate: d.date }));
  const weekLabel = weekOffset === 0 ? "Sep 14 – Sep 20, 2026" : `Sep ${14 + weekOffset * 7} – Sep ${20 + weekOffset * 7}, 2026`;
  const visibleSessions = weekOffset === 0 ? sessions : [];

  const addHours = () => {
    setSessions((prev) => [...prev, { id: Date.now(), ...form, day: Number(form.day), startHour: Number(form.startHour), endHour: Number(form.endHour) }]);
    setAddOpen(false);
  };
  const removeActive = () => {
    setSessions((prev) => prev.filter((s) => s.id !== activePill.id));
    setActivePill(null);
  };

  return (
    <div>
      <PageHeader
        breadcrumb={breadcrumb}
        title="Work schedule"
        subtitle="Manage when and where staff members are available for the week."
        right={
          <div className="flex items-center flex-wrap gap-2">
            <Menu label="More actions" options={["Export schedule", "Print", "Copy last week"]} onSelect={(v) => alert(`${v} — not wired to real data yet.`)} />
            <PrimaryButton onClick={() => setAddOpen(true)}>+ Add staff hours</PrimaryButton>
          </div>
        }
      />

      <div className="flex items-center justify-between mb-4">
        <WeekNav label={weekLabel} onToday={() => setWeekOffset(0)} onPrev={() => setWeekOffset((o) => o - 1)} onNext={() => setWeekOffset((o) => o + 1)} />
        <button className="text-[14px]" style={{ color: COLORS.purpleDeep, fontWeight: 500 }} onClick={() => alert("Availability help lives in your real KADA admin docs.")}>
          ✦ Get help with availability
        </button>
      </div>

      <Card noPadding className="overflow-hidden">
        <div className="grid text-[13px] py-2" style={{ gridTemplateColumns: "170px repeat(7, 1fr)", borderBottom: `1px solid ${BORDER_STRONG}` }}>
          <div />
          {days.map((d) => (
            <div key={d.baseDate} className="text-center" style={{ color: COLORS.inkSoft }}>
              <div>{d.label}</div>
              <div style={{ color: COLORS.ink, fontWeight: 500, fontSize: 15 }}>{d.date}</div>
            </div>
          ))}
        </div>

        {MOCK_STAFF.map((name, i) => (
          <div
            key={name}
            className="grid items-center"
            style={{ gridTemplateColumns: "170px repeat(7, 1fr)", borderBottom: i < MOCK_STAFF.length - 1 ? `1px solid ${BORDER_STRONG}` : "none", minHeight: 56 }}
          >
            <div className="flex items-center gap-2 px-4 py-3">
              <Avatar name={name} />
              <span className="text-[15px]" style={{ color: COLORS.ink }}>{name}</span>
            </div>
            {days.map((d) => {
              const session = visibleSessions.find((s) => s.staff === name && s.day === d.baseDate);
              return (
                <div key={d.baseDate} className="flex justify-center px-1">
                  {session ? (
                    <button
                      onClick={() => setActivePill(session)}
                      className="text-[13px] px-2 py-1 rounded-md border w-full text-center"
                      style={{ background: CLASS_TYPES[session.type].bg, borderColor: CLASS_TYPES[session.type].border, color: CLASS_TYPES[session.type].text, cursor: "pointer" }}
                    >
                      {session.startHour}:00 – {session.endHour}:00
                    </button>
                  ) : (
                    <button
                      onClick={() => { setForm({ staff: name, day: d.baseDate, startHour: 9, endHour: 10, type: "age-5-10" }); setAddOpen(true); }}
                      className="w-full h-6 rounded-md text-[15px]"
                      style={{ color: "transparent" }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = BORDER_STRONG)}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "transparent")}
                    >
                      +
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </Card>

      {addOpen && (
        <Modal
          title="Add staff hours"
          onClose={() => setAddOpen(false)}
          footer={<>
            <SecondaryButton onClick={() => setAddOpen(false)}>Cancel</SecondaryButton>
            <PrimaryButton onClick={addHours}>Add hours</PrimaryButton>
          </>}
        >
          <FormField label="Staff member">
            <Select options={MOCK_STAFF} value={form.staff} onChange={(e) => setForm({ ...form, staff: e.target.value })} />
          </FormField>
          <FormField label="Class type">
            <Select options={TYPE_KEYS.map((k) => CLASS_TYPES[k].label)} value={CLASS_TYPES[form.type].label}
              onChange={(e) => { const key = TYPE_KEYS.find((k) => CLASS_TYPES[k].label === e.target.value); setForm({ ...form, type: key }); }} />
          </FormField>
          <div className="grid grid-cols-3 gap-2">
            <FormField label="Day">
              <Select options={WEEK_DAYS.map((d) => String(d.date))} value={String(form.day)} onChange={(e) => setForm({ ...form, day: e.target.value })} />
            </FormField>
            <FormField label="Start">
              <Select options={HOURS.map(String)} value={String(form.startHour)} onChange={(e) => setForm({ ...form, startHour: e.target.value })} />
            </FormField>
            <FormField label="End">
              <Select options={HOURS.map(String)} value={String(form.endHour)} onChange={(e) => setForm({ ...form, endHour: e.target.value })} />
            </FormField>
          </div>
        </Modal>
      )}

      {activePill && (
        <Modal
          title={`${activePill.staff} — ${activePill.startHour}:00-${activePill.endHour}:00`}
          onClose={() => setActivePill(null)}
          footer={<>
            <SecondaryButton onClick={removeActive}>Remove</SecondaryButton>
            <PrimaryButton onClick={() => setActivePill(null)}>Done</PrimaryButton>
          </>}
        >
          <p className="text-[15px]" style={{ color: COLORS.inkSoft }}>
            Class type: <span style={{ color: COLORS.ink }}>{CLASS_TYPES[activePill.type].label}</span>
          </p>
        </Modal>
      )}
    </div>
  );
}
