create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'school' check (role in ('admin', 'school', 'instructor', 'parent')),
  full_name text,
  school_id text,
  instructor_id text,
  family_id text,
  can_send_invoices boolean not null default false,
  created_at timestamptz default now()
);

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'family_id'
  ) then
    alter table public.profiles add column family_id text;
  end if;
end
$$;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'school', 'instructor', 'parent'));

create table if not exists public.schools (
  id text primary key,
  name text not null,
  contact_name text,
  email text,
  phone text,
  notes text,
  created_at timestamptz default now()
);

create table if not exists public.instructors (
  id text primary key,
  name text not null,
  email text,
  phone text,
  rate numeric default 0,
  location_areas text,
  gender text,
  created_at timestamptz default now()
);

alter table public.instructors add column if not exists location_areas text;
alter table public.instructors add column if not exists gender text;
alter table public.instructors add column if not exists dbs_status text not null default 'Missing' check (dbs_status in ('Missing', 'Pending', 'Approved', 'Rejected'));
alter table public.instructors add column if not exists dbs_file_path text;
alter table public.instructors add column if not exists dbs_uploaded_at timestamptz;
alter table public.instructors add column if not exists dbs_decided_at timestamptz;
alter table public.instructors add column if not exists dbs_rejection_reason text;

create table if not exists public.instructor_public_profiles (
  id text primary key references public.instructors(id) on delete cascade,
  first_name text not null,
  updated_at timestamptz not null default now()
);

create or replace function public.sync_instructor_public_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.instructor_public_profiles where id = old.id;
    return old;
  end if;
  insert into public.instructor_public_profiles (id, first_name, updated_at)
  values (new.id, coalesce(nullif(split_part(trim(new.name), ' ', 1), ''), 'Instructor'), now())
  on conflict (id) do update set first_name = excluded.first_name, updated_at = excluded.updated_at;
  return new;
end;
$$;

drop trigger if exists instructors_public_profile_sync on public.instructors;
create trigger instructors_public_profile_sync
after insert or update of name or delete on public.instructors
for each row execute function public.sync_instructor_public_profile();

insert into public.instructor_public_profiles (id, first_name)
select id, coalesce(nullif(split_part(trim(name), ' ', 1), ''), 'Instructor')
from public.instructors
on conflict (id) do update set first_name = excluded.first_name, updated_at = now();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dbs-certificates', 'dbs-certificates', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

create table if not exists public.bookings (
  id text primary key,
  school_id text,
  contact_name text,
  contact_email text,
  date date,
  session_type text,
  price numeric default 0,
  student_count integer default 0,
  instructor_id text,
  status text default 'Enquiry',
  invoice_status text default 'Not sent',
  invoice_number text,
  notes text,
  created_at timestamptz default now()
);

alter table public.bookings add column if not exists requested_by uuid references auth.users(id);
alter table public.bookings add column if not exists stripe_checkout_session_id text unique;
alter table public.bookings add column if not exists payment_status text default 'unpaid';
alter table public.bookings add column if not exists instructor_pay numeric default 0;
alter table public.bookings add column if not exists needs_admin_attention boolean default false;
alter table public.bookings add column if not exists completed_at timestamptz;
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bookings'
      and column_name = 'family_id'
  ) then
    alter table public.bookings add column family_id text;
  end if;
end
$$;

create table if not exists public.students (
  id text primary key,
  booking_id text references public.bookings(id) on delete cascade,
  family_id text,
  parent_name text,
  parent_email text,
  name text not null,
  date_of_birth date not null,
  class_name text,
  term text,
  membership_status text not null default 'active' check (membership_status in ('active', 'inactive')),
  created_at timestamptz default now()
);

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'students'
      and column_name = 'family_id'
  ) then
    alter table public.students add column family_id text;
  end if;
end
$$;

