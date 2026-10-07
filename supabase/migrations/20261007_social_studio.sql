-- Social Studio, phase 1: media library, posts (draft / approved / scheduled /
-- published), class poster fields, and a private 'social-media' bucket that is
-- separate from every other photo bucket. Everything is gated by a new 'social'
-- staff permission (admins always pass current_user_has_permission).
-- All writes go through the server (service role), which checks consent and
-- content rules and alerts the admin when an uncleared photo is attempted. The
-- triggers below repeat the consent and approval rules so a direct write can't
-- get around them either.
-- Idempotent — safe to run repeatedly. Apply via Supabase Dashboard > SQL Editor.

-- 1. Class poster details. Every string on the weekly class poster comes from
-- the class record. price_lines is only for classes not sold through the
-- academy's Stripe class prices; when it is empty the poster shows the Stripe
-- Day Pass and Monthly Membership prices.
alter table public.class_sessions add column if not exists audience text not null default 'kids';
alter table public.class_sessions drop constraint if exists class_sessions_audience_check;
alter table public.class_sessions add constraint class_sessions_audience_check check (audience in ('kids', 'adults'));
alter table public.class_sessions add column if not exists category_label text;
alter table public.class_sessions add column if not exists tagline text;
alter table public.class_sessions add column if not exists instructor_first_name text;
alter table public.class_sessions add column if not exists city text;
alter table public.class_sessions add column if not exists venue_name text;
alter table public.class_sessions add column if not exists venue_postcode text;
alter table public.class_sessions add column if not exists levels_note text;
alter table public.class_sessions add column if not exists price_lines text[] not null default '{}';
alter table public.class_sessions add column if not exists booking_url text;
alter table public.class_sessions add column if not exists instagram_handle text;

-- 2. Media library.
create table if not exists public.social_media (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  kind text not null check (kind in ('image', 'video')),
  mime_type text not null,
  width integer,
  height integer,
  size_bytes bigint,
  title text not null default '',
  tags text[] not null default '{}',
  consent text not null default 'not_cleared' check (consent in ('cleared', 'adults_only', 'not_cleared')),
  shows_children boolean not null default true,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_media_tags_check check (tags <@ array['class', 'event', 'school', 'corporate']::text[]),
  -- "Adults only" means nobody under 18 is in the frame.
  constraint social_media_adults_only_check check (consent <> 'adults_only' or shows_children = false)
);

-- 3. Posts.
create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  content_type text not null,
  template text not null check (template in ('poster', 'quote', 'carousel', 'event_promo', 'linkedin_card', 'class_poster')),
  formats text[] not null default '{portrait}',
  platforms text[] not null default '{instagram,facebook}',
  status text not null default 'draft' check (status in ('draft', 'approved', 'scheduled', 'published')),
  source_kind text not null default 'none' check (source_kind in ('event', 'class', 'none')),
  source_id text,
  eyebrow text,
  headline text not null default '',
  subhead text,
  quote text,
  attribution text,
  cta text,
  points text[] not null default '{}',
  slides jsonb not null default '[]'::jsonb,
  caption text not null default '',
  hashtags text[] not null default '{}',
  media_id uuid references public.social_media(id) on delete set null,
  facts jsonb not null default '{}'::jsonb,
  drafted_by text not null default 'manual',
  names_confirmed boolean not null default false,
  scheduled_for timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_posts_slides_check check (jsonb_typeof(slides) = 'array' and jsonb_array_length(slides) <= 10),
  constraint social_posts_formats_check check (formats <@ array['portrait', 'square', 'landscape', 'a5']::text[] and cardinality(formats) >= 1),
  constraint social_posts_platforms_check check (platforms <@ array['instagram', 'facebook', 'linkedin']::text[])
);
create index if not exists social_posts_status_idx on public.social_posts (status);
create index if not exists social_posts_scheduled_idx on public.social_posts (scheduled_for);

-- 4. Guards. (a) Nothing reaches approved / scheduled / published without an
-- approval. (b) Editing the content of an approved post sends it back to
-- draft. (c) Every photo on a post must be cleared, and a LinkedIn or
-- corporate post can't use a photo that shows children.
create or replace function public.social_posts_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  media_ids uuid[];
  bad record;
  corporate boolean;
