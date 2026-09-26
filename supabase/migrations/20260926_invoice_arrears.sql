-- Migration: invoice arrears (Operations > Sales > Arrears).
-- Invoices are bookings rows. This adds what arrears tracking needs:
--   * the invoice's sent date, due date and the edits made before sending
--     (description/rate/amount/discount), so "Pay now" charges exactly what the
--     invoice says and reminders can re-attach an identical PDF,
--   * a stable, unguessable pay token for the /api/invoices/pay/<token> link,
--   * the Stripe payment record,
--   * a log of every reminder email (auto day-3, auto day-10, manual).
-- Nothing here touches booking status or attendance: being overdue never
-- pauses, cancels or blocks anything. That stays a manual decision.
-- Idempotent — safe to run repeatedly.
-- Apply via Supabase Dashboard > SQL Editor.

-- 1. Invoice columns on bookings.
alter table public.bookings add column if not exists invoice_sent_at timestamptz;
alter table public.bookings add column if not exists invoice_due_date date;
alter table public.bookings add column if not exists invoice_overrides jsonb;
-- A volatile default gives every existing row its own token when the column is added.
alter table public.bookings add column if not exists invoice_pay_token text not null default replace(gen_random_uuid()::text, '-', '');
alter table public.bookings add column if not exists invoice_paid_at timestamptz;
alter table public.bookings add column if not exists invoice_paid_amount_pence integer;
alter table public.bookings add column if not exists invoice_payment_session_id text;
create unique index if not exists bookings_invoice_pay_token_idx on public.bookings (invoice_pay_token);

-- Invoices already marked Sent before this migration: assume they went out when
-- the booking was created, with the usual 14-day terms.
update public.bookings
set invoice_sent_at = coalesce(created_at, now()),
    invoice_due_date = (coalesce(created_at, now()) + interval '14 days')::date
where invoice_status = 'Sent' and invoice_sent_at is null;

-- 2. Keep the invoice dates and Stripe payments consistent however the row is
-- written. The Operations client saves the whole bookings table with upsert,
-- so a tab opened before a Stripe payment would otherwise write the stale
-- 'Sent' back over 'Paid'.
create or replace function public.bookings_invoice_guard()
returns trigger
language plpgsql
as $$
begin
  -- First time an invoice is sent (emailed or "Mark sent"): stamp 14-day terms.
  if new.invoice_status = 'Sent' and new.invoice_sent_at is null then
    new.invoice_sent_at := now();
  end if;
  if new.invoice_sent_at is not null and new.invoice_due_date is null then
    new.invoice_due_date := (new.invoice_sent_at + interval '14 days')::date;
  end if;
  -- Paid through Stripe stays Paid (refunds are handled in Stripe).
  if tg_op = 'UPDATE' and old.invoice_paid_at is not null and new.invoice_paid_at is not distinct from old.invoice_paid_at then
    new.invoice_status := 'Paid';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_invoice_guard on public.bookings;
create trigger bookings_invoice_guard
  before insert or update on public.bookings
  for each row execute function public.bookings_invoice_guard();

-- 3. Reminder log. Written only by the server (service role). kind:
--   auto_friendly — day 3 overdue, auto_firm — day 10 overdue (each at most once
--   per invoice, enforced by the partial unique index; the server claims a slot
--   by inserting before it sends), manual — sent by staff from the dashboard.
create table if not exists public.invoice_reminders (
  id uuid primary key default gen_random_uuid(),
  booking_id text not null references public.bookings(id) on delete cascade,
  kind text not null check (kind in ('auto_friendly', 'auto_firm', 'manual')),
  template text not null check (template in ('friendly', 'firm')),
  recipient text not null,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  error text,
  resend_id text,
  days_overdue integer,
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists invoice_reminders_auto_once_idx on public.invoice_reminders (booking_id, kind) where kind in ('auto_friendly', 'auto_firm');
create index if not exists invoice_reminders_booking_idx on public.invoice_reminders (booking_id, created_at);

alter table public.invoice_reminders enable row level security;

drop policy if exists "Sales can read invoice reminders" on public.invoice_reminders;
create policy "Sales can read invoice reminders" on public.invoice_reminders for select
  using (public.current_user_has_permission('sales'));

-- 4. Editable reminder wording (Arrears > Reminder emails, admin only). The
-- server falls back to its built-in defaults while this row is empty.
insert into public.app_settings (key, value) values ('invoice_reminders', '{}'::jsonb)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
