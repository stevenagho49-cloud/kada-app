-- Migration: staff role + per-area permissions. Staff are team members who
-- sign in to Operations but only see the areas an admin grants them from
-- Operations > Administration > Team & access.
-- Idempotent — safe to run repeatedly.
-- Apply via Supabase Dashboard > SQL Editor.

-- 1. New 'staff' role plus a permissions list and job title on profiles.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'staff', 'school', 'instructor', 'parent'));
alter table public.profiles add column if not exists permissions text[] not null default '{}';
alter table public.profiles add column if not exists job_title text;

-- 2. Permission helper — admins pass every check; staff pass when the area is
-- in their permissions list. Used by RLS below and by the contacts CRM.
create or replace function public.current_user_has_permission(area text)
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce(role = 'admin' or (role = 'staff' and area = any(permissions)), false)
  from public.profiles
  where id = auth.uid()
$$;

-- 3. New-user trigger: staff get a plain profile — no school/family shell rows.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  new_school_id text;
  requested_role text := coalesce(new.raw_user_meta_data->>'role', 'school');
begin
  if requested_role = 'school' then
    new_school_id := gen_random_uuid()::text;
    insert into public.schools (id, name, contact_name, email)
    values (new_school_id, coalesce(new.raw_user_meta_data->>'school_name', 'New school'), new.raw_user_meta_data->>'full_name', new.email);
  end if;

  if requested_role = 'parent' then
    new_school_id := null;
    insert into public.parent_families (id, owner_user_id, guardian_name, guardian_email, membership_status)
    values (gen_random_uuid()::text, new.id, coalesce(new.raw_user_meta_data->>'full_name', 'Parent'), new.email, 'pending')
    returning id into new_school_id;
  end if;

  insert into public.profiles (id, role, full_name, school_id, family_id)
  values (
    new.id,
    case
      when requested_role = 'instructor' then 'instructor'
      when requested_role = 'parent' then 'parent'
      when requested_role = 'staff' then 'staff'
      else 'school'
    end,
    new.raw_user_meta_data->>'full_name',
    case when requested_role in ('parent', 'staff') then null else new_school_id end,
    case when requested_role = 'parent' then new_school_id else null end
  );
  return new;
end;
$$;

-- 4. Staff RLS policies, one per permission area. Policies are additive, so
-- these extend — never replace — the existing admin/school/instructor rules.
-- Permission key map:
--   bookings → bookings, calendar support tables (schools/instructors/jobs/template read)
--   students → students, class schedule, family read
--   sales    → families (subscriptions), invoice settings
--   events   → events + ticket orders
--   site     → site content + homepage sections
--   messages → messages
--   contacts → contacts (defined in 20260921_crm_contacts.sql)

drop policy if exists "Staff can manage bookings" on public.bookings;
create policy "Staff can manage bookings" on public.bookings for all
  using (public.current_user_has_permission('bookings'))
  with check (public.current_user_has_permission('bookings'));

drop policy if exists "Staff can read schools" on public.schools;
create policy "Staff can read schools" on public.schools for select
  using (public.current_user_has_permission('bookings') or public.current_user_has_permission('messages'));

drop policy if exists "Staff can read instructors" on public.instructors;
create policy "Staff can read instructors" on public.instructors for select
  using (public.current_user_has_permission('bookings'));

drop policy if exists "Staff can read job board" on public.job_board_jobs;
create policy "Staff can read job board" on public.job_board_jobs for select
  using (public.current_user_has_permission('bookings'));

drop policy if exists "Staff can read workshop template" on public.workshop_template;
create policy "Staff can read workshop template" on public.workshop_template for select
  using (public.current_user_has_permission('bookings'));

drop policy if exists "Staff can manage students" on public.students;
create policy "Staff can manage students" on public.students for all
  using (public.current_user_has_permission('students'))
  with check (public.current_user_has_permission('students'));

drop policy if exists "Staff can manage class sessions" on public.class_sessions;
create policy "Staff can manage class sessions" on public.class_sessions for all
  using (public.current_user_has_permission('students'))
  with check (public.current_user_has_permission('students'));

drop policy if exists "Staff can read families" on public.parent_families;
create policy "Staff can read families" on public.parent_families for select
  using (public.current_user_has_permission('students') or public.current_user_has_permission('sales'));

drop policy if exists "Staff can manage families" on public.parent_families;
create policy "Staff can manage families" on public.parent_families for update
  using (public.current_user_has_permission('sales'))
  with check (public.current_user_has_permission('sales'));

drop policy if exists "Staff can manage invoice settings" on public.invoice_settings;
create policy "Staff can manage invoice settings" on public.invoice_settings for all
  using (public.current_user_has_permission('sales'))
  with check (public.current_user_has_permission('sales'));

drop policy if exists "Staff can manage events" on public.events;
create policy "Staff can manage events" on public.events for all
  using (public.current_user_has_permission('events'))
  with check (public.current_user_has_permission('events'));

drop policy if exists "Staff can manage ticket orders" on public.event_ticket_orders;
create policy "Staff can manage ticket orders" on public.event_ticket_orders for all
  using (public.current_user_has_permission('events'))
  with check (public.current_user_has_permission('events'));

drop policy if exists "Staff can manage site content" on public.site_content;
create policy "Staff can manage site content" on public.site_content for all
  using (public.current_user_has_permission('site'))
  with check (public.current_user_has_permission('site'));

drop policy if exists "Staff can manage site sections" on public.site_sections;
create policy "Staff can manage site sections" on public.site_sections for all
  using (public.current_user_has_permission('site'))
  with check (public.current_user_has_permission('site'));

drop policy if exists "Staff can manage messages" on public.messages;
create policy "Staff can manage messages" on public.messages for all
  using (public.current_user_has_permission('messages'))
  with check (public.current_user_has_permission('messages'));

notify pgrst, 'reload schema';
