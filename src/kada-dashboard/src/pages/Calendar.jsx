import React, { useState } from "react";
import { COLORS, CLASS_TYPES, BORDER_STRONG, FONT_SERIF } from "../theme";
import {
  PageHeader, WeekNav, Card, IconButton, Menu, Checkbox, CollapsibleSection,
  Modal, FormField, TextInput, Select, PrimaryButton, SecondaryButton,
} from "../shared/ui";

const WEEK_DAYS = [
  { date: 14, label: "Mon" }, { date: 15, label: "Tue" }, { date: 16, label: "Wed" },
  { date: 17, label: "Thu" }, { date: 18, label: "Fri" }, { date: 19, label: "Sat" },
  { date: 20, label: "Sun" },
];
const HOURS = Array.from({ length: 6 }, (_, i) => 9 + i);
const STAFF_LIST = ["Chidubem", "Temilade", "Annedrea"];
const INITIAL_SESSIONS = [
  { id: 1, title: "Age 5-10 Gospel Afrobeats", type: "age-5-10", day: 19, startHour: 11, endHour: 12.5, staff: "Temilade" },
  { id: 2, title: "Age 11-16 Gospel Afrobeats", type: "age-11-16", day: 19, startHour: 11, endHour: 12.5, staff: "Chidubem" },
  { id: 3, title: "St Stephen's C of E Workshop", type: "workshop", day: 17, startHour: 10, endHour: 11.5, staff: "Annedrea" },
  { id: 4, title: "Age 5-10 Gospel Afrobeats", type: "age-5-10", day: 20, startHour: 12, endHour: 13, staff: "Temilade" },
];

function ClassTypeLegend({ selected, onToggle }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {Object.entries(CLASS_TYPES).map(([key, val]) => {
        const on = selected.has(key);
        return (
          <button
            key={key}
            onClick={() => onToggle(key)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[14px] border"
            style={{ borderColor: val.border, background: on ? val.bg : "transparent", color: on ? val.text : COLORS.inkSoft, opacity: on ? 1 : 0.55 }}
          >
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: val.border }} />
            {val.label}
          </button>
        );
      })}
    </div>
  );
}

