# KADA dashboard components

# KADA dashboard components

Full replica of the Wix dashboard structure (top bar, promo banner, breadcrumbs,
secondary panels, filter panel, tabs) in KADA's own colours — and functional:
adding sessions/staff hours/orders/events, filtering, and clicking rows all
work against local state, ready to be wired to Supabase.

## Folder structure

```
src/
  theme.js               -> colours, fonts, shadows, class-type colour map
  Sidebar.jsx             -> full Wix nav structure (every section, not just built ones)
  shared/ui.jsx           -> Card, Modal, Menu, Tabs, Checkbox, TopBar, PromoBanner, etc.
  pages/
    Calendar.jsx           -> weekly grid + side panel + filter panel + add/edit modals
    WorkSchedule.jsx        -> staff x day grid + add staff hours modal
    BookingList.jsx         -> tabs + functional status filter + stat tiles
    BookingsAnalytics.jsx   -> occupancy + top sessions
    Orders.jsx               -> Stripe order list + add order modal
    Subscriptions.jsx         -> membership list + pause/resume/cancel
    Events.jsx                 -> Published/Drafts/Categories/Staff + add-item modal
  App.jsx                 -> wires Sidebar clicks to pages, promo banner, top bar
```

## How to drop this into kada-app

1. Replace the contents of your existing `src/kada-dashboard/` folder with
   everything in this zip's `src/`.
2. Tailwind (v4, via `@tailwindcss/vite`) needs to already be set up — if
   you followed the earlier setup steps this is done.
3. Every page reads from a mock array at the top of its file (`CAL_INITIAL_SESSIONS`,
   `BL_MOCK_BOOKINGS`, `OR_INITIAL_ORDERS`, etc). Replace each with a Supabase
   query — the shapes already match your schema fields.
4. `Sidebar.jsx` is the map of every route. Sections without a real page yet
   (Home, Catalog, Blog, etc.) show a plain alert on click — that's
   intentional, matching Wix's layout without needing every section built.
5. `main.jsx` should still point at this dashboard's `App` while you preview
   it — swap back to your real `App` once you're ready to add a proper nav
   link into it instead of it replacing your homepage.

## What's interactive right now

- Calendar: add a session via the "+ Add" modal, click any session to view/delete it,
  class-type and staff checkboxes filter the grid, Today/‹/› move the week.
- Work Schedule: click an empty cell to add hours, click a pill to view/remove it.
- Booking List: tabs switch content, Filter dropdown filters by status, chips are removable.
- Orders: add a new order, click a row for details.
- Subscriptions: click a row to Pause/Resume/Cancel.
- Events: add an event/category/staff member, items persist and are removable.

