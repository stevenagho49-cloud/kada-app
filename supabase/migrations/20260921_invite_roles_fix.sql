-- Migration: invite role fixes.
-- 1. handle_new_user previously mapped any unrecognised metadata role to
--    'school' — inviting an admin created a school profile. Now maps admin.
-- 2. When an invited user's account is created, their profile is synced from
--    the invitation (role/permissions/job title) so the invite always wins.
-- Idempotent — safe to run repeatedly. Apply via Supabase Dashboard > SQL Editor.

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
      when requested_role = 'admin' then 'admin'
      else 'school'
    end,
    new.raw_user_meta_data->>'full_name',
    case when requested_role in ('parent', 'staff', 'admin') then null else new_school_id end,
    case when requested_role = 'parent' then new_school_id else null end
  );
  return new;
end;
$$;

-- Sync the profile from the invitation once the invitee confirms their email.
create or replace function public.handle_invitation_progress()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  invite record;
begin
  update public.invitations
     set status = 'accepted', accepted_at = now()
   where lower(email) = lower(new.email) and status = 'sent';

  update public.invitations
     set status = 'account_created', account_created_at = now(), user_id = new.id
   where lower(email) = lower(new.email) and status = 'accepted'
  returning * into invite;

  if invite.id is not null then
    update public.profiles
       set role = invite.role,
           permissions = coalesce(nullif(invite.permissions, '{}'), permissions),
           job_title = coalesce(nullif(invite.job_title, ''), job_title),
           full_name = coalesce(nullif(invite.full_name, ''), full_name)
     where id = new.id;
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
