-- Migration: contacts — the KADA CRM. One clean database for every school,
-- parent, client and partner, fed from four sources:
--   manual   — typed in from Operations > Contacts
--   import   — Excel/CSV imports from the old business (deduped by email)
--   website  — enquiries from the website contact form (server captures them)
--   email    — the inbound-email webhook (POST /api/inbound-email)
-- Idempotent — safe to run repeatedly.
-- Apply via Supabase Dashboard > SQL Editor.

-- Permission prerequisites (also created by 20260921_staff_permissions.sql) so
-- this migration works no matter which order the two are applied in.
alter table public.profiles add column if not exists permissions text[] not null default '{}';

create or replace function public.current_user_has_permission(area text)
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce(role = 'admin' or (role = 'staff' and area = any(permissions)), false)
  from public.profiles
  where id = auth.uid()
$$;

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'other' check (kind in ('school', 'parent', 'client', 'partner', 'other')),
  name text not null,
  organisation text,
  -- Stored lowercased; unique so imports and email captures dedupe instead of
  -- creating repeat records. Contacts without an email are allowed (NULLs
  -- don't collide in Postgres unique indexes).
  email text unique,
  phone text,
  address text,
  source text not null default 'manual' check (source in ('manual', 'import', 'email', 'website')),
  tags text[] not null default '{}',
  notes text,
  last_contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.contacts enable row level security;

drop policy if exists "Team can manage contacts" on public.contacts;
create policy "Team can manage contacts" on public.contacts for all
  using (public.current_user_has_permission('contacts'))
  with check (public.current_user_has_permission('contacts'));

create index if not exists contacts_kind_idx on public.contacts (kind);
create index if not exists contacts_organisation_idx on public.contacts (organisation);

notify pgrst, 'reload schema';
