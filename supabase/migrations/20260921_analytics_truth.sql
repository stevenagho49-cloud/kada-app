-- Migration: truthful campaign opens.
-- Open pixels are fetched by machines as well as people: Apple Mail Privacy
-- Protection and Gmail preload images at delivery, and security scanners
-- (Mimecast, Proofpoint, Barracuda, corporate Outlook) fetch images and links
-- automatically. Those machine fetches used to inflate the opens count.
-- machine_opens stores filtered machine fetches separately so the opens
-- column only counts likely human readers. last_open_user_agent keeps the
-- most recent fetch agent for debugging.
-- Idempotent, safe to run repeatedly. Apply via Supabase Dashboard > SQL Editor.

alter table public.campaign_sends add column if not exists machine_opens integer not null default 0;
alter table public.campaign_sends add column if not exists last_open_user_agent text;

notify pgrst, 'reload schema';
