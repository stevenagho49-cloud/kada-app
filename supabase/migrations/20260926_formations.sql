-- Migration: Formation Planner (Operations > Formations).
-- Drag-and-drop stage layouts per class ("Verse 1", "Chorus", …) with a small
-- reference photo of each child so staff can tell who is who.
--
-- CHILD PHOTOS ARE STAFF-INTERNAL ONLY:
--   * stored in their own PRIVATE bucket 'formation-photos' (public = false),
--     separate from every public/marketing bucket (event-flyers, homework-images);
--   * readable and writable ONLY by admins and staff granted the 'formations'
--     permission; no anon, parent, school or instructor policy exists;
--   * shown in the app only through short-lived signed URLs, never public URLs;
--   * not connected to students.photo_consent (that consent covers website and
--     social media use and does not apply here).
-- Access to everything in this migration is the 'formations' staff permission.
-- Idempotent — safe to run repeatedly.
-- Apply via Supabase Dashboard > SQL Editor.

-- 1. Private bucket. Explicitly public = false, also on re-run.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('formation-photos', 'formation-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Formations staff can read formation photos" on storage.objects;
drop policy if exists "Formations staff can upload formation photos" on storage.objects;
drop policy if exists "Formations staff can update formation photos" on storage.objects;
drop policy if exists "Formations staff can delete formation photos" on storage.objects;
create policy "Formations staff can read formation photos" on storage.objects for select to authenticated
  using (bucket_id = 'formation-photos' and public.current_user_has_permission('formations'));
create policy "Formations staff can upload formation photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'formation-photos' and public.current_user_has_permission('formations'));
create policy "Formations staff can update formation photos" on storage.objects for update to authenticated
  using (bucket_id = 'formation-photos' and public.current_user_has_permission('formations'));
create policy "Formations staff can delete formation photos" on storage.objects for delete to authenticated
  using (bucket_id = 'formation-photos' and public.current_user_has_permission('formations'));

-- 2. One reference photo per child. Files live at '<student_id>/<random>.jpg'
-- so a future cleanup job can find expired rows (expires_at, unused for now)
-- and orphaned files (a folder whose student has no row) without a redesign.
create table if not exists public.formation_student_photos (
  student_id text primary key references public.students(id) on delete cascade,
  storage_path text not null unique,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  expires_at timestamptz
);

-- 3. Formations: named layouts per class.
create table if not exists public.formations (
  id uuid primary key default gen_random_uuid(),
  class_name text not null,
  name text not null check (length(trim(name)) between 1 and 60),
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_name, name)
);

-- 4. Where each child stands. x/y are fractions of the stage (0 = left/back,
-- 1 = right/front), so a layout looks the same on a phone and a laptop.
-- A child with no row is "off stage" (on the bench).
create table if not exists public.formation_positions (
  formation_id uuid not null references public.formations(id) on delete cascade,
  student_id text not null references public.students(id) on delete cascade,
  x numeric not null check (x between 0 and 1),
  y numeric not null check (y between 0 and 1),
  updated_at timestamptz not null default now(),
  primary key (formation_id, student_id)
);

alter table public.formation_student_photos enable row level security;
alter table public.formations enable row level security;
alter table public.formation_positions enable row level security;

-- Formations staff and admins only. No other policy exists on these tables.
drop policy if exists "Formations staff can manage formation photos" on public.formation_student_photos;
create policy "Formations staff can manage formation photos" on public.formation_student_photos for all
  using (public.current_user_has_permission('formations'))
  with check (public.current_user_has_permission('formations'));

drop policy if exists "Formations staff can manage formations" on public.formations;
create policy "Formations staff can manage formations" on public.formations for all
  using (public.current_user_has_permission('formations'))
  with check (public.current_user_has_permission('formations'));

drop policy if exists "Formations staff can manage positions" on public.formation_positions;
create policy "Formations staff can manage positions" on public.formation_positions for all
  using (public.current_user_has_permission('formations'))
  with check (public.current_user_has_permission('formations'));

-- 5. Children enrolled in a class (members, plus Day Passes in the last four
-- weeks or upcoming), and anyone already placed in one of its formations.
-- Names only: formations staff don't need, and don't get, the students table.
create or replace function public.formation_class_students(p_class text)
returns table (student_id text, student_name text)
language sql stable security definer set search_path = public
as $$
  select s.id, s.name
  from public.students s
  left join public.bookings b on b.id = s.booking_id
  where public.current_user_has_permission('formations')
    and s.class_name = p_class
    and s.membership_status = 'active'
    and coalesce(b.status, '') <> 'Cancelled'
    and (b.session_type like '%(monthly_membership)' or s.term >= (current_date - 28)::text)
  union
  select s.id, s.name
  from public.formation_positions p
  join public.formations f on f.id = p.formation_id
  join public.students s on s.id = p.student_id
  where public.current_user_has_permission('formations') and f.class_name = p_class
  order by 2
$$;

revoke all on function public.formation_class_students(text) from public, anon;
grant execute on function public.formation_class_students(text) to authenticated;

notify pgrst, 'reload schema';
