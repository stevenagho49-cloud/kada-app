import React, { useState } from "react";
import { COLORS, BORDER_STRONG } from "../theme";
import { PageHeader, PrimaryButton, EmptyState, Card, Modal, FormField, TextInput, SecondaryButton } from "../shared/ui";

const COPY = {
  published: { title: "Published", subtitle: "Live events guests can register for.", emptyTitle: "No published events", emptyBody: "Create an event and publish it to start taking registrations.", action: "+ Add event", fieldLabel: "Event name", placeholder: "It's Time to Rise" },
  drafts: { title: "Drafts", subtitle: "Events you're still setting up before they go live.", emptyTitle: "No event drafts yet", emptyBody: "Create a new event draft and publish it later.", action: "+ Add event", fieldLabel: "Event name", placeholder: "It's Time to Rise" },
  categories: { title: "Event categories", subtitle: "Display events on your site by category.", emptyTitle: "No categories yet", emptyBody: "Organise events with categories — e.g. Live shows, School workshops.", action: "+ New category", fieldLabel: "Category name", placeholder: "Live shows" },
  staff: { title: "Staff", subtitle: "Who can check guests in at the door.", emptyTitle: "No staff added yet", emptyBody: "Add staff so they can check guests in by QR code on event day.", action: "+ Add staff", fieldLabel: "Staff name", placeholder: "Annedrea" },
};

// Local state per view, keyed so switching tabs doesn't lose what you added
const initialStore = { published: [], drafts: [], categories: [], staff: [] };

export default function EventsPage({ view = "published", breadcrumb }) {
  const [store, setStore] = useState(initialStore);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const copy = COPY[view];
  const items = store[view];

  const addItem = () => {
    if (!name.trim()) { alert(`Give it a ${copy.fieldLabel.toLowerCase()} first.`); return; }
    setStore((prev) => ({ ...prev, [view]: [...prev[view], { id: Date.now(), name }] }));
    setAddOpen(false);
    setName("");
  };
  const removeItem = (id) => setStore((prev) => ({ ...prev, [view]: prev[view].filter((i) => i.id !== id) }));

  return (
    <div>
      <PageHeader breadcrumb={breadcrumb} title={copy.title} subtitle={copy.subtitle}
        right={<PrimaryButton onClick={() => setAddOpen(true)}>{copy.action}</PrimaryButton>} />

      {items.length === 0 ? (
        <EmptyState title={copy.emptyTitle} body={copy.emptyBody} />
      ) : (
        <Card noPadding className="overflow-hidden">
          {items.map((item, i) => (
            <div key={item.id} className="flex items-center justify-between px-4 py-3 text-[15px]"
              style={{ borderBottom: i < items.length - 1 ? `1px solid ${BORDER_STRONG}` : "none", color: COLORS.ink }}>
              <span>{item.name}</span>
              <button onClick={() => removeItem(item.id)} style={{ color: COLORS.inkFaint }}>✕</button>
            </div>
          ))}
        </Card>
      )}

      {addOpen && (
        <Modal title={copy.action.replace("+ ", "")} onClose={() => setAddOpen(false)}
          footer={<><SecondaryButton onClick={() => setAddOpen(false)}>Cancel</SecondaryButton><PrimaryButton onClick={addItem}>Save</PrimaryButton></>}>
          <FormField label={copy.fieldLabel}>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder={copy.placeholder} />
          </FormField>
        </Modal>
      )}
    </div>
  );
}
