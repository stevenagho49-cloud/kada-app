import React, { useState, useEffect } from "react";
import { COLORS, FONT_SANS, FONT_HREF } from "./theme";
import Sidebar from "./Sidebar";
import { TopBar, PromoBanner } from "./shared/ui";
import CalendarPage from "./pages/Calendar";
import WorkSchedulePage from "./pages/WorkSchedule";
import BookingListPage from "./pages/BookingList";
import BookingsAnalyticsPage from "./pages/BookingsAnalytics";
import OrdersPage from "./pages/Orders";
import SubscriptionsPage from "./pages/Subscriptions";
import EventsPage from "./pages/Events";

const PAGES = {
  calendar: { el: <CalendarPage />, crumb: ["Booking calendar", "Calendar"] },
  "work-schedule": { el: <WorkSchedulePage />, crumb: ["Booking calendar", "Work schedule"] },
  "booking-list": { el: <BookingListPage />, crumb: ["Booking calendar", "Booking list"] },
  "bookings-analytics": { el: <BookingsAnalyticsPage />, crumb: ["Booking calendar", "Bookings analytics"] },
  orders: { el: <OrdersPage />, crumb: ["Sales", "Orders"] },
  subscriptions: { el: <SubscriptionsPage />, crumb: ["Sales", "Subscriptions"] },
  "events-published": { el: <EventsPage view="published" />, crumb: ["Events", "Published"] },
  "events-drafts": { el: <EventsPage view="drafts" />, crumb: ["Events", "Drafts"] },
  "events-categories": { el: <EventsPage view="categories" />, crumb: ["Events", "Categories"] },
  "events-staff": { el: <EventsPage view="staff" />, crumb: ["Events", "Staff"] },
};

function useGoogleFonts(href) {
  useEffect(() => {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }, [href]);
}

export default function App() {
  const [active, setActive] = useState("booking-list");
  useGoogleFonts(FONT_HREF);
  const page = PAGES[active];

  return (
    <div className="flex flex-col w-full h-full min-h-[640px]" style={{ fontFamily: FONT_SANS, background: COLORS.cream }}>
      <PromoBanner />
      <div className="flex flex-1 min-h-0">
        <Sidebar active={active} onSelect={setActive} />
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar />
          <div className="flex-1 p-8 overflow-auto">
            {React.cloneElement(page.el, { breadcrumb: page.crumb })}
          </div>
        </div>
      </div>
    </div>
  );
}
