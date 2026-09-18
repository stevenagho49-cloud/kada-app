-- Migration: events table (homepage visibility) + subscription pause tracking.
-- Idempotent — safe to run repeatedly.
-- Apply via Supabase Dashboard > SQL Editor.

-- 1. Events managed from Operations > Events in the dashboard.
create table if not exists public.events (
  id text primary key,
  title text not null,
  description text,
  event_date date,
  location text,
  status text not null default 'draft' check (status in ('draft', 'published')),
  show_on_homepage boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.events enable row level security;

drop policy if exists "Admins can manage events" on public.events;
drop policy if exists "Public can read homepage events" on public.events;

create policy "Admins can manage events" on public.events for all using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
-- Anonymous and signed-in visitors can only see published events flagged for the homepage.
create policy "Public can read homepage events" on public.events for select using (status = 'published' and show_on_homepage = true);

-- 2. Track Stripe pause state on family subscriptions (membership_status enum has no 'paused').
alter table public.parent_families add column if not exists paused_at timestamptz;

notify pgrst, 'reload schema';
