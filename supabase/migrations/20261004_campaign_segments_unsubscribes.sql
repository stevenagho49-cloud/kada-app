-- Migration: campaign audience segments, per-campaign exclusions, unsubscribes.
--  * campaigns.audiences: several audience segments at once (contact kinds,
--    contact tags, parent accounts, school records, instructors, ticket
--    buyers). The old single `audience` column is kept for older campaigns;
--    new ones store 'multi' there.
--  * campaigns.excluded_emails: people left out of that one campaign only.
--  * email_unsubscribes: everyone who used the unsubscribe link (or marked a
--    campaign as spam). No campaign is ever sent to them again.
--  * campaign_sends.status 'skipped': a queued email not sent because the
--    person unsubscribed before it went out.
-- Idempotent. Apply via Supabase Dashboard > SQL Editor.

-- Typed addresses ("Also send to"). From 20260921_campaign_custom_list.sql,
-- which was never applied on the live project.
alter table public.campaigns add column if not exists custom_emails text[] not null default '{}';
alter table public.campaigns add column if not exists audiences text[] not null default '{}';
alter table public.campaigns add column if not exists excluded_emails text[] not null default '{}';

alter table public.campaigns drop constraint if exists campaigns_audience_check;
alter table public.campaigns add constraint campaigns_audience_check
  check (audience in ('all', 'school', 'parent', 'client', 'partner', 'other', 'custom', 'multi'));

alter table public.campaign_sends drop constraint if exists campaign_sends_status_check;
alter table public.campaign_sends add constraint campaign_sends_status_check
  check (status in ('queued', 'sent', 'failed', 'skipped'));

create table if not exists public.email_unsubscribes (
  email text primary key check (email = lower(email)),
  unsubscribed_at timestamptz not null default now(),
  source text not null default 'link' check (source in ('link', 'one-click', 'spam-complaint', 'admin')),
  campaign_id uuid references public.campaigns(id) on delete set null
);

-- Server (service role) only; admins read it through the API.
alter table public.email_unsubscribes enable row level security;
drop policy if exists "Admins can read unsubscribes" on public.email_unsubscribes;
create policy "Admins can read unsubscribes" on public.email_unsubscribes
  for select using (public.current_user_role() = 'admin');

notify pgrst, 'reload schema';
