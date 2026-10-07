-- Website contact messages held as suspected spam. The public contact form
-- holds a message here, instead of emailing the admin inbox and filing the
-- sender in Contacts, when the text looks like random strings. Staff with the
-- 'contacts' permission review the list in Operations > Contacts and either
-- release a message (it is then emailed and filed exactly like a normal one)
-- or delete it.
-- Only the server (service role) reads and writes this table, so RLS is on
-- with no policies.
-- Idempotent — safe to run repeatedly. Apply via Supabase Dashboard > SQL Editor.

create table if not exists public.held_contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  topic text not null default 'other',
  message text not null,
  reasons text[] not null default '{}',
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists held_contact_messages_created_at_idx on public.held_contact_messages (created_at desc);

alter table public.held_contact_messages enable row level security;
