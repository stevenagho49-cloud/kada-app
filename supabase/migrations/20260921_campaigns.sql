-- Migration: email campaigns — design (50 built-in templates + AI-designed),
-- audience targeting, one-off or recurring scheduling, and send history.
-- Recipients are always individual rows in campaign_sends — one Resend call
-- per address (proper deliverability, never a giant To: list).
-- Idempotent — safe to run repeatedly. Apply via Supabase Dashboard > SQL Editor.

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null,
  preview_text text,
  body_html text not null,
  audience text not null default 'all' check (audience in ('all', 'school', 'parent', 'client', 'partner', 'other')),
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'active', 'paused', 'done')),
  -- null = send once at scheduled_at; otherwise daily/weekly/monthly.
  recurrence text not null default 'none' check (recurrence in ('none', 'daily', 'weekly', 'monthly')),
  scheduled_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaign_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  email text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.campaigns enable row level security;
alter table public.campaign_sends enable row level security;

drop policy if exists "Admins can manage campaigns" on public.campaigns;
create policy "Admins can manage campaigns" on public.campaigns
  for all using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

drop policy if exists "Admins can manage campaign sends" on public.campaign_sends;
create policy "Admins can manage campaign sends" on public.campaign_sends
  for all using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create index if not exists campaign_sends_campaign_idx on public.campaign_sends (campaign_id);

notify pgrst, 'reload schema';