create table if not exists public.parent_families (
  id text primary key,
  guardian_name text not null,
  guardian_email text not null,
  plan_type text check (plan_type in ('monthly_membership', 'day_pass')),
  membership_status text not null default 'pending' check (membership_status in ('pending', 'active', 'inactive', 'cancelled')),
  stripe_customer_id text,
  stripe_subscription_id text unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.parent_families add column if not exists owner_user_id uuid references auth.users(id);
alter table public.parent_families alter column plan_type drop not null;

create table if not exists public.job_board_jobs (
  id text primary key,
  booking_id text not null unique references public.bookings(id) on delete cascade,
  date date not null,
  session_type text,
  student_count integer default 0,
  location_area text,
  instructor_pay numeric not null default 0,
  status text not null default 'open' check (status in ('open', 'pending', 'accepted', 'rejected')),
  claimed_by text,
  rejection_reason text,
  published_at timestamptz default now(),
  claimed_at timestamptz,
  decided_at timestamptz
);

create table if not exists public.workshop_template (
  id text primary key default gen_random_uuid()::text,
  max_students_per_staff integer default 30,
  default_duration integer default 45,
  sections jsonb default '[]'::jsonb,
  notes text,
  updated_at timestamptz default now()
);

create table if not exists public.messages (
  id text primary key default gen_random_uuid()::text,
  sender_kind text not null check (sender_kind in ('admin', 'instructor', 'school')),
  sender_instructor_id text,
  sender_school_id text,
  recipient_kind text not null check (recipient_kind in ('admin', 'instructor', 'school')),
  recipient_instructor_id text,
  recipient_school_id text,
  body text not null,
  read_at timestamptz,
  created_at timestamptz default now()
);

alter table public.profiles add column if not exists can_send_invoices boolean not null default false;

create table if not exists public.invoice_settings (
  id text primary key default 'default',
  account_name text not null default '',
  sort_code text not null default '',
  account_number text not null default '',
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id)
);

insert into public.invoice_settings (id)
values ('default')
on conflict (id) do nothing;

update public.profiles
set can_send_invoices = true
where id in (select id from auth.users where lower(email) = 'annedrea@kingsarkdance.com');

alter table public.schools enable row level security;
alter table public.instructors enable row level security;
alter table public.instructor_public_profiles enable row level security;
alter table public.bookings enable row level security;
alter table public.workshop_template enable row level security;
alter table public.profiles enable row level security;
alter table public.students enable row level security;
alter table public.parent_families enable row level security;
alter table public.job_board_jobs enable row level security;
alter table public.messages enable row level security;
alter table public.invoice_settings enable row level security;

