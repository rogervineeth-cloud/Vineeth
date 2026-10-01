-- Migration 016: Razorpay Standard Checkout — orders, webhook events,
-- refunds, and one-time atomic fulfilment into the existing credit tables.
--
-- NOT APPLIED ANYWHERE by the commit that adds it. Payments stay off until
-- PAYMENTS_ENABLED and keys are configured (docs/payments/LAUNCH_REQUIREMENTS.md).
--
-- NUMBERING: branch claude/ai-job-recommendations-phase-1 also carries a
-- 016_job_recommendations.sql. The two touch no common objects; whichever
-- merges second must be renumbered to 017 (see the launch requirements).
--
-- WHAT IS SOLD (lib/plan-config.ts PLANS / ADDONS):
--   single ₹99 / 1 resume · fresher ₹249 / 5 · job_hunter ₹599 / 12 ·
--   career ₹999 / 25 · linkedin_rewrite ₹499 standalone, ₹399 bundled with
--   any pack. Prices live in payment_sku_price_paise() below and are enforced
--   by a CHECK on every order row: the browser never supplies an amount.
--
-- GUARANTEES
--   * one order per checkout attempt ... UNIQUE (user_id, client_request_key);
--     a retried or double-clicked purchase gets the same order back.
--   * one grant per paid order ......... fulfil_payment_order() locks the
--     order row; user_plans.payment_order_id and (user_addons.payment_order_id,
--     addon_id) are UNIQUE, so even a bug could not grant twice. The checkout
--     callback (/api/payments/verify) and the webhook both call it; whichever
--     is second gets 'already_fulfilled'.
--   * one payment per order ............ razorpay_payment_id is UNIQUE; a
--     second captured payment on a fulfilled order is flagged, not granted.
--   * amount/currency must match the order row, or nothing is granted.
--   * webhook de-duplication ........... payment_events.razorpay_event_id is
--     UNIQUE; an event is skipped only after it was fully processed, so a
--     failed attempt is retried.
--   * no browser writes ................ RLS on, all writes by service_role
--     through the functions below; users may only read their own orders.
--
-- Credits bought here are ordinary user_plans rows (plan_type = the pack,
-- expires 1 year after purchase — "1-year validity"), charged by migration
-- 013's complete_resume_generation like any other plan. A bundled or
-- standalone LinkedIn Rewrite is an ordinary user_addons row.
--
-- REFUNDS are recorded (payment_refunds, order status) but DO NOT revoke
-- credits or add-ons automatically: the refund policy for partly used packs
-- is an open business decision (docs/payments/LAUNCH_REQUIREMENTS.md).
--
-- Rollback: supabase/rollback/016_payment_orders_down.sql (refuses while any
-- order exists — these are financial records).

-- ── Catalogue (single source in SQL; mirrored from lib/plan-config.ts and
--    checked against it by __tests__/payments-catalog.test.ts) ───────────────
create or replace function public.payment_sku_price_paise(p_sku text, p_with_addon boolean)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v integer;
begin
  v := case p_sku
         when 'single' then 9900
         when 'fresher' then 24900
         when 'job_hunter' then 59900
         when 'career' then 99900
         when 'linkedin_rewrite' then 49900
       end;
  if v is null then
    raise exception 'payment_sku_price_paise: unknown sku %', p_sku;
  end if;
  if coalesce(p_with_addon, false) then
    if p_sku = 'linkedin_rewrite' then
      raise exception 'payment_sku_price_paise: linkedin_rewrite cannot be bundled with itself';
    end if;
    v := v + 39900;
  end if;
  return v;
end;
$$;

create or replace function public.payment_sku_credits(p_sku text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_sku
           when 'single' then 1
           when 'fresher' then 5
           when 'job_hunter' then 12
           when 'career' then 25
           else 0
         end
$$;

-- ── Tables ─────────────────────────────────────────────────────────────────
create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  -- Kept (set null) if the account is deleted: these are financial records.
  user_id uuid references auth.users on delete set null,
  client_request_key uuid not null,
  sku text not null check (sku in ('single', 'fresher', 'job_hunter', 'career', 'linkedin_rewrite')),
  with_linkedin_addon boolean not null default false,
  amount_paise integer not null,
  currency text not null default 'INR' check (currency = 'INR'),
  mode text not null check (mode in ('test', 'live')),
  receipt text not null unique check (char_length(receipt) <= 40),
  razorpay_order_id text unique,
  razorpay_payment_id text unique,
  status text not null default 'created'
    check (status in ('created', 'fulfilled', 'refunded', 'partially_refunded', 'needs_review')),
  fulfilled_via text check (fulfilled_via in ('verify', 'webhook', 'reconcile')),
  last_payment_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  constraint payment_orders_user_request_key unique (user_id, client_request_key),
  constraint payment_orders_no_self_bundle check (not (sku = 'linkedin_rewrite' and with_linkedin_addon)),
  -- The amount is always the server's price for this SKU/bundle.
  constraint payment_orders_server_price check (amount_paise = public.payment_sku_price_paise(sku, with_linkedin_addon))
);

