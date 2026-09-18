-- Migration: admin-configurable weekly class schedule (class_sessions).
-- Powers the public class booking form: only dates matching an active scheduled
-- class are selectable. Idempotent — safe to run repeatedly.
-- Apply via Supabase Dashboard > SQL Editor.

create table if not exists public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  day_of_week smallint not null check (day_of_week between 0 and 6), -- 0 = Sunday … 6 = Saturday
  start_time time not null,
  end_time time,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.class_sessions enable row level security;

drop policy if exists "Admins can manage class sessions" on public.class_sessions;
drop policy if exists "Public can read active class sessions" on public.class_sessions;

create policy "Admins can manage class sessions" on public.class_sessions for all using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
-- Guests and parents only see sessions that are currently bookable.
create policy "Public can read active class sessions" on public.class_sessions for select using (active = true);

-- Seed the three existing Saturday classes so the booking form keeps working
-- immediately after this migration is applied.
insert into public.class_sessions (name, day_of_week, start_time, end_time, description)
select * from (values
  ('Saturday Gospel Afrobeats', 6, '10:00'::time, '11:00'::time, 'Flagship Saturday class — Gospel Afrobeats for ages 5–16.'),
  ('Saturday Foundations', 6, '11:00'::time, '12:00'::time, 'Core technique and confidence building for newer dancers.'),
  ('Saturday Performance Team', 6, '12:00'::time, '13:00'::time, 'For dancers preparing for performances and showcases.')
) as seed(name, day_of_week, start_time, end_time, description)
where not exists (select 1 from public.class_sessions);

notify pgrst, 'reload schema';
