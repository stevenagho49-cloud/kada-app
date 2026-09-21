-- Migration: per-seat door check-in, archived event status, and a delete guard.
-- 1. event_ticket_orders.checked_in_seats jsonb — maps 1-based seat number to the
--    check-in timestamp, e.g. {"1": "2026-09-21T18:02:11Z", "2": null}. A 4-ticket
--    family can check in 2 and leave 2; each seat keeps its own arrival time.
--    checked_in_at is kept for backward compatibility and now means "first seat
--    checked in at". set_event_seat_checkin() applies changes atomically so two
--    door staff on two phones cannot clobber each other's taps.
-- 2. events.status gains 'archived' — hidden everywhere but keeps sales history.
-- 3. event_ticket_orders FK switches from ON DELETE CASCADE to ON DELETE RESTRICT
--    so an event with orders can never be hard-deleted and wipe buyer records.
-- Idempotent, safe to run repeatedly. Apply via Supabase Dashboard > SQL Editor.

-- 1. Per-seat check-in.
alter table public.event_ticket_orders add column if not exists checked_in_seats jsonb not null default '{}'::jsonb;

-- Backfill: orders already checked in under the old whole-order flag get every
-- seat stamped with that arrival time so the door list stays consistent.
update public.event_ticket_orders
set checked_in_seats = (
  select coalesce(jsonb_object_agg(seat::text, to_jsonb(checked_in_at)), '{}'::jsonb)
  from generate_series(1, greatest(tickets, 1)) as seat
)
where checked_in_at is not null and checked_in_seats = '{}'::jsonb;

-- Atomic seat toggle. Returns the new seats map, or null when the order does not
-- exist / is not paid (the server turns that into a 4xx for the door device).
create or replace function public.set_event_seat_checkin(p_order_id text, p_seat integer, p_checked_in boolean)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  updated jsonb;
begin
  if p_seat is null or p_seat < 1 then return null; end if;
  update public.event_ticket_orders
  set checked_in_seats = case
        when p_checked_in then jsonb_set(checked_in_seats, array[p_seat::text], to_jsonb(now()), true)
        else checked_in_seats - p_seat::text
      end
  where id = p_order_id and payment_status = 'paid'
  returning checked_in_seats into updated;
  if not found then return null; end if;
  -- checked_in_at = first arrival (legacy whole-order column): keep it while any
  -- seat is checked in, clear it when the last seat checks back out.
  update public.event_ticket_orders
  set checked_in_at = case when updated = '{}'::jsonb then null else coalesce(checked_in_at, now()) end
  where id = p_order_id;
  return updated;
end;
$$;

-- 2. Archived events.
alter table public.events drop constraint if exists events_status_check;
alter table public.events add constraint events_status_check
  check (status in ('draft', 'published', 'archived'));

-- 3. Block hard-deleting an event that has ticket orders. Archive it instead.
alter table public.event_ticket_orders drop constraint if exists event_ticket_orders_event_id_fkey;
alter table public.event_ticket_orders
  add constraint event_ticket_orders_event_id_fkey
  foreign key (event_id) references public.events(id) on delete restrict;

notify pgrst, 'reload schema';
