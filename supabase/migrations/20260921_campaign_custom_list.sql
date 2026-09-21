-- Migration: campaign one-off recipient lists.
-- Adds a custom_emails text[] column so a campaign can go to a hand-entered
-- list of addresses (single or many) instead of, or as well as, a CRM
-- audience. Also relaxes the audience check to allow the 'custom' list type.
-- Idempotent, safe to run repeatedly. Apply via Supabase Dashboard > SQL Editor.

alter table public.campaigns add column if not exists custom_emails text[] not null default '{}';

alter table public.campaigns drop constraint if exists campaigns_audience_check;
alter table public.campaigns add constraint campaigns_audience_check
  check (audience in ('all', 'school', 'parent', 'client', 'partner', 'other', 'custom'));

notify pgrst, 'reload schema';
