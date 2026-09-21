-- Migration: admin app settings + parent user settings.
--   app_settings — internal, admin-only key/value store edited from
--     Operations > Administration > Settings (notification routing etc.).
--   site_content seeds — public-facing settings the website reads: social
--     links (footer) and branding (logo override in the site header).
--   parent_families / students columns — fields parents edit themselves from
--     Parent portal > Settings (contact details, emergency contact, comms
--     preferences, per-child dietary/medical/photo consent).
-- Idempotent — safe to run repeatedly.
-- Apply via Supabase Dashboard > SQL Editor.

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "Admins can manage app settings" on public.app_settings;
create policy "Admins can manage app settings" on public.app_settings
  for all using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

insert into public.app_settings (key, value) values
  ('notifications', '{"notifyEmail": "", "newBooking": true, "newContact": true, "jobAlerts": true}')
on conflict (key) do nothing;

-- Public settings live in site_content (already world-readable).
insert into public.site_content (key, value) values
  ('social', '{"instagram": "https://www.instagram.com/kingsarkdance", "tiktok": "", "youtube": "", "facebook": ""}'),
  ('branding', '{"logoUrl": ""}')
on conflict (key) do nothing;

-- Parent-editable family fields.
alter table public.parent_families add column if not exists guardian_phone text;
alter table public.parent_families add column if not exists address text;
alter table public.parent_families add column if not exists emergency_contact_name text;
alter table public.parent_families add column if not exists emergency_contact_phone text;
alter table public.parent_families add column if not exists comms jsonb not null default '{}';

-- Parent-editable per-child welfare fields.
alter table public.students add column if not exists dietary_requirements text;
alter table public.students add column if not exists medical_notes text;
alter table public.students add column if not exists photo_consent boolean;

notify pgrst, 'reload schema';
