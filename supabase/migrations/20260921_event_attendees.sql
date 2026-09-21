-- Migration: attendee names, day-of check-in, and event-attendee contact categories.
-- 1. event_ticket_orders gains attendee_names (one per ticket; 2-for-1 bundles
--    collect a name for each seat) and checked_in_at (set on the door).
-- 2. contacts gains 'event-attendee' kind so ticket buyers file into the CRM
--    under their own category (plus an event:<title> tag, e.g. event:It's Time
--    to Rise), sortable/filterable like any other type. The contacts source
--    check gains 'event-ticket' for these rows.
-- Idempotent, safe to run repeatedly. Apply via Supabase Dashboard > SQL Editor.

alter table public.event_ticket_orders add column if not exists attendee_names text[] not null default '{}';
alter table public.event_ticket_orders add column if not exists checked_in_at timestamptz;

alter table public.contacts drop constraint if exists contacts_kind_check;
alter table public.contacts add constraint contacts_kind_check
  check (kind in ('school', 'parent', 'client', 'partner', 'other', 'event-attendee'));

alter table public.contacts drop constraint if exists contacts_source_check;
alter table public.contacts add constraint contacts_source_check
  check (source in ('manual', 'import', 'email', 'website', 'event-ticket'));

notify pgrst, 'reload schema';
