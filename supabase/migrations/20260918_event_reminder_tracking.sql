-- Migration: track scheduled event reminder emails (sent 24h before the event by the server scheduler).
-- Idempotent — safe to run repeatedly.
-- Apply via Supabase Dashboard > SQL Editor.

alter table public.event_ticket_orders add column if not exists reminder_sent_at timestamptz;

create index if not exists event_ticket_orders_event_id_idx on public.event_ticket_orders (event_id);

notify pgrst, 'reload schema';
 