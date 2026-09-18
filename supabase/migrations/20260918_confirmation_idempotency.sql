-- Migration: track ticket confirmation emails (send exactly once per order).
-- Stripe redelivers webhook events; without this the buyer gets duplicate emails.
-- Idempotent — safe to run repeatedly.
-- Apply via Supabase Dashboard > SQL Editor.

alter table public.event_ticket_orders add column if not exists confirmation_sent_at timestamptz;

notify pgrst, 'reload schema';
