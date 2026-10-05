import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const databaseUrl = process.env.TEST_DATABASE_URL
function sql(query) {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', [databaseUrl, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''; let errors = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { errors += chunk })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve(output.trim()) : reject(new Error(errors.trim())))
    child.stdin.end(query)
  })
}
const json = async (query) => JSON.parse(await sql(query))
const reserve = (id, quantity = 1, event = 'limited', tier = 'general') =>
  sql(`select public.reserve_event_tickets('${event}', '${tier}', ${quantity}, '${id}');`)
const stock = (event = 'limited') => json(`select row_to_json(s) from public.event_ticket_stock(array['${event}']) s;`)
const pay = (id, session) => sql(`insert into public.event_ticket_orders
  (id,event_id,tier_id,tickets,payment_status,stripe_checkout_session_id,reservation_id)
  select '${session}',event_id,tier_id,tickets,'paid','${session}',id from public.event_ticket_reservations where id='${id}';`)

test('atomic inventory migration against isolated PostgreSQL', { skip: !databaseUrl }, async (t) => {
  assert.equal(new URL(databaseUrl).pathname, '/kada_ticket_inventory_test', 'Use only the disposable test database')
  await sql(`
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
    end $$;
    drop table if exists public.event_ticket_orders, public.event_ticket_reservations, public.events cascade;
    create table public.events(id text primary key, status text, ticketing_enabled boolean, ticket_tiers jsonb);
    create table public.event_ticket_orders(id text primary key, event_id text references public.events(id),
      tier_id text, tickets integer, payment_status text, stripe_checkout_session_id text unique);
    create or replace function public.current_user_has_permission(text) returns boolean language sql as $$ select false $$;
  `)
  const migration = await readFile(new URL('../supabase/migrations/20261005_event_ticket_inventory.sql', import.meta.url), 'utf8')
  await sql(migration)
  await sql(migration)
  await sql(`insert into public.events values
    ('limited','published',true,'[{"id":"general","bundleSize":1,"quantityLimit":3}]'),
    ('unlimited','published',true,'[{"id":"general","bundleSize":1}]'),
    ('bundle','published',true,'[{"id":"general","bundleSize":2,"quantityLimit":3}]'),
    ('draft','draft',true,'[{"id":"general","bundleSize":1}]');`)

  await t.test('two paid tickets leave exactly one; holds are distinct from sales', async () => {
    const id = randomUUID()
    await reserve(id, 2)
    assert.equal((await stock()).sold, 0)
    assert.equal((await stock()).reserved, 2)
    await pay(id, 'first')
    assert.equal((await stock()).sold, 2)
    assert.equal((await stock()).remaining, 1)
    assert.equal((await stock()).available, 1)
    assert.equal((await stock()).reserved, 0)
  })
  let lastId
  await t.test('two concurrent attempts for the last ticket yield exactly one winner', async () => {
    const ids = [randomUUID(), randomUUID()]
    const results = await Promise.allSettled(ids.map((id) => reserve(id)))
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    assert.match(results.find((r) => r.status === 'rejected').reason.message, /Not enough tickets/)
    lastId = ids[results.findIndex((r) => r.status === 'fulfilled')]
    assert.equal((await stock()).available, 0)
    assert.equal((await stock()).sold, 2)
  })
  await t.test('third paid ticket sells out and duplicate delivery does not add stock', async () => {
    await pay(lastId, 'last')
    const counts = await stock()
    assert.equal(counts.sold, 3)
    assert.equal(counts.remaining, 0)
    assert.equal(counts.sold_out, true)
    await assert.rejects(reserve(randomUUID()), /Not enough tickets/)
    await sql(`insert into public.event_ticket_orders
      select * from public.event_ticket_orders where id='last' on conflict(stripe_checkout_session_id) do nothing;`)
    assert.equal((await stock()).sold, 3)
  })
  await t.test('refunds return stock and cannot be resurrected by an update', async () => {
    await sql(`update public.event_ticket_orders set payment_status='refunded' where id='last';`)
    assert.equal((await stock()).available, 1)
    await assert.rejects(sql(`update public.event_ticket_orders set payment_status='paid' where id='last';`), /Refunded tickets/)
  })
  await t.test('manual sold-out works independently on unlimited stock, then can be removed', async () => {
    await sql(`update public.events set ticket_tiers='[{"id":"general","soldOut":true}]' where id='unlimited';`)
    assert.equal((await stock('unlimited')).sold, 0)
    assert.equal((await stock('unlimited')).sold_out, true)
    await assert.rejects(reserve(randomUUID(), 1, 'unlimited'), /sold out/)
    await sql(`update public.events set ticket_tiers='[{"id":"general","bundleSize":1}]' where id='unlimited';`)
    await reserve(randomUUID(), 20, 'unlimited')
    assert.equal((await stock('unlimited')).quantity_limit, null)
  })
  await t.test('bundles count seats, expiry releases holds, released holds cannot be paid', async () => {
    const id = randomUUID()
    await assert.rejects(reserve(randomUUID(), 2, 'bundle'), /Not enough tickets/)
    await reserve(id, 1, 'bundle')
    assert.equal((await stock('bundle')).available, 1)
    await sql(`select public.release_event_ticket_reservation('${id}');`)
    assert.equal((await stock('bundle')).available, 3)
    await assert.rejects(pay(id, 'expired'), /does not match/)
  })
  await t.test('legacy writers cannot bypass the cap and reservation identities cannot change', async () => {
    await assert.rejects(sql(`insert into public.event_ticket_orders
      values ('bypass','limited','general',2,'paid','bypass',null);`), /quantity limit/)
    await assert.rejects(sql(`update public.event_ticket_orders set tickets=99 where id='first';`), /identity cannot/)
  })
  await t.test('drafts and invalid quantities are rejected; public RPC exposes no buyer data', async () => {
    await assert.rejects(reserve(randomUUID(), 1, 'draft'), /not on sale/)
    await assert.rejects(reserve(randomUUID(), 0, 'unlimited'), /between 1 and 20/)
    assert.equal(await sql(`select count(*) from public.event_ticket_stock(array['draft']);`), '0')
    assert.equal(await sql(`select has_function_privilege('anon','public.reserve_event_tickets(text,text,integer,uuid)','execute');`), 'f')
    assert.equal(await sql(`select has_function_privilege('anon','public.event_ticket_stock(text[])','execute');`), 't')
  })
  await t.test('invalid limits and duplicate tier IDs are rejected', async () => {
    for (const tiers of [
      '[{"id":"general","quantityLimit":-1}]', '[{"id":"general","quantityLimit":1.5}]',
      '[{"id":"general","quantityLimit":"3"}]', '[{"id":"general","lowStockThreshold":-1}]',
      '[{"id":"general"},{"id":"general"}]',
    ]) await assert.rejects(sql(`update public.events set ticket_tiers='${tiers}' where id='unlimited';`))
  })
})
