-- Migration: Resend delivery tracking, job board / workshop template staff
-- permissions, and staff-to-instructor messaging.
-- Idempotent — safe to run repeatedly.
-- Apply via Supabase Dashboard > SQL Editor.

-- 1. Campaign delivery tracking from Resend's own events (webhook + API sync).
-- 'sent' only ever meant "Resend accepted the API call"; these columns record
-- what actually happened to each email afterwards.
alter table public.campaign_sends add column if not exists resend_id text;
alter table public.campaign_sends add column if not exists last_event text;
alter table public.campaign_sends add column if not exists delivered_at timestamptz;
alter table public.campaign_sends add column if not exists delivery_delayed_at timestamptz;
alter table public.campaign_sends add column if not exists bounced_at timestamptz;
alter table public.campaign_sends add column if not exists bounce_type text;
alter table public.campaign_sends add column if not exists bounce_message text;
alter table public.campaign_sends add column if not exists complained_at timestamptz;
alter table public.campaign_sends add column if not exists resend_opened_at timestamptz;
alter table public.campaign_sends add column if not exists resend_clicked_at timestamptz;
alter table public.campaign_sends add column if not exists events_synced_at timestamptz;
create unique index if not exists campaign_sends_resend_id_idx on public.campaign_sends (resend_id) where resend_id is not null;
create index if not exists campaign_sends_status_idx on public.campaign_sends (status);

-- Every Resend webhook delivery, keyed by its svix id so a redelivery is a no-op.
create table if not exists public.resend_events (
  svix_id text primary key,
  type text not null,
  email_id text,
  occurred_at timestamptz,
  payload jsonb not null default '{}',
  received_at timestamptz not null default now()
);
create index if not exists resend_events_email_idx on public.resend_events (email_id);
alter table public.resend_events enable row level security;
drop policy if exists "Admins can read resend events" on public.resend_events;
create policy "Admins can read resend events" on public.resend_events for select
  using (public.current_user_role() = 'admin');

-- 2. Messaging. Staff with the 'messages' permission act as KADA admin, so they
-- need instructor names to start and label conversations. Instructors and
-- schools may only ever write to KADA admin, as themselves: the old participant
-- check let an instructor insert a message addressed to another instructor.
drop policy if exists "Staff can read instructors" on public.instructors;
create policy "Staff can read instructors" on public.instructors for select
  using (
    public.current_user_has_permission('bookings')
    or public.current_user_has_permission('messages')
    or public.current_user_has_permission('jobs')
  );

create or replace function public.current_user_can_send_message(p_sender_kind text, p_sender_instructor text, p_sender_school text, p_recipient_kind text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and p_recipient_kind = 'admin'
      and (
        (role = 'instructor' and p_sender_kind = 'instructor' and instructor_id = p_sender_instructor)
        or (role = 'school' and p_sender_kind = 'school' and school_id = p_sender_school)
      )
  )
$$;

drop policy if exists "Participants can send messages" on public.messages;
create policy "Participants can send messages" on public.messages for insert
  with check (public.current_user_can_send_message(sender_kind, sender_instructor_id, sender_school_id, recipient_kind));

-- 3. Job board ('jobs') and workshop template ('template') staff permissions.
-- Writes go through the server (/api/jobs/*), which checks the permission; these
-- policies let permitted staff read what the pages show.
drop policy if exists "Staff can read job board" on public.job_board_jobs;
create policy "Staff can read job board" on public.job_board_jobs for select
  using (public.current_user_has_permission('bookings') or public.current_user_has_permission('jobs'));

drop policy if exists "Staff can read workshop template" on public.workshop_template;
create policy "Staff can read workshop template" on public.workshop_template for select
  using (
    public.current_user_has_permission('bookings')
    or public.current_user_has_permission('jobs')
    or public.current_user_has_permission('template')
  );

drop policy if exists "Staff can manage workshop template" on public.workshop_template;
create policy "Staff can manage workshop template" on public.workshop_template for all
  using (public.current_user_has_permission('template'))
  with check (public.current_user_has_permission('template'));

notify pgrst, 'reload schema';
