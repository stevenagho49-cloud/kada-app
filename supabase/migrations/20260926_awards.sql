-- Migration: awards / positive points (Operations > Attendance > Awards, and the
-- parent dashboard's award gallery).
--   award_types    — the admin-managed set of awards ("Star Mover", ...), each
--                    using one of the static badge graphics in public/badges/.
--   student_awards — an award given to a child: who gave it, when, which
--                    session, an optional personal note.
-- Giving awards piggybacks on the 'attendance' staff permission: the person
-- running the session takes the register and hands out awards from the same
-- screen. Only admins manage the award types themselves.
-- Parents can read their own children's awards and nothing else.
-- Idempotent — safe to run repeatedly.
-- Apply via Supabase Dashboard > SQL Editor.

-- 1. Award types. badge is one of the static assets in public/badges/<badge>.png.
-- Archived types stay attached to awards already given but can't be given again.
create table if not exists public.award_types (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 60),
  description text not null default '' check (length(description) <= 200),
  badge text not null check (badge in ('star', 'team', 'growth', 'sun', 'heart', 'music', 'crown', 'bolt')),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.award_types enable row level security;

-- Names and badges aren't sensitive: any signed-in user can read them.
drop policy if exists "Signed-in users can read award types" on public.award_types;
create policy "Signed-in users can read award types" on public.award_types for select
  to authenticated using (true);

drop policy if exists "Admins can manage award types" on public.award_types;
create policy "Admins can manage award types" on public.award_types for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

insert into public.award_types (name, description, badge, sort_order)
select * from (values
  ('Star Mover', 'Brought energy, rhythm and joy to every move.', 'star', 1),
  ('Great Teamwork', 'Helped, encouraged and worked brilliantly with others.', 'team', 2),
  ('Most Improved', 'Worked hard and made a big leap forward.', 'growth', 3),
  ('Perfect Attitude', 'Listened well, tried everything and stayed positive.', 'sun', 4)
) as seed(name, description, badge, sort_order)
where not exists (select 1 from public.award_types);

-- 2. Awards given. award_name / badge / award_description are snapshotted so a
-- child's keepsake never changes if an admin later renames or re-badges a type;
-- student_name so session leaders (who can't read the students table) see who got it.
create table if not exists public.student_awards (
  id uuid primary key default gen_random_uuid(),
  student_id text not null references public.students(id) on delete cascade,
  student_name text not null default '',
  award_type_id uuid references public.award_types(id) on delete set null,
  award_name text not null,
  award_description text not null default '',
  badge text not null,
  note text check (note is null or length(note) <= 280),
  class_name text,
  session_date date,
  given_by uuid references auth.users(id) on delete set null,
  given_by_name text,
  email_sent_at timestamptz,
  email_error text,
  created_at timestamptz not null default now()
);

create index if not exists student_awards_student_idx on public.student_awards (student_id, created_at desc);

alter table public.student_awards enable row level security;

-- Session leaders (attendance permission) and admins see and manage all awards.
-- New awards are written by the server so the celebration email goes out once.
drop policy if exists "Attendance staff can manage awards" on public.student_awards;
create policy "Attendance staff can manage awards" on public.student_awards for all
  using (public.current_user_has_permission('attendance'))
  with check (public.current_user_has_permission('attendance'));

-- Parents: only awards for children in a family they own. Same ownership test
-- as the existing "Parents can read their family" policy on parent_families.
drop policy if exists "Parents can read their children's awards" on public.student_awards;
create policy "Parents can read their children's awards" on public.student_awards for select
  using (exists (
    select 1
    from public.students s
    join public.parent_families f on f.id = s.family_id
    where s.id = student_awards.student_id
      and (f.owner_user_id = auth.uid() or f.guardian_email = auth.email())
  ));

notify pgrst, 'reload schema';
