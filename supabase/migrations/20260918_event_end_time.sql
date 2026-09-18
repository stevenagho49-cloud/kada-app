-- Migration: add event end time.
-- Idempotent — safe to run repeatedly.
-- Apply via Supabase Dashboard > SQL Editor.

alter table public.events add column if not exists event_end_time time;

notify pgrst, 'reload schema';
