-- Migration: homepage content blocks with reusable template styles.
--   * site_blocks: homepage content blocks staff create (a class, an event, a
--     service, or anything else), each rendered by one of four reusable
--     templates: 'split' (image + text side by side, mirror flips it),
--     'banner' (full width), 'cards' (2-3 item card grid), 'list' (simple list).
--     Each block also has a site_sections row (section_key 'block:<id>') so
--     Homepage layout orders and hides it like any built-in section.
--   * site_sections.template / mirror: the built-in About, School Workshops,
--     Saturday Classes and Events sections can use the same templates; null
--     keeps their original design.
-- Idempotent: safe to run repeatedly. Apply via Supabase Dashboard > SQL Editor.

alter table public.site_sections add column if not exists template text check (template in ('split', 'banner', 'cards', 'list'));
alter table public.site_sections add column if not exists mirror boolean not null default false;

create table if not exists public.site_blocks (
  id text primary key,
  kind text not null default 'other' check (kind in ('class', 'event', 'service', 'other')),
  template text not null default 'split' check (template in ('split', 'banner', 'cards', 'list')),
  mirror boolean not null default false,
  eyebrow text not null default '',
  title text not null,
  body text not null default '',
  image_url text not null default '',
  cta_label text not null default '',
  -- What the button does: open the class booking form, the school quote form,
  -- the linked event's page, a link, or no button.
  cta_action text not null default 'none' check (cta_action in ('none', 'book_class', 'school_quote', 'event', 'link')),
  cta_url text not null default '',
  -- Event blocks can show a published event's date, time, place, flyer and tickets.
  event_id text references public.events(id) on delete set null,
  -- Card grid / list entries: [{ "title", "body", "meta", "imageUrl" }].
  items jsonb not null default '[]'::jsonb,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.site_blocks enable row level security;
drop policy if exists "Anyone can read published site blocks" on public.site_blocks;
create policy "Anyone can read published site blocks" on public.site_blocks for select using (published or public.current_user_has_permission('site'));
drop policy if exists "Staff can manage site blocks" on public.site_blocks;
create policy "Staff can manage site blocks" on public.site_blocks for all
  using (public.current_user_has_permission('site'))
  with check (public.current_user_has_permission('site'));