begin
  if tg_op = 'UPDATE' and old.approved_at is not null and new.approved_at is not distinct from old.approved_at and (
    new.headline, new.subhead, new.eyebrow, new.quote, new.attribution, new.cta, new.caption, new.points, new.slides, new.hashtags, new.media_id, new.template, new.formats, new.platforms, new.content_type, new.source_id
  ) is distinct from (
    old.headline, old.subhead, old.eyebrow, old.quote, old.attribution, old.cta, old.caption, old.points, old.slides, old.hashtags, old.media_id, old.template, old.formats, old.platforms, old.content_type, old.source_id
  ) then
    new.status := 'draft';
    new.approved_at := null;
    new.approved_by := null;
    new.scheduled_for := null;
  end if;

  if new.status in ('approved', 'scheduled', 'published') and (new.approved_at is null or new.approved_by is null) then
    raise exception 'A post must be approved before it can be %.', new.status using errcode = 'check_violation';
  end if;
  if new.status = 'scheduled' and new.scheduled_for is null then
    raise exception 'A scheduled post needs a date.' using errcode = 'check_violation';
  end if;
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;

  select array_agg(distinct id) into media_ids from (
    select new.media_id as id
    union all
    select nullif(slide->>'mediaId', '')::uuid from jsonb_array_elements(new.slides) slide
  ) ids where id is not null;

  if media_ids is not null then
    select m.title, m.consent into bad from public.social_media m where m.id = any(media_ids) and m.consent = 'not_cleared' limit 1;
    if found then
      raise exception 'Photo "%" is not cleared for use in posts.', bad.title using errcode = 'check_violation';
    end if;
    corporate := new.content_type = 'corporate_team' or new.template = 'linkedin_card' or 'linkedin' = any(new.platforms);
    if corporate then
      select m.title into bad from public.social_media m where m.id = any(media_ids) and m.shows_children limit 1;
      if found then
        raise exception 'Photo "%" shows children and cannot be used in a LinkedIn or corporate post.', bad.title using errcode = 'check_violation';
      end if;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists social_posts_guard on public.social_posts;
create trigger social_posts_guard before insert or update on public.social_posts
  for each row execute function public.social_posts_guard();

-- Withdrawing consent on a photo pulls every approved post that uses it back
-- to draft, so it can't be exported or published by hand.
create or replace function public.social_media_consent_withdrawn()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.consent = 'not_cleared' and old.consent <> 'not_cleared' then
    update public.social_posts p
      set status = 'draft', approved_at = null, approved_by = null, scheduled_for = null, media_id = case when p.media_id = new.id then null else p.media_id end,
          slides = (select coalesce(jsonb_agg(case when slide->>'mediaId' = new.id::text then slide - 'mediaId' else slide end), '[]'::jsonb) from jsonb_array_elements(p.slides) slide)
      where p.status <> 'published'
        and (p.media_id = new.id or exists (select 1 from jsonb_array_elements(p.slides) slide where slide->>'mediaId' = new.id::text));
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists social_media_consent_withdrawn on public.social_media;
create trigger social_media_consent_withdrawn before update on public.social_media
  for each row execute function public.social_media_consent_withdrawn();

-- 5. RLS: read access for the 'social' permission; writes are server-only.
alter table public.social_media enable row level security;
alter table public.social_posts enable row level security;
drop policy if exists "Social staff can read media" on public.social_media;
create policy "Social staff can read media" on public.social_media for select using (public.current_user_has_permission('social'));
drop policy if exists "Social staff can read posts" on public.social_posts;
create policy "Social staff can read posts" on public.social_posts for select using (public.current_user_has_permission('social'));

-- 6. Private bucket, separate from site-media, event-flyers, homework-images,
-- formation-photos and dbs-certificates. Photos are resized to JPEG in the
-- browser; short clips are stored as uploaded (50 MB cap).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social-media', 'social-media', false, 52428800, array['image/jpeg', 'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Social staff can read social media" on storage.objects;
drop policy if exists "Social staff can upload social media" on storage.objects;
drop policy if exists "Social staff can delete social media" on storage.objects;
create policy "Social staff can read social media" on storage.objects for select to authenticated
  using (bucket_id = 'social-media' and public.current_user_has_permission('social'));
create policy "Social staff can upload social media" on storage.objects for insert to authenticated
  with check (bucket_id = 'social-media' and public.current_user_has_permission('social'));
create policy "Social staff can delete social media" on storage.objects for delete to authenticated
  using (bucket_id = 'social-media' and public.current_user_has_permission('social'));

-- 7. Seed the existing Saturday class so its poster has a booking link and
-- handle straight away (other poster fields are filled in on Class schedule).
update public.class_sessions set
  booking_url = coalesce(booking_url, 'https://kingsarkdance.com/#classes'),
  instagram_handle = coalesce(instagram_handle, '@kingsarkdance'),
  city = coalesce(city, 'Birmingham')
where audience = 'kids';

notify pgrst, 'reload schema';
