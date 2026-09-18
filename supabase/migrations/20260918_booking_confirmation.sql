-- Migration: exactly-once confirmation emails for class bookings.
-- Mirrors the event_ticket_orders.confirmation_sent_at idempotency pattern:
-- the webhook atomically claims the booking before sending, so Stripe
-- redeliveries never email the parent twice. Idempotent — safe to run repeatedly.
-- Apply via Supabase Dashboard > SQL Editor.

alter table public.bookings add column if not exists confirmation_sent_at timestamptz;

notify pgrst, 'reload schema';