create index if not exists payment_orders_user_created on public.payment_orders (user_id, created_at desc);

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  razorpay_event_id text not null unique,
  event text not null,
  razorpay_order_id text,
  payload jsonb not null,
  attempts integer not null default 1,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_order_id uuid not null references public.payment_orders(id) on delete restrict,
  razorpay_refund_id text not null unique,
  razorpay_payment_id text not null,
  amount_paise integer not null check (amount_paise > 0),
  status text not null check (status in ('created', 'processed', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Links from the existing entitlement tables to the order that paid for them.
alter table public.user_plans
  add column if not exists payment_order_id uuid references public.payment_orders(id) on delete restrict;
create unique index if not exists user_plans_payment_order_id_key
  on public.user_plans (payment_order_id) where payment_order_id is not null;

alter table public.user_addons
  add column if not exists payment_order_id uuid references public.payment_orders(id) on delete restrict;
create unique index if not exists user_addons_payment_order_addon_key
  on public.user_addons (payment_order_id, addon_id) where payment_order_id is not null;

-- ── Access: server only; users may read their own orders ──────────────────
alter table public.payment_orders enable row level security;
alter table public.payment_events enable row level security;
alter table public.payment_refunds enable row level security;

revoke all on table public.payment_orders from public, anon, authenticated;
revoke all on table public.payment_events from public, anon, authenticated;
revoke all on table public.payment_refunds from public, anon, authenticated;
grant select, insert, update, delete on table public.payment_orders to service_role;
grant select, insert, update, delete on table public.payment_events to service_role;
grant select, insert, update, delete on table public.payment_refunds to service_role;

grant select on table public.payment_orders to authenticated;
drop policy if exists "Users view own payment orders" on public.payment_orders;
create policy "Users view own payment orders" on public.payment_orders
  for select using (auth.uid() = user_id);

-- ── create_payment_order ───────────────────────────────────────────────────
-- Outcomes: created | existing (same attempt, same purchase) |
--           key_reused (same request key, different purchase).
-- The amount is computed here; the caller passes only the SKU and bundle flag.
create or replace function public.create_payment_order(
  p_user_id uuid,
  p_client_request_key uuid,
  p_sku text,
  p_with_addon boolean,
  p_mode text
)
returns table (outcome text, payment_order_id uuid, razorpay_order_id text, amount_paise integer,
               currency text, receipt text, status text)
language plpgsql
set search_path = ''
as $$
declare
  r public.payment_orders;
  v_id uuid;
begin
  if p_user_id is null or p_client_request_key is null or p_sku is null or p_mode is null then
    raise exception 'create_payment_order: arguments must not be null';
  end if;

  select * into r from public.payment_orders o
   where o.user_id = p_user_id and o.client_request_key = p_client_request_key;
  if not found then
    v_id := gen_random_uuid();
    begin
      insert into public.payment_orders (id, user_id, client_request_key, sku, with_linkedin_addon,
                                         amount_paise, mode, receipt)
      values (v_id, p_user_id, p_client_request_key, p_sku, coalesce(p_with_addon, false),
              public.payment_sku_price_paise(p_sku, coalesce(p_with_addon, false)), p_mode, v_id::text);
      select * into r from public.payment_orders o where o.id = v_id;
      return query select 'created'::text, r.id, r.razorpay_order_id, r.amount_paise, r.currency, r.receipt, r.status;
      return;
    exception when unique_violation then
      -- The same attempt raced itself; read the winner.
      select * into r from public.payment_orders o
       where o.user_id = p_user_id and o.client_request_key = p_client_request_key;
    end;
  end if;

  if r.sku <> p_sku or r.with_linkedin_addon <> coalesce(p_with_addon, false) or r.mode <> p_mode then
    return query select 'key_reused'::text, null::uuid, null::text, null::integer, null::text, null::text, null::text;
    return;
  end if;
  return query select 'existing'::text, r.id, r.razorpay_order_id, r.amount_paise, r.currency, r.receipt, r.status;
end;
$$;

-- ── attach_razorpay_order ──────────────────────────────────────────────────
-- Stores the Razorpay order id once. If two concurrent requests both created
-- a Razorpay order for the same attempt, the first stored one wins and is
-- returned to both (the other Razorpay order is never paid).
create or replace function public.attach_razorpay_order(p_payment_order_id uuid, p_razorpay_order_id text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v text;
begin
  update public.payment_orders o
     set razorpay_order_id = p_razorpay_order_id, updated_at = now()
   where o.id = p_payment_order_id and o.razorpay_order_id is null;
  select o.razorpay_order_id into v from public.payment_orders o where o.id = p_payment_order_id;
  if v is null then
    raise exception 'attach_razorpay_order: unknown order %', p_payment_order_id;
  end if;
  return v;
end;
$$;

-- ── fulfil_payment_order ───────────────────────────────────────────────────
-- Called only after the server has verified the payment (checkout signature
-- + Razorpay payment fetch, or a signed webhook). Grants exactly once.
-- Outcomes: fulfilled | already_fulfilled | unknown_order | amount_mismatch |
--           currency_mismatch | different_payment | needs_review
create or replace function public.fulfil_payment_order(
  p_razorpay_order_id text,
  p_razorpay_payment_id text,
  p_amount_paise integer,
  p_currency text,
  p_source text
)
returns table (outcome text, payment_order_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  r public.payment_orders;
begin
  if p_razorpay_order_id is null or p_razorpay_payment_id is null or p_source not in ('verify', 'webhook', 'reconcile') then
    raise exception 'fulfil_payment_order: invalid arguments';
  end if;

  select * into r from public.payment_orders o where o.razorpay_order_id = p_razorpay_order_id for update;
  if not found then
    return query select 'unknown_order'::text, null::uuid; return;
  end if;

  if r.razorpay_payment_id is not null then
    if r.razorpay_payment_id = p_razorpay_payment_id then
      return query select 'already_fulfilled'::text, r.id; return;
    end if;
    -- A second captured payment for an order that is already paid: never
    -- granted again; needs a manual refund.
    update public.payment_orders o
       set last_payment_error = left('second payment ' || p_razorpay_payment_id || ' on fulfilled order', 200), updated_at = now()
     where o.id = r.id;
    return query select 'different_payment'::text, r.id; return;
  end if;

  if p_amount_paise is distinct from r.amount_paise then
    update public.payment_orders o set last_payment_error = 'amount mismatch', updated_at = now() where o.id = r.id;
    return query select 'amount_mismatch'::text, r.id; return;
  end if;
  if p_currency is distinct from r.currency then
    update public.payment_orders o set last_payment_error = 'currency mismatch', updated_at = now() where o.id = r.id;
    return query select 'currency_mismatch'::text, r.id; return;
  end if;
  if r.user_id is null or r.status <> 'created' then
    update public.payment_orders o
       set status = 'needs_review', razorpay_payment_id = p_razorpay_payment_id,
           last_payment_error = 'paid but not grantable (account deleted or order not open)', updated_at = now()
     where o.id = r.id;
    return query select 'needs_review'::text, r.id; return;
  end if;

  if r.sku in ('single', 'fresher', 'job_hunter', 'career') then
    insert into public.user_plans (user_id, plan_type, resumes_allotted, resumes_used, purchased_at,
                                   expires_at, razorpay_payment_id, is_test, payment_order_id)
    values (r.user_id, r.sku, public.payment_sku_credits(r.sku), 0, now(),
            now() + interval '1 year', p_razorpay_payment_id, r.mode = 'test', r.id);
  end if;
  if r.sku = 'linkedin_rewrite' or r.with_linkedin_addon then
    insert into public.user_addons (user_id, addon_id, is_test, payment_order_id)
    values (r.user_id, 'linkedin_rewrite', r.mode = 'test', r.id);
  end if;

  update public.payment_orders o
     set status = 'fulfilled', razorpay_payment_id = p_razorpay_payment_id, fulfilled_via = p_source,
         fulfilled_at = now(), last_payment_error = null, updated_at = now()
   where o.id = r.id;
  return query select 'fulfilled'::text, r.id;
end;
$$;

-- ── record_payment_failure ─────────────────────────────────────────────────
-- A failed attempt does not close the order (the buyer may retry within it).
create or replace function public.record_payment_failure(p_razorpay_order_id text, p_error text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.payment_orders o
     set last_payment_error = left(coalesce(p_error, 'payment failed'), 200), updated_at = now()
   where o.razorpay_order_id = p_razorpay_order_id and o.status = 'created';
end;
$$;

-- ── Webhook events ─────────────────────────────────────────────────────────
-- Returns: new | retry (seen but not processed: process again) | duplicate.
create or replace function public.record_payment_event(
  p_razorpay_event_id text, p_event text, p_razorpay_order_id text, p_payload jsonb
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_processed timestamptz;
begin
  insert into public.payment_events (razorpay_event_id, event, razorpay_order_id, payload)
  values (p_razorpay_event_id, p_event, p_razorpay_order_id, p_payload)
  on conflict (razorpay_event_id) do nothing;
  if found then return 'new'; end if;

  select e.processed_at into v_processed from public.payment_events e
   where e.razorpay_event_id = p_razorpay_event_id for update;
  if v_processed is not null then return 'duplicate'; end if;
  update public.payment_events e set attempts = e.attempts + 1 where e.razorpay_event_id = p_razorpay_event_id;
  return 'retry';
end;
$$;

create or replace function public.mark_payment_event_processed(p_razorpay_event_id text)
returns void
language sql
set search_path = ''
as $$
  update public.payment_events set processed_at = now()
   where razorpay_event_id = p_razorpay_event_id and processed_at is null;
$$;

-- ── Refunds: recorded, no automatic revocation (policy pending) ────────────
-- Returns: recorded | unknown_payment
create or replace function public.record_payment_refund(
  p_razorpay_refund_id text, p_razorpay_payment_id text, p_amount_paise integer, p_status text
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  r public.payment_orders;
  v_refunded integer;
begin
  select * into r from public.payment_orders o where o.razorpay_payment_id = p_razorpay_payment_id for update;
  if not found then return 'unknown_payment'; end if;

  insert into public.payment_refunds (payment_order_id, razorpay_refund_id, razorpay_payment_id, amount_paise, status)
  values (r.id, p_razorpay_refund_id, p_razorpay_payment_id, p_amount_paise, p_status)
  on conflict (razorpay_refund_id) do update set status = excluded.status, updated_at = now();

  select coalesce(sum(f.amount_paise), 0) into v_refunded from public.payment_refunds f
   where f.payment_order_id = r.id and f.status = 'processed';
  if v_refunded >= r.amount_paise then
    update public.payment_orders o set status = 'refunded', updated_at = now() where o.id = r.id;
  elsif v_refunded > 0 then
    update public.payment_orders o set status = 'partially_refunded', updated_at = now() where o.id = r.id;
  end if;
  return 'recorded';
end;
$$;

-- Server only.
revoke execute on function public.payment_sku_price_paise(text, boolean) from public, anon, authenticated;
revoke execute on function public.payment_sku_credits(text) from public, anon, authenticated;
revoke execute on function public.create_payment_order(uuid, uuid, text, boolean, text) from public, anon, authenticated;
revoke execute on function public.attach_razorpay_order(uuid, text) from public, anon, authenticated;
revoke execute on function public.fulfil_payment_order(text, text, integer, text, text) from public, anon, authenticated;
revoke execute on function public.record_payment_failure(text, text) from public, anon, authenticated;
revoke execute on function public.record_payment_event(text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.mark_payment_event_processed(text) from public, anon, authenticated;
revoke execute on function public.record_payment_refund(text, text, integer, text) from public, anon, authenticated;
grant execute on function public.payment_sku_price_paise(text, boolean) to service_role;
grant execute on function public.payment_sku_credits(text) to service_role;
grant execute on function public.create_payment_order(uuid, uuid, text, boolean, text) to service_role;
grant execute on function public.attach_razorpay_order(uuid, text) to service_role;
grant execute on function public.fulfil_payment_order(text, text, integer, text, text) to service_role;
grant execute on function public.record_payment_failure(text, text) to service_role;
grant execute on function public.record_payment_event(text, text, text, jsonb) to service_role;
grant execute on function public.mark_payment_event_processed(text) to service_role;
grant execute on function public.record_payment_refund(text, text, integer, text) to service_role;
