-- Migration: the attendance register follows class enrolment, not billing.
-- Previously attendance_roster / attendance_class_students required
-- students.membership_status = 'active', so enrolled children whose family had
-- not paid yet (status 'inactive', e.g. families moving onto the new system
-- with an Enquiry booking) were missing from the register and could not even
-- be added by hand. Billing status stays visible on Students/Subscriptions.
-- On the register now: every child of the class who has not left (status
-- 'cancelled') and whose booking is not cancelled, where
--   * a Day Pass booking covers only its own date (term = the class date), and
--   * any other enrolment (membership, or a plain enquiry/enrolment booking,
--     or no booking) counts from its start date (term) onwards.
-- Anyone already marked for the session is still always included.
-- Idempotent. Apply via Supabase Dashboard > SQL Editor.

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
      case
        when b.session_type like '%(monthly_membership)' then 'membership'
        when b.session_type like '%(day_pass)' then 'day_pass'
        else 'enrolled'
      end as plan
    from public.students s
    left join public.bookings b on b.id = s.booking_id
    where s.class_name = p_class
      and coalesce(s.membership_status, '') <> 'cancelled'
      and coalesce(b.status, '') <> 'Cancelled'
      and (
        s.term = p_date::text
        or (
          coalesce(b.session_type, '') not like '%(day_pass)'
          -- a non-date term (blank or free text) means no known start date
          and (coalesce(s.term, '') !~ '^\d{4}-\d{2}-\d{2}$' or s.term <= p_date::text)
        )
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

create or replace function public.attendance_class_students(p_class text)
returns table (student_id text, student_name text)
language sql stable security definer set search_path = public
as $$
  select s.id, s.name from public.students s
  where s.class_name = p_class and coalesce(s.membership_status, '') <> 'cancelled'
    and public.current_user_has_permission('attendance')
  order by s.name
$$;

revoke all on function public.attendance_class_students(text) from public, anon;
grant execute on function public.attendance_class_students(text) to authenticated;

notify pgrst, 'reload schema';
