-- Subscription requests can carry a discount code chosen by staff when sending.
-- Stores a snapshot of the code's terms at send time ({ code, type, percentOff,
-- amountOffPence, membershipDuration }) so the checkout link always applies the
-- discount the email promised, even if the code is edited later.
alter table public.subscription_requests add column if not exists discount jsonb;
