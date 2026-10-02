-- Migration: staff-managed session types with multi-date scheduling (posted to
-- the job board as one combined job or one job per date), and manual payment
-- confirmation for invoices (Operations dashboard > Payments).
-- Idempotent — safe to run repeatedly.
-- Apply via Supabase Dashboard > SQL Editor.

-- 1. Who confirmed a manually-paid invoice, how it was paid, and a note.
-- (Stripe "Pay now" payments keep using invoice_payment_session_id.)
alter table public.bookings add column if not exists invoice_paid_method text;
alter table public.bookings add column if not exists invoice_paid_by uuid references auth.users(id) on delete set null;
alter table public.bookings add column if not exists invoice_paid_note text;

-- 2. Session types: an open, staff-managed list ("2 Full Days", "Half Day
-- Intensive", ...). Active types are readable by everyone because the public
-- school enquiry form and the booking forms list them.
create table if not exists public.session_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  default_price numeric,
  default_instructor_pay numeric,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists session_types_name_idx on public.session_types (lower(name));

-- A scheduled run of a session type, on one or more dates. posting_mode decides
-- how it goes on the job board: 'combined' = one job covering every date (claimed
-- together), 'separate' = one job per date (claimed independently).
create table if not exists public.scheduled_sessions (
  id uuid primary key default gen_random_uuid(),
  session_type_id uuid not null references public.session_types(id) on delete restrict,
  title text not null,
  school_id text references public.schools(id) on delete set null,
  location_area text,
  student_count integer not null default 0,
  instructor_pay_per_day numeric not null default 0,
  posting_mode text not null check (posting_mode in ('combined', 'separate')),
  notes text,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.scheduled_session_dates (
  id uuid primary key default gen_random_uuid(),
  scheduled_session_id uuid not null references public.scheduled_sessions(id) on delete cascade,
  position integer not null default 1,
  session_date date not null,
  start_time time,
  end_time time,
  instructor_id text references public.instructors(id) on delete set null
);
create index if not exists scheduled_session_dates_date_idx on public.scheduled_session_dates (session_date);
create index if not exists scheduled_session_dates_session_idx on public.scheduled_session_dates (scheduled_session_id);

-- 3. Job board jobs can now come from a scheduled session instead of a booking.
-- session_dates lists every date a job covers ([{id, date, start, end, position}]);
-- a combined job lists them all, a separate job lists its one date.
alter table public.job_board_jobs alter column booking_id drop not null;
alter table public.job_board_jobs add column if not exists scheduled_session_id uuid references public.scheduled_sessions(id) on delete cascade;
alter table public.job_board_jobs add column if not exists session_dates jsonb not null default '[]'::jsonb;
create index if not exists job_board_jobs_session_idx on public.job_board_jobs (scheduled_session_id);

-- 4. Access. All writes go through the server (/api/session-types/*), which
-- checks the 'sessions' permission; these policies cover reads.
alter table public.session_types enable row level security;
alter table public.scheduled_sessions enable row level security;
alter table public.scheduled_session_dates enable row level security;

drop policy if exists "Anyone can read active session types" on public.session_types;
create policy "Anyone can read active session types" on public.session_types for select
  using (active or public.current_user_has_permission('sessions'));

drop policy if exists "Staff can read scheduled sessions" on public.scheduled_sessions;
create policy "Staff can read scheduled sessions" on public.scheduled_sessions for select
  using (public.current_user_has_permission('sessions') or public.current_user_has_permission('jobs') or public.current_user_has_permission('bookings'));

drop policy if exists "Staff can read scheduled session dates" on public.scheduled_session_dates;
create policy "Staff can read scheduled session dates" on public.scheduled_session_dates for select
  using (public.current_user_has_permission('sessions') or public.current_user_has_permission('jobs') or public.current_user_has_permission('bookings'));

drop policy if exists "Instructors can read their session dates" on public.scheduled_session_dates;
create policy "Instructors can read their session dates" on public.scheduled_session_dates for select
  using (instructor_id is not null and instructor_id = (select instructor_id from public.profiles where id = auth.uid()));

notify pgrst, 'reload schema';
