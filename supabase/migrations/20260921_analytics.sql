-- Migration: analytics.
-- 1. Campaign engagement: per-recipient open/click counts on campaign_sends
--    (tracked by a 1px open pixel and link-rewrite redirects in each email).
-- 2. Site analytics: anonymous page views (pageviews table) recorded by the
--    public site, aggregated on the admin dashboard.
-- Idempotent, safe to run repeatedly. Apply via Supabase Dashboard > SQL Editor.

-- Campaign engagement columns
alter table public.campaign_sends add column if not exists opens integer not null default 0;
alter table public.campaign_sends add column if not exists clicks integer not null default 0;
alter table public.campaign_sends add column if not exists first_opened_at timestamptz;
alter table public.campaign_sends add column if not exists last_clicked_at timestamptz;

-- Anonymous site page views (no personal data, path + referrer only)
create table if not exists public.page_views (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  referrer text,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.page_views enable row level security;

drop policy if exists "Anyone can record a page view" on public.page_views;
drop policy if exists "Admins can read page views" on public.page_views;

-- Inserts come from the public site via the server (service role); keep the
-- table admin-readable only, no direct public access.
create policy "Admins can read page views" on public.page_views
  for select using (public.current_user_role() = 'admin');

create index if not exists page_views_created_idx on public.page_views (created_at);
create index if not exists page_views_path_idx on public.page_views (path);
create index if not exists campaign_sends_opens_idx on public.campaign_sends (campaign_id, opens);

notify pgrst, 'reload schema';