drop policy if exists "Allow read access for all users" on public.schools;
drop policy if exists "Allow write access for all users" on public.schools;
drop policy if exists "Allow read access for all users" on public.instructors;
drop policy if exists "Allow write access for all users" on public.instructors;
drop policy if exists "Allow read access for all users" on public.bookings;
drop policy if exists "Allow write access for all users" on public.bookings;
drop policy if exists "Allow read access for all users" on public.workshop_template;
drop policy if exists "Allow write access for all users" on public.workshop_template;
drop policy if exists "Users can read their own profile" on public.profiles;
drop policy if exists "Users can create their own non-admin profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Admins can manage schools" on public.schools;
drop policy if exists "Schools can read their own school" on public.schools;
drop policy if exists "Schools can update their own school" on public.schools;
drop policy if exists "Admins can manage instructors" on public.instructors;
drop policy if exists "Instructors can read their own record" on public.instructors;
drop policy if exists "Instructors can update their own DBS upload" on public.instructors;
drop policy if exists "Admins can manage public instructor profiles" on public.instructor_public_profiles;
drop policy if exists "Schools can read assigned public instructor profiles" on public.instructor_public_profiles;
drop policy if exists "Instructors can read their public profile" on public.instructor_public_profiles;
drop policy if exists "Admins can manage bookings" on public.bookings;
drop policy if exists "Schools can read their bookings" on public.bookings;
drop policy if exists "Schools can request their bookings" on public.bookings;
drop policy if exists "Schools can update their bookings" on public.bookings;
drop policy if exists "Instructors can read assigned bookings" on public.bookings;
drop policy if exists "Admins can manage students" on public.students;
drop policy if exists "Schools can read their students" on public.students;
drop policy if exists "Instructors can read assigned students" on public.students;
drop policy if exists "Admins can manage parent families" on public.parent_families;
drop policy if exists "Parents can read their family" on public.parent_families;
drop policy if exists "Parents can update their family" on public.parent_families;
drop policy if exists "Parents can read their bookings" on public.bookings;
drop policy if exists "Parents can update their bookings" on public.bookings;
drop policy if exists "Parents can read their students" on public.students;
drop policy if exists "Admins can manage job board" on public.job_board_jobs;
drop policy if exists "Instructors can read visible jobs" on public.job_board_jobs;
drop policy if exists "Instructors can claim open jobs" on public.job_board_jobs;
drop policy if exists "Instructors can withdraw claims" on public.job_board_jobs;
drop policy if exists "Instructors can mark assigned bookings done" on public.bookings;
drop policy if exists "Admins can manage workshop template" on public.workshop_template;
drop policy if exists "Instructors can read workshop template" on public.workshop_template;
drop policy if exists "Admins can manage messages" on public.messages;
drop policy if exists "Participants can read their messages" on public.messages;
drop policy if exists "Participants can send messages" on public.messages;
drop policy if exists "Recipients can mark messages read" on public.messages;
drop policy if exists "Admins can manage invoice settings" on public.invoice_settings;
drop policy if exists "Admins can read invoice settings" on public.invoice_settings;
drop policy if exists "Invoice senders can read bookings" on public.bookings;
drop policy if exists "Invoice senders can update invoice fields" on public.bookings;

create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  new_school_id text;
begin
  if coalesce(new.raw_user_meta_data->>'role', 'school') = 'school' then
    new_school_id := gen_random_uuid()::text;
    insert into public.schools (id, name, contact_name, email)
    values (new_school_id, coalesce(new.raw_user_meta_data->>'school_name', 'New school'), new.raw_user_meta_data->>'full_name', new.email);
  end if;

  if coalesce(new.raw_user_meta_data->>'role', 'school') = 'parent' then
    new_school_id := null;
    insert into public.parent_families (id, owner_user_id, guardian_name, guardian_email, membership_status)
    values (gen_random_uuid()::text, new.id, coalesce(new.raw_user_meta_data->>'full_name', 'Parent'), new.email, 'pending')
    returning id into new_school_id;
  end if;

  insert into public.profiles (id, role, full_name, school_id, family_id)
  values (new.id, case when new.raw_user_meta_data->>'role' = 'instructor' then 'instructor' when new.raw_user_meta_data->>'role' = 'parent' then 'parent' else 'school' end, new.raw_user_meta_data->>'full_name', case when new.raw_user_meta_data->>'role' = 'parent' then null else new_school_id end, case when new.raw_user_meta_data->>'role' = 'parent' then new_school_id else null end);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create policy "Users can read their own profile" on public.profiles for select using (id = auth.uid());
create policy "Users can create their own non-admin profile" on public.profiles for insert with check (id = auth.uid() and role in ('school', 'instructor', 'parent'));
create policy "Users can update their own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid() and role in ('school', 'instructor', 'parent'));

create policy "Admins can manage schools" on public.schools for all using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "Schools can read their own school" on public.schools for select using (id = (select school_id from public.profiles where id = auth.uid()));
create policy "Schools can update their own school" on public.schools for update using (id = (select school_id from public.profiles where id = auth.uid())) with check (id = (select school_id from public.profiles where id = auth.uid()));

