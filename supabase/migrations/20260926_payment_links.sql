-- Migration: payment links (Operations > Sales > Payment links).
-- A payment link is a one-item public page at /pay/<slug> (e.g. "T-shirts")
-- that collects any custom fields the admin configured and sends the buyer to
-- Stripe Checkout with an ad-hoc price_data line item. The Day Pass/Membership
-- Stripe products are never touched.
-- Idempotent — safe to run repeatedly.
-- Apply via Supabase Dashboard > SQL Editor.

-- 1. Payment links.
-- fields is a jsonb array of { id, label, type: 'text' | 'select', options: [..], required },
-- same flexible-definition approach as events.ticket_tiers.
create table if not exists public.payment_links (
  id text primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  description text,
  price_pence integer not null check (price_pence >= 30),
  fields jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payment_links enable row level security;

-- Anyone (signed in or not) can read ACTIVE links so the public /pay/<slug>
-- page can render. Paused links stay visible to sales staff only.
drop policy if exists "Public can read active payment links" on public.payment_links;
create policy "Public can read active payment links" on public.payment_links for select using (active);

-- Admins pass current_user_has_permission for every area; staff need 'sales'.
drop policy if exists "Sales can manage payment links" on public.payment_links;
create policy "Sales can manage payment links" on public.payment_links for all
  using (public.current_user_has_permission('sales'))
  with check (public.current_user_has_permission('sales'));

-- 2. Payment link orders. Rows are written ONLY by the server (service role):
-- a 'pending' row when checkout starts (holding the buyer's custom answers,
-- which can be too long for Stripe metadata), flipped to 'paid' by the webhook.
-- answers is a jsonb array of { fieldId, label, value } — the label is
-- snapshotted so old orders still read correctly if the admin renames a field.
-- on delete restrict: a link that has taken payments can be paused, not deleted.
create table if not exists public.payment_link_orders (
  id text primary key,
  payment_link_id text not null references public.payment_links(id) on delete restrict,
  link_name text not null,
  buyer_name text not null,
  buyer_email text not null,
  amount_pence integer not null default 0,
  answers jsonb not null default '[]'::jsonb,
  stripe_checkout_session_id text unique,
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'refunded')),
  paid_at timestamptz,
  confirmation_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists payment_link_orders_link_idx on public.payment_link_orders (payment_link_id, payment_status);

alter table public.payment_link_orders enable row level security;

-- No public access — buyer data stays private.
drop policy if exists "Sales can manage payment link orders" on public.payment_link_orders;
create policy "Sales can manage payment link orders" on public.payment_link_orders for all
  using (public.current_user_has_permission('sales'))
  with check (public.current_user_has_permission('sales'));

notify pgrst, 'reload schema';
