-- Apply after the event ticketing, attendee and staff-permissions migrations.
-- Limits count individual tickets, not bundles. Holds are released only when
-- Stripe confirms expiry, never on a timer that could race a delayed webhook.
create table if not exists public.event_ticket_reservations (
  id uuid primary key,
  event_id text not null references public.events(id) on delete cascade,
  tier_id text not null,
  tickets integer not null check (tickets > 0),
  state text not null default 'held' check (state in ('held', 'released', 'consumed')),
  stripe_checkout_session_id text unique,
  created_at timestamptz not null default now()
);
create index if not exists event_ticket_reservations_stock_idx
  on public.event_ticket_reservations(event_id, tier_id) where state = 'held';
create index if not exists event_ticket_orders_stock_idx
  on public.event_ticket_orders(event_id, tier_id) where payment_status = 'paid';
alter table public.event_ticket_reservations enable row level security;
alter table public.event_ticket_orders add column if not exists reservation_id uuid
  references public.event_ticket_reservations(id);

create or replace function public.validate_event_ticket_tiers()
returns trigger language plpgsql set search_path = public as $$
declare tier jsonb; ids text[] := '{}';
begin
  if jsonb_typeof(new.ticket_tiers) <> 'array' then
    raise exception 'Ticket tiers must be an array';
  end if;
  for tier in select value from jsonb_array_elements(new.ticket_tiers) loop
    if coalesce(tier->>'id', '') = '' or (tier->>'id') = any(ids) then
      raise exception 'Ticket tiers need unique, non-empty IDs';
    end if;
    ids := array_append(ids, tier->>'id');
    if tier ? 'quantityLimit' and tier->'quantityLimit' <> 'null'::jsonb and
       (jsonb_typeof(tier->'quantityLimit') <> 'number' or
        (tier->>'quantityLimit') !~ '^[0-9]+$' or
        (tier->>'quantityLimit')::numeric > 2147483647) then
      raise exception 'Limit quantity must be a non-negative whole number or blank';
    end if;
    if tier ? 'lowStockThreshold' and
       (jsonb_typeof(tier->'lowStockThreshold') <> 'number' or
        (tier->>'lowStockThreshold') !~ '^[0-9]+$' or
        (tier->>'lowStockThreshold')::numeric > 2147483647) then
      raise exception 'Low-stock threshold must be a non-negative whole number';
    end if;
    if tier ? 'soldOut' and jsonb_typeof(tier->'soldOut') <> 'boolean' then
      raise exception 'Sold out must be true or false';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists validate_event_ticket_tiers on public.events;
create trigger validate_event_ticket_tiers before insert or update of ticket_tiers
  on public.events for each row execute function public.validate_event_ticket_tiers();

create or replace function public.event_ticket_stock(p_event_ids text[])
returns table (
  event_id text, tier_id text, sold bigint, reserved bigint,
  quantity_limit integer, remaining bigint, sold_out boolean,
  available bigint, low_stock_threshold integer
) language sql stable security definer set search_path = public as $$
  select e.id, tier->>'id', counts.sold, holds.reserved,
    (tier->>'quantityLimit')::integer,
    case when tier->>'quantityLimit' is null then null
      else greatest(0, (tier->>'quantityLimit')::bigint - counts.sold) end,
    coalesce((tier->>'soldOut')::boolean, false) or
      (tier->>'quantityLimit' is not null and counts.sold >= (tier->>'quantityLimit')::bigint),
    case when tier->>'quantityLimit' is null then null
      else greatest(0, (tier->>'quantityLimit')::bigint - counts.sold - holds.reserved) end,
    coalesce((tier->>'lowStockThreshold')::integer, 10)
  from public.events e
  cross join lateral jsonb_array_elements(e.ticket_tiers) tier
  cross join lateral (
    select coalesce(sum(o.tickets), 0)::bigint sold from public.event_ticket_orders o
    where o.event_id = e.id and o.tier_id = tier->>'id' and o.payment_status = 'paid'
  ) counts
  cross join lateral (
    select coalesce(sum(r.tickets), 0)::bigint reserved from public.event_ticket_reservations r
    where r.event_id = e.id and r.tier_id = tier->>'id' and r.state = 'held'
  ) holds
  where e.id = any(p_event_ids) and
    (e.status = 'published' or public.current_user_has_permission('events'))
$$;
revoke all on function public.event_ticket_stock(text[]) from public;
grant execute on function public.event_ticket_stock(text[]) to anon, authenticated, service_role;

