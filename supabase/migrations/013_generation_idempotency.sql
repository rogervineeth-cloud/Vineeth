-- Migration 013: server-side idempotency for resume generation.
--
-- THE PROBLEM
--
-- Generation was two independent writes with nothing tying them together:
--   1. /api/generate-resume called the model, then consumeCredit() (one
--      UPDATE on user_plans);
--   2. the BROWSER then inserted the row into public.resumes.
-- Two tabs (or two devices, or a double click before the button disabled)
-- that pressed Generate for the same job description each ran both steps:
-- two credits and two resumes for one intent. A lost response followed by a
-- retry did the same. A client-side lock only protects one tab.
--
-- THE FIX
--
-- Every generation attempt carries a client-generated request_key (a UUID,
-- reused only when the identical request is retried). The server records the
-- attempt here before calling the model, and finishes it in ONE transaction
-- that charges the credit, inserts the resume and marks the attempt complete.
--
--   * one attempt, one outcome ... UNIQUE (user_id, request_key); a retry of
--     a finished attempt gets the same resume back and is not charged again.
--   * one identical generation in flight per user ... a partial UNIQUE index
--     on (user_id, fingerprint) WHERE status = 'pending'. A second tab asking
--     for the same thing while the first is running is refused (no model
--     call, no charge). Once the first finishes, a deliberate new generation
--     for the same JD is allowed as before.
--   * one attempt, at most one resume ... resumes.generation_request_id is
--     UNIQUE, so even a bug that completed an attempt twice could not store
--     two rows for it.
--   * no overdraft ... the charge locks the user's plan rows, so concurrent
--     completions for DIFFERENT requests cannot spend the same credit twice.
--
-- Abandoned attempts (the function died mid-request) hold their lock only
-- for a lease (default 150 s; the route's maxDuration is 60 s), after which
-- they are marked failed. Settled attempts are deleted after 24 h. Both are
-- done per user inside begin_resume_generation, so no scheduler is needed.
--
-- BACKWARD COMPATIBLE
--
-- Only additions: a new table, a nullable column on resumes, three
-- functions. Nothing existing is altered or dropped, and the browser's
-- INSERT policy on resumes is untouched, so the currently deployed code keeps
-- working after this migration is applied. Apply it BEFORE deploying the code
-- that calls these functions. Rollback: supabase/rollback/013_generation_idempotency_down.sql.
--
-- ACCESS
--
-- Only the server (service_role) may touch the table or call the functions.
-- anon/authenticated have no table privileges, no policies and no EXECUTE:
-- a user must not be able to mark their own attempt "completed" or insert a
-- resume without being charged.

create table if not exists public.generation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  request_key uuid not null,
  -- sha256 hex of the normalised request (JD, template, keywords, profile,
  -- regeneration parent), computed by the server — never by the client.
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed')),
  resume_id uuid references public.resumes(id) on delete set null,
  charged boolean not null default false,
  failure text,
  created_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  completed_at timestamptz,
  constraint generation_requests_user_request_key unique (user_id, request_key)
);

create unique index if not exists generation_requests_one_pending_per_fingerprint
  on public.generation_requests (user_id, fingerprint)
  where status = 'pending';

create index if not exists generation_requests_user_created
  on public.generation_requests (user_id, created_at);

alter table public.generation_requests enable row level security;
-- No policies: anon/authenticated can never read or write it.
revoke all on table public.generation_requests from public, anon, authenticated;
grant select, insert, update, delete on table public.generation_requests to service_role;

comment on table public.generation_requests is
  'One row per resume-generation attempt. Server-only (service_role). Guarantees one charge and one resume per attempt, and one identical generation in flight per user. See migration 013.';

-- Which attempt produced a resume. NULL for rows created before 013 and for
-- rows the old browser flow inserts during rollout. UNIQUE allows many NULLs.
alter table public.resumes
  add column if not exists generation_request_id uuid
  references public.generation_requests(id) on delete set null;

create unique index if not exists resumes_generation_request_id_key
  on public.resumes (generation_request_id)
  where generation_request_id is not null;

