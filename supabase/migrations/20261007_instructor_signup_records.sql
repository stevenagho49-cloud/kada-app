-- Instructor sign-ups get an instructor record. Until now handle_new_user made
-- a school record for school sign-ups and a family for parents, but only a
-- bare profile for instructors: no row in public.instructors and no
-- profiles.instructor_id, so they never appeared on the Instructors page and
-- could not upload a DBS certificate.
-- 1. handle_new_user (same as 20260921_invite_roles_fix.sql otherwise) links an
--    instructor sign-up to the instructors row with the same email, or creates
--    one with DBS status 'Missing'. Job board access still needs an Approved
--    DBS, so a new record grants nothing until an admin approves it.
-- 2. When an admin adds or edits an instructor whose email matches an unlinked
--    instructor account, the account is linked to that record.
-- Earlier affected sign-ups are repaired separately, one by one.
-- Idempotent — safe to run repeatedly. Apply via Supabase Dashboard > SQL Editor.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  new_school_id text;
  new_instructor_id text;
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

  if requested_role = 'instructor' then
    select id into new_instructor_id from public.instructors
    where lower(email) = lower(new.email)
    order by created_at
    limit 1;
    if new_instructor_id is null then
      new_instructor_id := gen_random_uuid()::text;
      insert into public.instructors (id, name, email, dbs_status)
      values (new_instructor_id, coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)), new.email, 'Missing');
    end if;
  end if;

  insert into public.profiles (id, role, full_name, school_id, family_id, instructor_id)
  values (
    new.id,
    case
      when requested_role = 'instructor' then 'instructor'
      when requested_role = 'parent' then 'parent'
      when requested_role = 'staff' then 'staff'
      when requested_role = 'admin' then 'admin'
      else 'school'
    end,
    new.raw_user_meta_data->>'full_name',
    case when requested_role in ('parent', 'staff', 'admin', 'instructor') then null else new_school_id end,
    case when requested_role = 'parent' then new_school_id else null end,
    new_instructor_id
  );
  return new;
end;
$$;

create or replace function public.link_instructor_account()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.email is null or trim(new.email) = '' then return new; end if;
  update public.profiles p
  set instructor_id = new.id
  from auth.users u
  where u.id = p.id
    and p.role = 'instructor'
    and p.instructor_id is null
    and lower(u.email) = lower(trim(new.email));
  return new;
end;
$$;

drop trigger if exists instructors_link_account on public.instructors;
create trigger instructors_link_account
after insert or update of email on public.instructors
for each row execute function public.link_instructor_account();
