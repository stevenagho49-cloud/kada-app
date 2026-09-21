-- Migration: invitation progress fixes.
-- 1. Advance invites when the account is INSERTED (not just email-confirmed):
--    Supabase invite-users are auto-confirmed on creation, so an insert-time
--    trigger marks them accepted immediately instead of lying about the stage.
-- 2. Broadcast invitation changes on the 'invitations-changes' realtime channel
--    so the admin dashboard updates live without a refresh.
-- Idempotent — safe to run repeatedly. Apply via Supabase Dashboard > SQL Editor.

-- Account created → 'accepted' (invited users are auto-confirmed).
create or replace function public.handle_invitation_signup()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.invitations
     set status = 'accepted', accepted_at = coalesce(accepted_at, now()), user_id = new.id
   where lower(email) = lower(new.email) and status in ('sent', 'accepted');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_invitation on auth.users;
create trigger on_auth_user_created_invitation
  after insert on auth.users
  for each row execute procedure public.handle_invitation_signup();

-- First real sign-in after acceptance → 'account_created' (profile syncs too).
create or replace function public.handle_invitation_progress()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  invite record;
begin
  if old.last_sign_in_at is null and new.last_sign_in_at is not null then
    update public.invitations
       set status = 'account_created', account_created_at = now()
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
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_confirmed on auth.users;
drop trigger if exists on_auth_user_sign_in on auth.users;
create trigger on_auth_user_sign_in
  after update of last_sign_in_at on auth.users
  for each row execute procedure public.handle_invitation_progress();

-- Realtime broadcast for the admin dashboard.
create or replace function public.broadcast_invitations_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform realtime.send('invitations-changes', tg_op, jsonb_build_object('id', coalesce(new.id, old.id)), true);
  return coalesce(new, old);
end;
$$;

drop trigger if exists invitations_realtime on public.invitations;
create trigger invitations_realtime
  after insert or update or delete on public.invitations
  for each row execute procedure public.broadcast_invitations_change();

notify pgrst, 'reload schema';