-- ── begin_resume_generation ────────────────────────────────────────────────
-- Called before the model. Outcomes:
--   started      this attempt now holds the lock; go ahead
--   replay       this attempt already finished; resume_id is its resume
--   in_progress  this attempt, or an identical one, is running right now
--   key_reused   this request_key was used for a DIFFERENT request
create or replace function public.begin_resume_generation(
  p_user_id uuid,
  p_request_key uuid,
  p_fingerprint text,
  p_lease_seconds integer default 150
)
returns table (outcome text, resume_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  r public.generation_requests;
begin
  if p_user_id is null or p_request_key is null or p_fingerprint is null then
    raise exception 'begin_resume_generation: arguments must not be null';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'begin_resume_generation: lease must be 30-900 seconds';
  end if;

  -- Housekeeping, for this user only.
  update public.generation_requests g
     set status = 'failed', failure = 'lease_expired', completed_at = now()
   where g.user_id = p_user_id and g.status = 'pending' and g.lease_expires_at < now();
  delete from public.generation_requests g
   where g.user_id = p_user_id and g.status <> 'pending'
     and g.created_at < now() - interval '24 hours';

  select * into r
    from public.generation_requests g
   where g.user_id = p_user_id and g.request_key = p_request_key
   for update;

  if found then
    if r.fingerprint <> p_fingerprint then
      return query select 'key_reused'::text, null::uuid; return;
    end if;
    if r.status = 'completed' then
      return query select 'replay'::text, r.resume_id; return;
    end if;
    if r.status = 'pending' then
      return query select 'in_progress'::text, null::uuid; return;
    end if;
    -- A failed attempt may be retried under the same key.
    begin
      update public.generation_requests g
         set status = 'pending', failure = null, completed_at = null,
             lease_expires_at = now() + make_interval(secs => p_lease_seconds)
       where g.id = r.id;
    exception when unique_violation then
      return query select 'in_progress'::text, null::uuid; return;
    end;
    return query select 'started'::text, null::uuid; return;
  end if;

  begin
    insert into public.generation_requests (user_id, request_key, fingerprint, lease_expires_at)
    values (p_user_id, p_request_key, p_fingerprint, now() + make_interval(secs => p_lease_seconds));
  exception when unique_violation then
    -- The same key raced itself, or an identical generation is pending.
    return query select 'in_progress'::text, null::uuid; return;
  end;
  return query select 'started'::text, null::uuid;
end;
$$;

-- ── complete_resume_generation ─────────────────────────────────────────────
-- Called after a successful model reply. One transaction: charge (unless
-- p_charge is false: creator or free regeneration), insert the resume, mark
-- the attempt completed. Outcomes:
--   completed         resume_id is the new resume
--   replay            already completed; resume_id is its resume (no charge)
--   payment_required  no active plan with a credit left; nothing written
--   expired           the attempt is no longer pending; nothing written
--   unknown_request   begin was never called for this key
create or replace function public.complete_resume_generation(
  p_user_id uuid,
  p_request_key uuid,
  p_charge boolean,
  p_resume jsonb
)
returns table (outcome text, resume_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  r public.generation_requests;
  v_plan uuid;
  v_parent uuid;
  v_resume uuid;
begin
  select * into r
    from public.generation_requests g
   where g.user_id = p_user_id and g.request_key = p_request_key
   for update;

  if not found then
    return query select 'unknown_request'::text, null::uuid; return;
  end if;
  if r.status = 'completed' then
    return query select 'replay'::text, r.resume_id; return;
  end if;
  if r.status <> 'pending' then
    return query select 'expired'::text, null::uuid; return;
  end if;

  if p_charge then
    -- Serialise this user's charges: lock every plan row first, then pick the
    -- plan the app treats as active (lib/plans.ts getUserActivePlan: newest
    -- purchase, not expired, with a credit left).
    perform 1 from public.user_plans p where p.user_id = p_user_id for update;
    select p.id into v_plan
      from public.user_plans p
     where p.user_id = p_user_id
       and p.expires_at > now()
       and coalesce(p.resumes_used, 0) < p.resumes_allotted
     order by p.purchased_at desc
     limit 1;
    if v_plan is null then
      update public.generation_requests g
         set status = 'failed', failure = 'credits_exhausted', completed_at = now()
       where g.id = r.id;
      return query select 'payment_required'::text, null::uuid; return;
    end if;
    update public.user_plans p
       set resumes_used = coalesce(p.resumes_used, 0) + 1
     where p.id = v_plan;
  end if;

  -- Lineage only to a resume this user owns (service_role bypasses the
  -- resumes INSERT policy from migration 012, so check here too).
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

  update public.generation_requests g
     set status = 'completed', resume_id = v_resume, charged = p_charge, completed_at = now()
   where g.id = r.id;

  return query select 'completed'::text, v_resume;
end;
$$;

-- ── fail_resume_generation ─────────────────────────────────────────────────
-- Releases the lock when the model call or parsing fails (nothing charged).
create or replace function public.fail_resume_generation(
  p_user_id uuid,
  p_request_key uuid,
  p_reason text
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.generation_requests g
     set status = 'failed', failure = left(coalesce(p_reason, 'failed'), 200), completed_at = now()
   where g.user_id = p_user_id and g.request_key = p_request_key and g.status = 'pending';
end;
$$;

-- Functions are EXECUTE-able by PUBLIC by default. Server only.
revoke execute on function public.begin_resume_generation(uuid, uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.complete_resume_generation(uuid, uuid, boolean, jsonb) from public, anon, authenticated;
revoke execute on function public.fail_resume_generation(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.begin_resume_generation(uuid, uuid, text, integer) to service_role;
grant execute on function public.complete_resume_generation(uuid, uuid, boolean, jsonb) to service_role;
grant execute on function public.fail_resume_generation(uuid, uuid, text) to service_role;