create policy "Admins can manage instructors" on public.instructors for all using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "Instructors can read their own record" on public.instructors for select using (id = (select instructor_id from public.profiles where id = auth.uid()));
create policy "Instructors can update their own DBS upload" on public.instructors for update using (id = (select instructor_id from public.profiles where id = auth.uid())) with check (id = (select instructor_id from public.profiles where id = auth.uid()) and dbs_status = 'Pending');

create policy "Admins can manage public instructor profiles" on public.instructor_public_profiles for all using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "Schools can read assigned public instructor profiles" on public.instructor_public_profiles for select using (
  exists (
    select 1 from public.bookings
    where bookings.instructor_id = instructor_public_profiles.id
      and bookings.school_id = (select school_id from public.profiles where id = auth.uid())
  )
);
create policy "Instructors can read their public profile" on public.instructor_public_profiles for select using (id = (select instructor_id from public.profiles where id = auth.uid()));

drop policy if exists "Instructors can upload their DBS certificate" on storage.objects;
drop policy if exists "Instructors can read their DBS certificate" on storage.objects;
drop policy if exists "Instructors can delete their DBS uploads" on storage.objects;
create policy "Instructors can upload their DBS certificate" on storage.objects for insert to authenticated with check (bucket_id = 'dbs-certificates' and (storage.foldername(name))[1] = (select instructor_id from public.profiles where id = auth.uid()) and public.current_user_role() = 'instructor');
create policy "Instructors can read their DBS certificate" on storage.objects for select to authenticated using (bucket_id = 'dbs-certificates' and (storage.foldername(name))[1] = (select instructor_id from public.profiles where id = auth.uid()) and public.current_user_role() = 'instructor');
create policy "Instructors can delete their DBS uploads" on storage.objects for delete to authenticated using (bucket_id = 'dbs-certificates' and (storage.foldername(name))[1] = (select instructor_id from public.profiles where id = auth.uid()) and public.current_user_role() = 'instructor');

create policy "Admins can manage bookings" on public.bookings for all using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "Schools can read their bookings" on public.bookings for select using (school_id = (select school_id from public.profiles where id = auth.uid()));
create policy "Schools can request their bookings" on public.bookings for insert with check (school_id = (select school_id from public.profiles where id = auth.uid()) and requested_by = auth.uid());
create policy "Schools can update their bookings" on public.bookings for update using (school_id = (select school_id from public.profiles where id = auth.uid())) with check (school_id = (select school_id from public.profiles where id = auth.uid()));
create policy "Instructors can read assigned bookings" on public.bookings for select using (instructor_id = (select instructor_id from public.profiles where id = auth.uid()));
create policy "Instructors can mark assigned bookings done" on public.bookings for update using (instructor_id = (select instructor_id from public.profiles where id = auth.uid())) with check (instructor_id = (select instructor_id from public.profiles where id = auth.uid()));

create policy "Admins can manage students" on public.students for all using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "Schools can read their students" on public.students for select using (booking_id in (select id from public.bookings where school_id = (select school_id from public.profiles where id = auth.uid())));
create policy "Instructors can read assigned students" on public.students for select using (booking_id in (select id from public.bookings where instructor_id = (select instructor_id from public.profiles where id = auth.uid())));

create policy "Admins can manage parent families" on public.parent_families for all using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "Parents can read their family" on public.parent_families for select using (guardian_email = auth.email() or owner_user_id = auth.uid());
create policy "Parents can update their family" on public.parent_families for update using (guardian_email = auth.email() or owner_user_id = auth.uid()) with check (guardian_email = auth.email() or owner_user_id = auth.uid());

create policy "Parents can read their bookings" on public.bookings for select using (family_id in (select id from public.parent_families where owner_user_id = auth.uid() or guardian_email = auth.email()));
create policy "Parents can update their bookings" on public.bookings for update using (family_id in (select id from public.parent_families where owner_user_id = auth.uid() or guardian_email = auth.email())) with check (family_id in (select id from public.parent_families where owner_user_id = auth.uid() or guardian_email = auth.email()));
create policy "Parents can read their students" on public.students for select using (family_id in (select id from public.parent_families where owner_user_id = auth.uid() or guardian_email = auth.email()));

