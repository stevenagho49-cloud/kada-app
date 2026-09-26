-- Migration: homework / practice tasks (Operations > Homework, and the parent
-- dashboard's Homework tab).
--   homework_tasks        — title, instructions, optional reference image and
--                           YouTube link, and the class it was set for (if any).
--   homework_assignments  — exactly which children a task was set for, fixed
--                           when it is created (a whole class = every child in
--                           it at that moment). Child and family names are
--                           snapshotted so staff can always see who it went to.
--   homework_completions  — a parent marking a task done for their child.
-- Access is a new 'homework' staff permission area (admins always pass).
-- Parents see only tasks set for their own children and can mark only those.
-- Reference images live in the public 'homework-images' bucket (they appear in
-- the notification email); only homework staff can upload or delete them.
-- Idempotent — safe to run repeatedly.
-- Apply via Supabase Dashboard > SQL Editor.

-- 1. Is this child in a family the signed-in parent owns? Same ownership test
-- as the existing "Parents can read their family" policy. Security definer so
-- the policies below don't depend on the students table's own policies.
create or replace function public.is_my_child(p_student_id text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.students s
    join public.parent_families f on f.id = s.family_id
    where s.id = p_student_id
      and (f.owner_user_id = auth.uid() or f.guardian_email = auth.email())
  )
$$;

-- 2. Tasks.
create table if not exists public.homework_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 120),
  description text not null default '' check (length(description) <= 4000),
  image_path text,
  youtube_url text,
  youtube_id text check (youtube_id is null or youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  class_name text,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);

-- 3. Who each task was set for.
create table if not exists public.homework_assignments (
  task_id uuid not null references public.homework_tasks(id) on delete cascade,
  student_id text not null references public.students(id) on delete cascade,
  student_name text not null,
  family_id text,
  guardian_name text,
  emailed_at timestamptz,
  email_error text,
  primary key (task_id, student_id)
);

create index if not exists homework_assignments_student_idx on public.homework_assignments (student_id);

-- 4. Done marks. The foreign key to the assignment means a task can only be
-- marked done for a child it was actually set for.
create table if not exists public.homework_completions (
  task_id uuid not null,
  student_id text not null,
  marked_by uuid references auth.users(id) on delete set null,
  marked_at timestamptz not null default now(),
  primary key (task_id, student_id),
  foreign key (task_id, student_id) references public.homework_assignments(task_id, student_id) on delete cascade
);

alter table public.homework_tasks enable row level security;
alter table public.homework_assignments enable row level security;
alter table public.homework_completions enable row level security;

drop policy if exists "Homework staff can manage tasks" on public.homework_tasks;
create policy "Homework staff can manage tasks" on public.homework_tasks for all
  using (public.current_user_has_permission('homework'))
  with check (public.current_user_has_permission('homework'));

drop policy if exists "Parents can read their children's tasks" on public.homework_tasks;
create policy "Parents can read their children's tasks" on public.homework_tasks for select
  using (exists (
    select 1 from public.homework_assignments a
    where a.task_id = homework_tasks.id and public.is_my_child(a.student_id)
  ));

drop policy if exists "Homework staff can manage assignments" on public.homework_assignments;
create policy "Homework staff can manage assignments" on public.homework_assignments for all
  using (public.current_user_has_permission('homework'))
  with check (public.current_user_has_permission('homework'));

drop policy if exists "Parents can read their children's assignments" on public.homework_assignments;
create policy "Parents can read their children's assignments" on public.homework_assignments for select
  using (public.is_my_child(student_id));

-- Staff can view (and correct) every mark.
drop policy if exists "Homework staff can manage completions" on public.homework_completions;
create policy "Homework staff can manage completions" on public.homework_completions for all
  using (public.current_user_has_permission('homework'))
  with check (public.current_user_has_permission('homework'));

-- Parents: see, mark and unmark only their own children, recorded as themselves.
drop policy if exists "Parents can read their children's completions" on public.homework_completions;
create policy "Parents can read their children's completions" on public.homework_completions for select
  using (public.is_my_child(student_id));

drop policy if exists "Parents can mark their children's homework" on public.homework_completions;
create policy "Parents can mark their children's homework" on public.homework_completions for insert
  with check (public.is_my_child(student_id) and marked_by = auth.uid());

drop policy if exists "Parents can unmark their children's homework" on public.homework_completions;
create policy "Parents can unmark their children's homework" on public.homework_completions for delete
  using (public.is_my_child(student_id));

-- 5. Reference images: public read (shown in emails), homework staff write.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('homework-images', 'homework-images', true, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 10485760, allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

drop policy if exists "Homework staff can upload homework images" on storage.objects;
drop policy if exists "Homework staff can update homework images" on storage.objects;
drop policy if exists "Homework staff can delete homework images" on storage.objects;
drop policy if exists "Anyone can read homework images" on storage.objects;
create policy "Homework staff can upload homework images" on storage.objects for insert to authenticated with check (bucket_id = 'homework-images' and public.current_user_has_permission('homework'));
create policy "Homework staff can update homework images" on storage.objects for update to authenticated using (bucket_id = 'homework-images' and public.current_user_has_permission('homework'));
create policy "Homework staff can delete homework images" on storage.objects for delete to authenticated using (bucket_id = 'homework-images' and public.current_user_has_permission('homework'));
create policy "Anyone can read homework images" on storage.objects for select using (bucket_id = 'homework-images');

notify pgrst, 'reload schema';
