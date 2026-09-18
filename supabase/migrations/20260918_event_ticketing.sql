-- Migration: event ticketing (editable tiers per event + ticket order records).
-- Idempotent — safe to run repeatedly.
-- Apply via Supabase Dashboard > SQL Editor.

-- Prerequisite helper used by RLS policies (already exists on projects set up from
-- supabase-schema.sql; create-or-replace keeps this script self-contained).
create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

-- 1. Extend events with ticketing fields.
-- ticket_tiers is a jsonb array of { id, name, pricePence, bundleSize, description }.
-- bundleSize = how many tickets one purchase of this tier includes (e.g. 2 for a 2-for-1 deal).
alter table public.events add column if not exists ticketing_enabled boolean not null default false;
alter table public.events add column if not exists guest_artists text;
alter table public.events add column if not exists ticket_tiers jsonb not null default '[]'::jsonb;

-- 2. Public event pages: anyone (signed in or not) can read published events,
-- including their tiers. Drafts remain admin-only.
drop policy if exists "Public can read published events" on public.events;
create policy "Public can read published events" on public.events for select using (status = 'published');

-- 3. Ticket orders. Rows are written ONLY by the server (service role) from the
-- Stripe webhook; admins can read/manage them. No public access — buyer data stays private.
create table if not exists public.event_ticket_orders (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  buyer_name text not null,
  buyer_email text not null,
  tier_id text not null,
  tier_name text not null,
  tickets integer not null default 1,
  total_pence integer not null default 0,
  stripe_checkout_session_id text unique,
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'refunded')),
  created_at timestamptz not null default now()
);

alter table public.event_ticket_orders enable row level security;

drop policy if exists "Admins can manage ticket orders" on public.event_ticket_orders;
create policy "Admins can manage ticket orders" on public.event_ticket_orders for all using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');

notify pgrst, 'reload schema';