create policy "Admins can manage job board" on public.job_board_jobs for all using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create or replace function public.current_instructor_dbs_status()
returns text language sql stable security definer set search_path = public
as $$ select coalesce((select instructors.dbs_status from public.instructors where instructors.id = (select profiles.instructor_id from public.profiles where profiles.id = auth.uid())), 'Missing') $$;

create policy "Instructors can read visible jobs" on public.job_board_jobs for select using (public.current_user_role() = 'instructor' and public.current_instructor_dbs_status() = 'Approved' and (status = 'open' or claimed_by = (select instructor_id from public.profiles where id = auth.uid())));
create policy "Instructors can claim open jobs" on public.job_board_jobs for update using (public.current_user_role() = 'instructor' and public.current_instructor_dbs_status() = 'Approved' and status = 'open') with check (public.current_user_role() = 'instructor' and public.current_instructor_dbs_status() = 'Approved' and status = 'pending' and claimed_by = (select instructor_id from public.profiles where id = auth.uid()));
create policy "Instructors can withdraw claims" on public.job_board_jobs for update using (public.current_user_role() = 'instructor' and public.current_instructor_dbs_status() = 'Approved' and claimed_by = (select instructor_id from public.profiles where id = auth.uid()) and status = 'pending') with check (public.current_user_role() = 'instructor' and public.current_instructor_dbs_status() = 'Approved' and status = 'open' and claimed_by is null);

create policy "Admins can manage workshop template" on public.workshop_template for all using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "Instructors can read workshop template" on public.workshop_template for select using (public.current_user_role() = 'instructor');
create policy "Admins can manage messages" on public.messages for all using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');

create policy "Admins can manage invoice settings" on public.invoice_settings for all using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "Admins can read invoice settings" on public.invoice_settings for select using (public.current_user_role() = 'admin');
create policy "Invoice senders can read bookings" on public.bookings for select using ((select can_send_invoices from public.profiles where id = auth.uid()) = true);
create policy "Participants can read their messages" on public.messages for select using (
  (sender_kind = 'instructor' and sender_instructor_id = (select instructor_id from public.profiles where id = auth.uid()))
  or (recipient_kind = 'instructor' and recipient_instructor_id = (select instructor_id from public.profiles where id = auth.uid()))
  or (sender_kind = 'school' and sender_school_id = (select school_id from public.profiles where id = auth.uid()))
  or (recipient_kind = 'school' and recipient_school_id = (select school_id from public.profiles where id = auth.uid()))
);
create policy "Participants can send messages" on public.messages for insert with check (
  (sender_kind = 'instructor' and sender_instructor_id = (select instructor_id from public.profiles where id = auth.uid()) and sender_school_id is null and recipient_kind = 'admin')
  or (sender_kind = 'school' and sender_school_id = (select school_id from public.profiles where id = auth.uid()) and sender_instructor_id is null and recipient_kind = 'admin')
);
create policy "Recipients can mark messages read" on public.messages for update using (
  (recipient_kind = 'instructor' and recipient_instructor_id = (select instructor_id from public.profiles where id = auth.uid()))
  or (recipient_kind = 'school' and recipient_school_id = (select school_id from public.profiles where id = auth.uid()))
) with check (
  (recipient_kind = 'instructor' and recipient_instructor_id = (select instructor_id from public.profiles where id = auth.uid()))
  or (recipient_kind = 'school' and recipient_school_id = (select school_id from public.profiles where id = auth.uid()))
);

-- Ask PostgREST to reload its schema cache so newly created tables/columns are visible via the API immediately.
notify pgrst, 'reload schema';
