-- Migration 018: one free AI resume preview per account; downloads only for
-- resumes covered by a PAID credit.
--
-- NOT APPLIED ANYWHERE by the commit that adds it.
--
-- NUMBERING: 016 is reserved by 016_payment_orders.sql (branch
-- claude/razorpay-checkout-foundation) and 017 by 017_job_recommendations.sql
-- (branch claude/ai-job-recommendations-phase-1). This migration touches
-- neither feature's objects. It REQUIRES 013 (generation idempotency) and 015
-- (beta plan type + grant_beta_credits) to be applied first; 014 (no browser
-- writes on resumes) is strongly recommended.
--
-- PRODUCT RULES (final):
--   * exactly ONE free AI resume generation per verified account;
--   * a free-generated resume can NEVER be downloaded as a PDF unless a PAID
--     credit is spent on it (an explicit, one-time "unlock");
--   * every AI generation consumes exactly one credit — including every
--     regeneration of the same resume or job description; the old "same JD
--     within 24 h is free" rule is gone. The ONLY no-cost generation is the
--     account's first successful verified free preview;
--   * that first successful generation ALWAYS uses the free preview credit,
--     even if the user already bought paid credits; every later generation
--     consumes a paid credit;
--   * a resume covered by a paid credit may be re-downloaded any number of
--     times without another charge.
--
-- HOW
--   1. The free allowance is the existing 'beta' user_plans row, now 1
--      credit (existing rows are capped; nobody loses a resume or a paid
--      credit, and nobody gets more than one unused free generation).
--   2. Credits are RESERVED BEFORE THE MODEL CALL (begin_resume_generation_v2)
--      under a per-user lock on user_plans. Two concurrent requests can never
--      both run a model call on the same credit — the second gets
--      payment_required with no AI call. The free preview credit is used
--      FIRST (so the first successful generation is always the free, non-
--      downloadable preview, even for a user who already bought credits);
--      paid credits after it. A failed attempt (model error, timeout, lease
--      expiry) releases its
--      reservation: the invariant is "at most one SUCCESSFUL free generation",
--      and never two free model calls at once.
--   3. resume_entitlements (server-only writes) records which resumes may be
--      downloaded and which paid plan covers them. Written by
--      complete_resume_generation_v2 when the reserved credit was paid, by
--      unlock_resume_download (spends one paid credit, idempotent), for the
--      creator account, and by a one-time backfill for resumes made under a
--      paid plan before this migration. A resume generated with the free
--      credit has no row and cannot be downloaded.
--
-- The 013 functions (begin/complete/fail_resume_generation) are left in place
-- so code deployed before this change keeps working during rollout; the new
-- code calls only the _v2 functions.
-- Rollback: supabase/rollback/018_free_preview_entitlement_down.sql.

-- ── 1. One free generation ─────────────────────────────────────────────────
update public.user_plans
   set resumes_allotted = greatest(1, coalesce(resumes_used, 0))
 where plan_type = 'beta'
   and resumes_allotted > greatest(1, coalesce(resumes_used, 0));

