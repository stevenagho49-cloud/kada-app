-- Migration: manual arrears + subscription requests (Operations > Sales).
--   * Manual arrears are ordinary invoice rows in public.bookings (so the
--     arrears view, parent Invoices tab, Pay now, reminders and the Stripe
--     webhook all treat them like any other invoice). They carry the free-text
--     reason and the months they cover.
--   * Subscription requests: admin emails an existing parent a link that opens
--     Stripe Checkout (subscription mode) for a plan. One row per request; the
--     token in the link is the only credential and only starts that checkout.
-- Written only by the server (service role). Idempotent: safe to run repeatedly.
-- Apply via Supabase Dashboard > SQL Editor.

-- 1. Manual arrears details on the invoice row.
alter table public.bookings add column if not exists arrears_reason text;
-- Months covered, as 'YYYY-MM' strings, e.g. {2026-09,2026-10}.
alter table public.bookings add column if not exists arrears_months text[];

-- 2. Subscription requests.
create table if not exists public.subscription_requests (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  family_id text not null references public.parent_families(id) on delete cascade,
  plan_type text not null check (plan_type in ('monthly_membership')),
  recipient text not null,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed', 'completed')),
  error text,
  resend_id text,
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  stripe_checkout_session_id text,
  stripe_subscription_id text
);

create index if not exists subscription_requests_family_idx on public.subscription_requests (family_id, created_at desc);

-- Server-only: RLS on with no policies, so the browser (anon/authenticated
-- keys) can neither read tokens nor write rows.
alter table public.subscription_requests enable row level security;
