-- Migration: class attendance register (Operations > Attendance).
-- One row per child per class session: present or absent. No row means
-- "not marked yet" — nobody is defaulted either way.
-- Access is the 'attendance' staff permission area (admins always pass),
-- granted from Administration > Team & access like any other area.
-- Parents have no access; a parent-facing view of their own child's
-- attendance can be added later as a separate, narrower policy.
-- Idempotent — safe to run repeatedly.
-- Apply via Supabase Dashboard > SQL Editor.

-- 1. Attendance marks.
-- class_name matches class_sessions.name / students.class_name (the same key
-- bookings and the class booking form already use). student_name is
-- snapshotted so history and statistics read correctly even for staff who
-- cannot read the students table, and after a child's record is renamed.
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  student_id text not null references public.students(id) on delete cascade,
  student_name text not null,
  class_name text not null,
  session_date date not null,
  status text not null check (status in ('present', 'absent')),
  marked_by uuid references auth.users(id) on delete set null,
  marked_at timestamptz not null default now(),
  unique (student_id, class_name, session_date)
);

create index if not exists attendance_session_idx on public.attendance (class_name, session_date);
create index if not exists attendance_student_idx on public.attendance (student_id, session_date);

alter table public.attendance enable row level security;

drop policy if exists "Attendance staff can manage attendance" on public.attendance;
create policy "Attendance staff can manage attendance" on public.attendance for all
  using (public.current_user_has_permission('attendance'))
  with check (public.current_user_has_permission('attendance'));

-- 2. Who is registered for a session. Security definer so a session leader
-- with only the attendance permission gets names for the register without
-- being able to read the students table (dates of birth, medical notes).
-- Registered = active students of that class who either
--   * booked a Day Pass for exactly that date (term = the class date), or
--   * hold a Monthly Membership that started on or before that date,
-- excluding cancelled bookings. Anyone already marked for the session is
-- always included, so history never loses a child whose membership lapsed.
create or replace function public.attendance_roster(p_class text, p_date date)
returns table (
  student_id text,
  student_name text,
  plan text,
  registered boolean,
  status text,
  marked_at timestamptz,
  marked_by_name text
)
language sql stable security definer set search_path = public
as $$
  with registered as (
    select s.id, s.name,
      case when b.session_type like '%(monthly_membership)' then 'membership' else 'day_pass' end as plan
    from public.students s
    left join public.bookings b on b.id = s.booking_id
    where s.class_name = p_class
      and s.membership_status = 'active'
      and coalesce(b.status, '') <> 'Cancelled'
      and (
        s.term = p_date::text
        or (b.session_type like '%(monthly_membership)' and s.term <= p_date::text)
      )
  ),
  marked as (
    select a.* from public.attendance a
    where a.class_name = p_class and a.session_date = p_date
  )
  select
    coalesce(r.id, m.student_id),
    coalesce(r.name, m.student_name),
    coalesce(r.plan, 'not registered'),
    r.id is not null,
    m.status,
    m.marked_at,
    p.full_name
  from registered r
  full join marked m on m.student_id = r.id
  left join public.profiles p on p.id = m.marked_by
  where public.current_user_has_permission('attendance')
  order by 2
$$;

revoke all on function public.attendance_roster(text, date) from public, anon;
grant execute on function public.attendance_roster(text, date) to authenticated;

-- 3. Children who could be added to a register by hand (a walk-in, or a
-- child whose booking was taken over the phone): active students of the class.
create or replace function public.attendance_class_students(p_class text)
returns table (student_id text, student_name text)
language sql stable security definer set search_path = public
as $$
  select s.id, s.name from public.students s
  where s.class_name = p_class and s.membership_status = 'active'
    and public.current_user_has_permission('attendance')
  order by s.name
$$;

revoke all on function public.attendance_class_students(text) from public, anon;
grant execute on function public.attendance_class_students(text) to authenticated;

notify pgrst, 'reload schema';
