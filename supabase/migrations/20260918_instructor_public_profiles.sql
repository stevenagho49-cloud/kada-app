-- Migration: instructor_public_profiles (school-facing instructor first-name visibility)
-- Extracted from supabase-schema.sql. Idempotent — safe to run repeatedly.
-- Apply via Supabase Dashboard > SQL Editor, or: psql "$DATABASE_URL" -f this_file.sql

-- Prerequisite helper used by RLS policies (already exists on projects set up from
-- supabase-schema.sql; create-or-replace keeps this script self-contained).
create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

-- 1. Privacy-safe public profile table (first name only)
create table if not exists public.instructor_public_profiles (
  id text primary key references public.instructors(id) on delete cascade,
  first_name text not null,
  updated_at timestamptz not null default now()
);

-- 2. Keep it in sync with public.instructors
create or replace function public.sync_instructor_public_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.instructor_public_profiles where id = old.id;
    return old;
  end if;
  insert into public.instructor_public_profiles (id, first_name, updated_at)
  values (new.id, coalesce(nullif(split_part(trim(new.name), ' ', 1), ''), 'Instructor'), now())
  on conflict (id) do update set first_name = excluded.first_name, updated_at = excluded.updated_at;
  return new;
end;
$$;

drop trigger if exists instructors_public_profile_sync on public.instructors;
create trigger instructors_public_profile_sync
after insert or update of name or delete on public.instructors
for each row execute function public.sync_instructor_public_profile();

-- Backfill existing instructors
insert into public.instructor_public_profiles (id, first_name)
select id, coalesce(nullif(split_part(trim(name), ' ', 1), ''), 'Instructor')
from public.instructors
on conflict (id) do update set first_name = excluded.first_name, updated_at = now();

-- 3. Row level security
alter table public.instructor_public_profiles enable row level security;

drop policy if exists "Admins can manage public instructor profiles" on public.instructor_public_profiles;
drop policy if exists "Schools can read assigned public instructor profiles" on public.instructor_public_profiles;
drop policy if exists "Instructors can read their public profile" on public.instructor_public_profiles;

create policy "Admins can manage public instructor profiles" on public.instructor_public_profiles for all using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "Schools can read assigned public instructor profiles" on public.instructor_public_profiles for select using (
  exists (
    select 1 from public.bookings
    where bookings.instructor_id = instructor_public_profiles.id
      and bookings.school_id = (select school_id from public.profiles where id = auth.uid())
  )
);
create policy "Instructors can read their public profile" on public.instructor_public_profiles for select using (id = (select instructor_id from public.profiles where id = auth.uid()));