create or replace function public.grant_beta_credits(p_user_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user_id is null then
    raise exception 'grant_beta_credits: user id must not be null';
  end if;
  -- ONE free AI resume generation per account (migration 018).
  insert into public.user_plans (user_id, plan_type, resumes_allotted, resumes_used, purchased_at, expires_at, is_test)
  values (p_user_id, 'beta', 1, 0, now(), now() + interval '1 year', false)
  on conflict (user_id) where plan_type = 'beta' do nothing
  returning id into v_id;
  return v_id is not null;
end;
$$;
revoke execute on function public.grant_beta_credits(uuid) from public, anon, authenticated;
grant execute on function public.grant_beta_credits(uuid) to service_role;

-- ── 2. Download entitlements ───────────────────────────────────────────────
create table if not exists public.resume_entitlements (
  resume_id uuid primary key references public.resumes(id) on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  -- The paid plan whose credit covers this resume (null for creator/legacy
  -- rows whose plan was later deleted).
  plan_id uuid references public.user_plans(id) on delete set null,
  source text not null check (source in ('generation', 'unlock', 'creator', 'legacy')),
  created_at timestamptz not null default now()
);
create index if not exists resume_entitlements_user on public.resume_entitlements (user_id);

alter table public.resume_entitlements enable row level security;
revoke all on table public.resume_entitlements from public, anon, authenticated;
grant select, insert, update, delete on table public.resume_entitlements to service_role;
grant select on table public.resume_entitlements to authenticated;
drop policy if exists "Users view own resume entitlements" on public.resume_entitlements;
create policy "Users view own resume entitlements" on public.resume_entitlements
  for select using (auth.uid() = user_id);

-- Backfill: resumes created while their owner held a PAID (non-beta) plan
-- stay downloadable. Resumes made with the free allowance get no row.
insert into public.resume_entitlements (resume_id, user_id, plan_id, source)
select r.id, r.user_id,
       (select p.id from public.user_plans p
         where p.user_id = r.user_id and p.plan_type <> 'beta' and p.purchased_at <= r.created_at
         order by p.purchased_at desc limit 1),
       'legacy'
  from public.resumes r
 where exists (select 1 from public.user_plans p
                where p.user_id = r.user_id and p.plan_type <> 'beta' and p.purchased_at <= r.created_at)
on conflict (resume_id) do nothing;

-- ── 3. Reservations on generation attempts ─────────────────────────────────
alter table public.generation_requests
  add column if not exists reserved_plan_id uuid references public.user_plans(id) on delete set null;

-- Releases this attempt's reserved credit (caller holds the user's plan locks).
create or replace function public._release_generation_reservation(p_request_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_plan uuid;
begin
  select g.reserved_plan_id into v_plan from public.generation_requests g where g.id = p_request_id;
  if v_plan is not null then
    update public.user_plans p set resumes_used = greatest(0, coalesce(p.resumes_used, 0) - 1) where p.id = v_plan;
    update public.generation_requests g set reserved_plan_id = null, charged = false where g.id = p_request_id;
  end if;
end;
$$;

-- ── begin_resume_generation_v2 ─────────────────────────────────────────────
-- Called before the model. Outcomes:
--   started           this attempt holds the lock AND (if p_charge) a reserved credit;
--                     plan_type says which ('beta' = the free preview)
--   replay            this attempt already finished; resume_id is its resume
--   in_progress       this attempt, or an identical one, is running right now
--   key_reused        this request_key was used for a different request
--   payment_required  no credit left (free used, no paid credit); no model call
create or replace function public.begin_resume_generation_v2(
  p_user_id uuid,
  p_request_key uuid,
  p_fingerprint text,
  p_lease_seconds integer,
  p_charge boolean
)
returns table (outcome text, resume_id uuid, plan_type text)
language plpgsql
set search_path = ''
as $$
declare
  r public.generation_requests;
  v_id uuid;
  v_plan uuid;
  v_type text;
  x record;
begin
  if p_user_id is null or p_request_key is null or p_fingerprint is null or p_charge is null then
    raise exception 'begin_resume_generation_v2: arguments must not be null';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'begin_resume_generation_v2: lease must be 30-900 seconds';
  end if;

  -- Serialise everything that reserves or releases this user's credits.
  perform 1 from public.user_plans p where p.user_id = p_user_id for update;

  -- Housekeeping, for this user only: expired attempts give back their credit.
  for x in
    select g.id from public.generation_requests g
     where g.user_id = p_user_id and g.status = 'pending' and g.lease_expires_at < now()
     for update
  loop
    perform public._release_generation_reservation(x.id);
    update public.generation_requests g
       set status = 'failed', failure = 'lease_expired', completed_at = now()
     where g.id = x.id;
  end loop;
  delete from public.generation_requests g
   where g.user_id = p_user_id and g.status <> 'pending'
     and g.created_at < now() - interval '24 hours';

  select * into r from public.generation_requests g
   where g.user_id = p_user_id and g.request_key = p_request_key
   for update;

  if found then
    if r.fingerprint <> p_fingerprint then
      return query select 'key_reused'::text, null::uuid, null::text; return;
    end if;
    if r.status = 'completed' then
      return query select 'replay'::text, r.resume_id, null::text; return;
    end if;
    if r.status = 'pending' then
      return query select 'in_progress'::text, null::uuid, null::text; return;
    end if;
    -- A failed attempt may be retried under the same key (it holds no credit).
    begin
      update public.generation_requests g
         set status = 'pending', failure = null, completed_at = null,
             lease_expires_at = now() + make_interval(secs => p_lease_seconds)
       where g.id = r.id;
    exception when unique_violation then
      return query select 'in_progress'::text, null::uuid, null::text; return;
    end;
    v_id := r.id;
  else
    v_id := gen_random_uuid();
    begin
      insert into public.generation_requests (id, user_id, request_key, fingerprint, lease_expires_at)
      values (v_id, p_user_id, p_request_key, p_fingerprint, now() + make_interval(secs => p_lease_seconds));
    exception when unique_violation then
      return query select 'in_progress'::text, null::uuid, null::text; return;
    end;
  end if;

  if not p_charge then
    return query select 'started'::text, null::uuid, null::text; return;
  end if;

  -- Reserve one credit now, before any model call. The free preview credit
  -- FIRST — the account's first successful generation is always the free,
  -- non-downloadable preview, even if paid credits were bought before it —
  -- then paid credits (newest purchase first, as in 013).
  select p.id, p.plan_type into v_plan, v_type
    from public.user_plans p
   where p.user_id = p_user_id
     and p.expires_at > now()
     and coalesce(p.resumes_used, 0) < p.resumes_allotted
   order by (p.plan_type = 'beta') desc, p.purchased_at desc
   limit 1;
  if v_plan is null then
    update public.generation_requests g
       set status = 'failed', failure = 'credits_exhausted', completed_at = now()
     where g.id = v_id;
    return query select 'payment_required'::text, null::uuid, null::text; return;
  end if;
  update public.user_plans p set resumes_used = coalesce(p.resumes_used, 0) + 1 where p.id = v_plan;
  update public.generation_requests g set reserved_plan_id = v_plan, charged = true where g.id = v_id;
  return query select 'started'::text, null::uuid, v_type;
end;
$$;

-- ── complete_resume_generation_v2 ──────────────────────────────────────────
-- Saves the resume for an attempt that holds its reservation. No charge here
-- (the credit was reserved at begin). Grants a download entitlement only when
-- the reserved credit was a PAID one (or for the creator account).
-- Outcomes: completed | replay | expired | unknown_request
create or replace function public.complete_resume_generation_v2(
  p_user_id uuid,
  p_request_key uuid,
  p_resume jsonb,
  p_is_creator boolean
)
returns table (outcome text, resume_id uuid, entitled boolean)
language plpgsql
set search_path = ''
as $$
declare
  r public.generation_requests;
  v_parent uuid;
  v_resume uuid;
  v_type text;
  v_entitled boolean := false;
begin
  select * into r from public.generation_requests g
   where g.user_id = p_user_id and g.request_key = p_request_key
   for update;
  if not found then
    return query select 'unknown_request'::text, null::uuid, false; return;
  end if;
  if r.status = 'completed' then
    return query select 'replay'::text, r.resume_id,
      exists (select 1 from public.resume_entitlements e where e.resume_id = r.resume_id); return;
  end if;
  if r.status <> 'pending' then
    return query select 'expired'::text, null::uuid, false; return;
  end if;

  v_parent := nullif(p_resume->>'regen_of_resume_id', '')::uuid;
  if v_parent is not null and not exists (
    select 1 from public.resumes x where x.id = v_parent and x.user_id = p_user_id
  ) then
    v_parent := null;
  end if;

  insert into public.resumes (
    user_id, jd_text, resume_json, ats_score, tailored_role,
    matched_keywords, missing_keywords, contact_snapshot, template,
    regen_of_resume_id, generation_request_id
  ) values (
    p_user_id,
    p_resume->>'jd_text',
    p_resume->'resume_json',
    round((p_resume->>'ats_score')::numeric)::int,
    p_resume->>'tailored_role',
    array(select jsonb_array_elements_text(coalesce(p_resume->'matched_keywords', '[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(p_resume->'missing_keywords', '[]'::jsonb))),
    p_resume->'contact_snapshot',
    nullif(p_resume->>'template', ''),
    v_parent,
    r.id
  )
  returning id into v_resume;

  if r.reserved_plan_id is not null then
    select p.plan_type into v_type from public.user_plans p where p.id = r.reserved_plan_id;
    if v_type is distinct from 'beta' then
      insert into public.resume_entitlements (resume_id, user_id, plan_id, source)
      values (v_resume, p_user_id, r.reserved_plan_id, 'generation');
      v_entitled := true;
    end if;
  elsif coalesce(p_is_creator, false) then
    insert into public.resume_entitlements (resume_id, user_id, plan_id, source)
    values (v_resume, p_user_id, null, 'creator');
    v_entitled := true;
  end if;

  update public.generation_requests g
     set status = 'completed', resume_id = v_resume, completed_at = now()
   where g.id = r.id;
  return query select 'completed'::text, v_resume, v_entitled;
end;
$$;

-- ── fail_resume_generation_v2 ──────────────────────────────────────────────
-- Releases the lock AND the reserved credit when the model call or parsing
-- fails. Nothing was saved, so nothing is charged.
create or replace function public.fail_resume_generation_v2(p_user_id uuid, p_request_key uuid, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform 1 from public.user_plans p where p.user_id = p_user_id for update;
  select g.id into v_id from public.generation_requests g
   where g.user_id = p_user_id and g.request_key = p_request_key and g.status = 'pending'
   for update;
  if v_id is null then return; end if;
  perform public._release_generation_reservation(v_id);
  update public.generation_requests g
     set status = 'failed', failure = left(coalesce(p_reason, 'failed'), 200), completed_at = now()
   where g.id = v_id;
end;
$$;

-- ── unlock_resume_download ─────────────────────────────────────────────────
-- Spends ONE paid credit to make a resume downloadable — once. Outcomes:
--   unlocked          a paid credit was spent; plan_id says which
--   already_entitled  nothing spent (repeat downloads are free)
--   not_found         not this user's resume
--   payment_required  no paid credit (the free preview credit never unlocks)
create or replace function public.unlock_resume_download(p_user_id uuid, p_resume_id uuid)
returns table (outcome text, plan_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_plan uuid;
begin
  if p_user_id is null or p_resume_id is null then
    raise exception 'unlock_resume_download: arguments must not be null';
  end if;
  perform 1 from public.user_plans p where p.user_id = p_user_id for update;
  perform 1 from public.resumes x where x.id = p_resume_id and x.user_id = p_user_id for update;
  if not found then
    return query select 'not_found'::text, null::uuid; return;
  end if;
  if exists (select 1 from public.resume_entitlements e where e.resume_id = p_resume_id) then
    return query select 'already_entitled'::text, null::uuid; return;
  end if;
  select p.id into v_plan
    from public.user_plans p
   where p.user_id = p_user_id
     and p.plan_type <> 'beta'
     and p.expires_at > now()
     and coalesce(p.resumes_used, 0) < p.resumes_allotted
   order by p.purchased_at desc
   limit 1;
  if v_plan is null then
    return query select 'payment_required'::text, null::uuid; return;
  end if;
  update public.user_plans p set resumes_used = coalesce(p.resumes_used, 0) + 1 where p.id = v_plan;
  insert into public.resume_entitlements (resume_id, user_id, plan_id, source)
  values (p_resume_id, p_user_id, v_plan, 'unlock');
  return query select 'unlocked'::text, v_plan;
end;
$$;

-- Server only.
revoke execute on function public._release_generation_reservation(uuid) from public, anon, authenticated;
revoke execute on function public.begin_resume_generation_v2(uuid, uuid, text, integer, boolean) from public, anon, authenticated;
revoke execute on function public.complete_resume_generation_v2(uuid, uuid, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.fail_resume_generation_v2(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.unlock_resume_download(uuid, uuid) from public, anon, authenticated;
grant execute on function public._release_generation_reservation(uuid) to service_role;
grant execute on function public.begin_resume_generation_v2(uuid, uuid, text, integer, boolean) to service_role;
grant execute on function public.complete_resume_generation_v2(uuid, uuid, jsonb, boolean) to service_role;
grant execute on function public.fail_resume_generation_v2(uuid, uuid, text) to service_role;
grant execute on function public.unlock_resume_download(uuid, uuid) to service_role;
