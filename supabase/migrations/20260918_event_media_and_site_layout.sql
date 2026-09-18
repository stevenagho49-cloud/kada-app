-- Migration: event flyer/time/maps fields + admin-controlled homepage section layout.
-- Idempotent — safe to run repeatedly.
-- Apply via Supabase Dashboard > SQL Editor.

-- Prerequisite helper used by RLS policies (already exists on projects set up from
-- supabase-schema.sql; create-or-replace keeps this script self-contained).
create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

-- 1. Event flyer image, start time, and venue map link.
-- flyer_path is the object path inside the public event-flyers bucket.
alter table public.events add column if not exists flyer_path text;
alter table public.events add column if not exists event_time time;
alter table public.events add column if not exists map_url text;

-- Public bucket for event flyers — anyone can read (they appear on public pages),
-- only admins can upload/replace/delete.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-flyers', 'event-flyers', true, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 10485760, allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

drop policy if exists "Admins can upload event flyers" on storage.objects;
drop policy if exists "Admins can update event flyers" on storage.objects;
drop policy if exists "Admins can delete event flyers" on storage.objects;
drop policy if exists "Anyone can read event flyers" on storage.objects;
create policy "Admins can upload event flyers" on storage.objects for insert to authenticated with check (bucket_id = 'event-flyers' and public.current_user_role() = 'admin');
create policy "Admins can update event flyers" on storage.objects for update to authenticated using (bucket_id = 'event-flyers' and public.current_user_role() = 'admin');
create policy "Admins can delete event flyers" on storage.objects for delete to authenticated using (bucket_id = 'event-flyers' and public.current_user_role() = 'admin');
create policy "Anyone can read event flyers" on storage.objects for select using (bucket_id = 'event-flyers');

-- 2. Homepage layout: which sections render, and in which order.
create table if not exists public.site_sections (
  section_key text primary key,
  label text not null,
  visible boolean not null default true,
  sort_order integer not null default 0
);

alter table public.site_sections enable row level security;

drop policy if exists "Anyone can read site sections" on public.site_sections;
drop policy if exists "Admins can manage site sections" on public.site_sections;
create policy "Anyone can read site sections" on public.site_sections for select using (true);
create policy "Admins can manage site sections" on public.site_sections for all using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');

-- Seed the current homepage sections (order matches the current hardcoded layout).
insert into public.site_sections (section_key, label, visible, sort_order) values
  ('hero', 'Hero', true, 10),
  ('stats', 'Stats strip', true, 20),
  ('about', 'About', true, 30),
  ('values', 'Values', true, 40),
  ('workshops', 'School Workshops', true, 50),
  ('classes', 'Saturday Classes', true, 60),
  ('events', 'Events', true, 70),
  ('team', 'Team', true, 80),
  ('videos', 'Stories / Videos', true, 90),
  ('sponsors', 'Sponsors', true, 100),
  ('contact', 'Contact', true, 110)
on conflict (section_key) do nothing;

notify pgrst, 'reload schema';