export default function CalendarPage({ breadcrumb }) {
  const [sessions, setSessions] = useState(INITIAL_SESSIONS);
  const [selectedTypes, setSelectedTypes] = useState(new Set(Object.keys(CLASS_TYPES)));
  const [selectedStaff, setSelectedStaff] = useState(new Set(STAFF_LIST));
  const [view, setView] = useState("Weekly");
  const [showFilters, setShowFilters] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [activeSession, setActiveSession] = useState(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [form, setForm] = useState({ title: "", type: "age-5-10", day: 14, startHour: 9, endHour: 10, staff: STAFF_LIST[0] });

  const days = WEEK_DAYS.map((d) => ({ ...d, date: d.date + weekOffset * 7, baseDate: d.date }));
  const weekLabel = weekOffset === 0 ? "Sep 14 – Sep 20, 2026" : `Sep ${14 + weekOffset * 7} – Sep ${20 + weekOffset * 7}, 2026`;

  const toggleType = (key) => setSelectedTypes((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleStaff = (name) => setSelectedStaff((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });

  // sessions were authored against the base (offset 0) week, so they only
  // show up when you're actually viewing that week — same as a real calendar
  const visibleSessions = weekOffset === 0 ? sessions.filter((s) => selectedTypes.has(s.type) && selectedStaff.has(s.staff)) : [];

  const addSession = () => {
    if (!form.title.trim()) { alert("Give the session a title first."); return; }
    setSessions((prev) => [...prev, { id: Date.now(), ...form, day: Number(form.day), startHour: Number(form.startHour), endHour: Number(form.endHour) }]);
    setAddOpen(false);
    setForm({ title: "", type: "age-5-10", day: 14, startHour: 9, endHour: 10, staff: STAFF_LIST[0] });
  };

  const deleteActiveSession = () => {
    setSessions((prev) => prev.filter((s) => s.id !== activeSession.id));
    setActiveSession(null);
  };

  return (
    <div>
      <PageHeader breadcrumb={breadcrumb} title="Calendar" subtitle="Every class session across the week, colour-coded by class type." />

      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <WeekNav label={weekLabel} onToday={() => setWeekOffset(0)} onPrev={() => setWeekOffset((o) => o - 1)} onNext={() => setWeekOffset((o) => o + 1)} />
        <div className="flex items-center gap-2">
          <Menu label="View" selected={view} options={["Weekly", "Daily"]} onSelect={setView} />
          <IconButton label="Toggle filters" onClick={() => setShowFilters((v) => !v)}>▤</IconButton>
          <SecondaryButton onClick={() => alert("Session, staff, and location settings live in your real KADA admin.")}>⚙ Manage</SecondaryButton>
          <PrimaryButton onClick={() => setAddOpen(true)}>+ Add</PrimaryButton>
        </div>
      </div>

      <div className="mb-4">
        <ClassTypeLegend selected={selectedTypes} onToggle={toggleType} />
      </div>

      <div className="flex gap-5 items-start">

        <div className="flex-1 min-w-0">
          <Card noPadding className="overflow-hidden">
            <div className="grid" style={{ gridTemplateColumns: "56px repeat(7, 1fr)" }}>
              <div />
              {days.map((d) => (
                <div key={d.baseDate} className="text-center py-3 border-l" style={{ borderColor: BORDER_STRONG }}>
                  <div className="text-[13px]" style={{ color: COLORS.inkSoft }}>{d.label}</div>
                  <div className="text-[17px]" style={{ color: d.baseDate === 19 && weekOffset === 0 ? COLORS.coral : COLORS.ink, fontWeight: d.baseDate === 19 && weekOffset === 0 ? 600 : 500 }}>
                    {d.date}
                  </div>
                </div>
              ))}
            </div>

            <div className="relative" style={{ height: HOURS.length * 56 }}>
              <div className="grid absolute inset-0" style={{ gridTemplateColumns: "56px repeat(7, 1fr)" }}>
                <div>
                  {HOURS.map((h) => (
                    <div key={h} className="text-[13px] text-right pr-2 -mt-2" style={{ height: 56, color: COLORS.inkSoft }}>
                      {h > 12 ? h - 12 : h}{h >= 12 ? "pm" : "am"}
                    </div>
                  ))}
                </div>
                {days.map((d) => (
                  <div key={d.baseDate} className="border-l relative" style={{ borderColor: BORDER_STRONG }}>
                    {HOURS.map((h) => <div key={h} className="border-t" style={{ height: 56, borderColor: COLORS.line }} />)}
                    {visibleSessions.filter((s) => s.day === d.baseDate).map((s) => {
                      const type = CLASS_TYPES[s.type];
                      const top = (s.startHour - HOURS[0]) * 56;
                      const height = (s.endHour - s.startHour) * 56 - 4;
                      return (
                        <button
                          key={s.id}
                          onClick={() => setActiveSession(s)}
                          className="absolute left-1 right-1 rounded-md px-2 py-1 border text-left"
                          style={{ top, height, background: type.bg, borderColor: type.border, cursor: "pointer" }}
                        >
                          <p className="text-[13px] leading-tight" style={{ color: type.text, fontWeight: 500 }}>{s.title}</p>
                          <p className="text-[12px]" style={{ color: type.text, opacity: 0.8 }}>{s.staff}</p>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {showFilters && (
          <div className="w-60 shrink-0 hidden xl:block">
            <Card>
              <p className="text-[15px] mb-1" style={{ fontFamily: FONT_SERIF, fontWeight: 600, color: COLORS.ink }}>Filter by</p>
              <CollapsibleSection title="Catalog items">
                {Object.entries(CLASS_TYPES).map(([key, val]) => (
                  <Checkbox key={key} label={val.label} colorDot={val.border} checked={selectedTypes.has(key)} onChange={() => toggleType(key)} />
                ))}
              </CollapsibleSection>
              <CollapsibleSection title="Staff">
                {STAFF_LIST.map((name) => (
                  <Checkbox key={name} label={name} checked={selectedStaff.has(name)} onChange={() => toggleStaff(name)} />
                ))}
              </CollapsibleSection>
              <CollapsibleSection title="Location" defaultOpen={false}>
                <p className="text-[14px]" style={{ color: COLORS.inkSoft }}>All locations</p>
              </CollapsibleSection>
              <CollapsibleSection title="Session availability" defaultOpen={false}>
                <p className="text-[14px]" style={{ color: COLORS.inkSoft }}>Open and full sessions</p>
              </CollapsibleSection>
              <p className="text-[13px] mt-3" style={{ color: COLORS.inkFaint }}>{visibleSessions.length} events viewed</p>
            </Card>
          </div>
        )}
      </div>

      {addOpen && (
        <Modal
          title="Add session"
          onClose={() => setAddOpen(false)}
          footer={<>
            <SecondaryButton onClick={() => setAddOpen(false)}>Cancel</SecondaryButton>
            <PrimaryButton onClick={addSession}>Add session</PrimaryButton>
          </>}
        >
          <FormField label="Title">
            <TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Age 5-10 Gospel Afrobeats" />
          </FormField>
          <FormField label="Class type">
            <Select options={Object.entries(CLASS_TYPES).map(([, v]) => v.label)} value={CLASS_TYPES[form.type].label}
              onChange={(e) => { const key = Object.keys(CLASS_TYPES).find((k) => CLASS_TYPES[k].label === e.target.value); setForm({ ...form, type: key }); }} />
          </FormField>
          <FormField label="Staff">
            <Select options={STAFF_LIST} value={form.staff} onChange={(e) => setForm({ ...form, staff: e.target.value })} />
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

      {activeSession && (
        <Modal
          title={activeSession.title}
          onClose={() => setActiveSession(null)}
          footer={<>
            <SecondaryButton onClick={deleteActiveSession}>Delete</SecondaryButton>
            <PrimaryButton onClick={() => setActiveSession(null)}>Done</PrimaryButton>
          </>}
        >
          <p className="text-[15px] mb-1" style={{ color: COLORS.inkSoft }}>Staff: <span style={{ color: COLORS.ink }}>{activeSession.staff}</span></p>
          <p className="text-[15px] mb-1" style={{ color: COLORS.inkSoft }}>Class type: <span style={{ color: COLORS.ink }}>{CLASS_TYPES[activeSession.type].label}</span></p>
          <p className="text-[15px]" style={{ color: COLORS.inkSoft }}>Time: <span style={{ color: COLORS.ink }}>{activeSession.startHour}:00 – {activeSession.endHour}:00</span></p>
        </Modal>
      )}
    </div>
  );
}