create or replace function public.reserve_event_tickets(
  p_event_id text, p_tier_id text, p_quantity integer, p_reservation_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare evt public.events; tier jsonb; ticket_count integer; sold_count bigint; held_count bigint; lim integer;
begin
  select * into evt from public.events where id = p_event_id for update;
  if not found or evt.status <> 'published' or not evt.ticketing_enabled then
    raise exception 'Tickets are not on sale for this event' using errcode = 'P0001';
  end if;
  select value into tier from jsonb_array_elements(evt.ticket_tiers) where value->>'id' = p_tier_id;
  if tier is null or coalesce((tier->>'soldOut')::boolean, false) then
    raise exception 'That ticket tier is sold out or unavailable' using errcode = 'P0001';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 20 then
    raise exception 'Quantity must be between 1 and 20';
  end if;
  ticket_count := p_quantity * greatest(1, coalesce((tier->>'bundleSize')::integer, 1));
  lim := (tier->>'quantityLimit')::integer;
  select coalesce(sum(tickets), 0) into sold_count from public.event_ticket_orders
    where event_id = p_event_id and tier_id = p_tier_id and payment_status = 'paid';
  select coalesce(sum(tickets), 0) into held_count from public.event_ticket_reservations
    where event_id = p_event_id and tier_id = p_tier_id and state = 'held';
  if lim is not null and sold_count + held_count + ticket_count > lim then
    raise exception 'Not enough tickets remain. Please choose another tier or a smaller quantity.' using errcode = 'P0001';
  end if;
  insert into public.event_ticket_reservations(id, event_id, tier_id, tickets)
    values (p_reservation_id, p_event_id, p_tier_id, ticket_count);
  return jsonb_build_object('event', to_jsonb(evt), 'tier', tier, 'tickets', ticket_count);
end $$;
revoke all on function public.reserve_event_tickets(text,text,integer,uuid) from public, anon, authenticated;
grant execute on function public.reserve_event_tickets(text,text,integer,uuid) to service_role;

-- All order writers (including admin edits and legacy checkout completions)
-- share the same event lock as reservations. Consuming a hold and recording a
-- paid order are one transaction; webhook redelivery cannot double-count stock.
create or replace function public.guard_event_ticket_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare evt public.events; tier jsonb; hold public.event_ticket_reservations;
  sold_count bigint; held_count bigint; lim integer;
begin
  if tg_op = 'UPDATE' and (old.event_id <> new.event_id or old.tier_id <> new.tier_id
      or old.tickets <> new.tickets or old.reservation_id is distinct from new.reservation_id) then
    raise exception 'Ticket inventory identity cannot be changed on an existing order';
  end if;
  select * into evt from public.events where id = new.event_id for update;
  if new.payment_status <> 'paid' then return new; end if;
  if tg_op = 'UPDATE' and old.payment_status = 'refunded' then
    raise exception 'Refunded tickets cannot be restored without a new stock reservation';
  end if;
  if new.reservation_id is not null then
    select * into hold from public.event_ticket_reservations where id = new.reservation_id for update;
    if hold.id is null or hold.event_id <> new.event_id or hold.tier_id <> new.tier_id
       or hold.tickets <> new.tickets or hold.state = 'released'
       or (hold.stripe_checkout_session_id is not null and hold.stripe_checkout_session_id <> new.stripe_checkout_session_id) then
      raise exception 'Ticket reservation does not match this order';
    end if;
    if hold.state = 'consumed' and not exists (
      select 1 from public.event_ticket_orders where reservation_id = hold.id
        and stripe_checkout_session_id = new.stripe_checkout_session_id
    ) then raise exception 'Ticket reservation has already been consumed'; end if;
    update public.event_ticket_reservations set state = 'consumed',
      stripe_checkout_session_id = new.stripe_checkout_session_id where id = hold.id;
    return new;
  end if;
  select value into tier from jsonb_array_elements(evt.ticket_tiers) where value->>'id' = new.tier_id;
  lim := (tier->>'quantityLimit')::integer;
  select coalesce(sum(tickets), 0) into sold_count from public.event_ticket_orders
    where event_id = new.event_id and tier_id = new.tier_id and payment_status = 'paid' and id <> new.id;
  select coalesce(sum(tickets), 0) into held_count from public.event_ticket_reservations
    where event_id = new.event_id and tier_id = new.tier_id and state = 'held';
  if lim is not null and sold_count + held_count + new.tickets > lim then
    raise exception 'Ticket quantity limit reached';
  end if;
  return new;
end $$;
drop trigger if exists guard_event_ticket_order on public.event_ticket_orders;
create trigger guard_event_ticket_order before insert or update on public.event_ticket_orders
  for each row execute function public.guard_event_ticket_order();

create or replace function public.release_event_ticket_reservation(p_reservation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare event_key text;
begin
  select event_id into event_key from public.event_ticket_reservations where id = p_reservation_id;
  perform 1 from public.events where id = event_key for update;
  update public.event_ticket_reservations set state = 'released'
    where id = p_reservation_id and state = 'held';
end $$;
revoke all on function public.release_event_ticket_reservation(uuid) from public, anon, authenticated;
grant execute on function public.release_event_ticket_reservation(uuid) to service_role;
notify pgrst, 'reload schema';
