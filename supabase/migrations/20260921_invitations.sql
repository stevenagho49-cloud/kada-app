-- Migration: team invitations — invite staff, instructors, parents (and any
-- other role) by email and watch each one move through sent → accepted →
-- account created from Operations > Administration > Team & access.
-- Idempotent — safe to run repeatedly. Apply via Supabase Dashboard > SQL Editor.

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text,
  role text not null check (role in ('staff', 'instructor', 'parent', 'school', 'admin')),
  permissions text[] not null default '{}',
  job_title text,
  status text not null default 'sent' check (status in ('sent', 'accepted', 'account_created', 'bounced')),
  invited_by uuid references auth.users(id),
  user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  account_created_at timestamptz
);

alter table public.invitations enable row level security;

drop policy if exists "Admins can manage invitations" on public.invitations;
create policy "Admins can manage invitations" on public.invitations
  for all using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create index if not exists invitations_status_idx on public.invitations (status);

-- When a new auth user confirms their email, advance the matching invite.
create or replace function public.handle_invitation_progress()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.invitations
     set status = 'accepted', accepted_at = now()
   where lower(email) = lower(new.email) and status = 'sent';

  update public.invitations
     set status = 'account_created', account_created_at = now(), user_id = new.id
   where lower(email) = lower(new.email) and status = 'accepted';

  return new;
end;
$$;

drop trigger if exists on_auth_user_email_confirmed on auth.users;
create trigger on_auth_user_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute procedure public.handle_invitation_progress();

notify pgrst, 'reload schema';
