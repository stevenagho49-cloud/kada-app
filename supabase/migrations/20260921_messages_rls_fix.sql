-- Migration: fix messaging for every role.
-- The original "Participants can send messages" insert policy never ran on
-- production (it post-dates the applied schema), so instructors/schools got
-- "new row violates row-level security policy". This recreates all message
-- policies idempotently and adds a SECURITY DEFINER participant check that
-- avoids recursive profiles lookups inside the policy.
-- Idempotent — safe to run repeatedly. Apply via Supabase Dashboard > SQL Editor.

-- Helper: is the current user the instructor/school on one side of a message?
create or replace function public.current_user_is_message_participant(p_sender_kind text, p_sender_instructor text, p_sender_school text, p_recipient_kind text, p_recipient_instructor text, p_recipient_school text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (
        (p_sender_kind = 'instructor' and instructor_id = p_sender_instructor)
        or (p_recipient_kind = 'instructor' and instructor_id = p_recipient_instructor)
        or (p_sender_kind = 'school' and school_id = p_sender_school)
        or (p_recipient_kind = 'school' and school_id = p_recipient_school)
        or role in ('admin', 'staff')
      )
  )
$$;

drop policy if exists "Admins can manage messages" on public.messages;
drop policy if exists "Staff can manage messages" on public.messages;
drop policy if exists "Participants can read their messages" on public.messages;
drop policy if exists "Participants can send messages" on public.messages;
drop policy if exists "Recipients can mark messages read" on public.messages;

create policy "Admins can manage messages" on public.messages for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create policy "Staff can manage messages" on public.messages for all
  using (public.current_user_has_permission('messages'))
  with check (public.current_user_has_permission('messages'));

create policy "Participants can read their messages" on public.messages for select
  using (public.current_user_is_message_participant(sender_kind, sender_instructor_id, sender_school_id, recipient_kind, recipient_instructor_id, recipient_school_id));

create policy "Participants can send messages" on public.messages for insert
  with check (public.current_user_is_message_participant(sender_kind, sender_instructor_id, sender_school_id, recipient_kind, recipient_instructor_id, recipient_school_id));

create policy "Recipients can mark messages read" on public.messages for update
  using (public.current_user_is_message_participant(sender_kind, sender_instructor_id, sender_school_id, recipient_kind, recipient_instructor_id, recipient_school_id))
  with check (public.current_user_is_message_participant(sender_kind, sender_instructor_id, sender_school_id, recipient_kind, recipient_instructor_id, recipient_school_id));

notify pgrst, 'reload schema';
