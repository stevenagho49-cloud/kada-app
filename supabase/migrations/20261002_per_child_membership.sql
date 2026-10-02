-- Migration: per-child Monthly Membership pricing.
-- The Monthly Membership is now £25 a month per child on the family's account
-- (one Stripe subscription, quantity = children). The server keeps the Stripe
-- quantity in step as children are added or removed, but only for per-child
-- subscriptions: families who subscribed under the old flat £25/family rate keep
-- it until an admin deliberately switches them (Sales > Subscriptions).
-- Idempotent: safe to run repeatedly. Apply via Supabase Dashboard > SQL Editor.

-- 'per_child' = quantity follows the children; 'flat' = old one-price-per-family.
alter table public.parent_families add column if not exists membership_pricing text check (membership_pricing in ('per_child', 'flat'));
-- Children the subscription is charging for, and the monthly total before any
-- discount code, as last set in Stripe (shown in the dashboards).
alter table public.parent_families add column if not exists membership_children integer;
alter table public.parent_families add column if not exists membership_monthly_pence integer;

-- Everyone already subscribed was signed up at the flat rate: mark them so,
-- so nothing changes their price without an admin choosing to.
update public.parent_families
set membership_pricing = 'flat', membership_monthly_pence = coalesce(membership_monthly_pence, 2500)
where stripe_subscription_id is not null and membership_pricing is null;
