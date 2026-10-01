-- Migration 017: AI Job Recommendations, Phase 1.
--
-- Numbered 017 (was 016): 016 is taken by 016_payment_orders.sql (branch
-- claude/razorpay-checkout-foundation). The two touch no common objects;
-- this migration does not depend on 016.
--
-- WHAT IT ADDS
--
--   job_rec_consents     one row per user who agreed to job matching
--   job_rec_runs         one row per recommendation request (idempotent by
--                        request_key; counted for the per-user rate limit)
--   job_recommendations  the scored jobs of a run, with the persisted v1 score
--                        components, and the user's save / dismiss status
--
-- WHAT IT DELIBERATELY DOES NOT STORE
--
--   No resume text, no contact details, no matching inputs: a run keeps only a
--   sha256 fingerprint of the matching profile. No raw provider payloads: a
--   recommendation keeps only the normalised fields the UI shows. Apply links
--   must be https (CHECK), mirroring the server-side validation.
--
-- ACCESS
--
--   Owners may SELECT their own rows (RLS). Every write goes through the
--   server (service_role) and the server-only functions below, as for
--   resumes since migration 014: a user cannot fabricate a recommendation,
--   skip the consent check, or reset their rate limit from the browser.
--
-- BACKWARD COMPATIBLE: additions only; nothing existing is altered. The
-- feature is behind JOB_RECOMMENDATIONS_ENABLED (off by default), so applying
-- this migration changes nothing user-visible on its own.
-- Rollback: supabase/rollback/017_job_recommendations_down.sql.

create table if not exists public.job_rec_consents (
  user_id uuid primary key references auth.users on delete cascade,
  consent_version text not null check (length(consent_version) between 1 and 40),
  granted_at timestamptz not null default now()
);

create table if not exists public.job_rec_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  request_key uuid not null,
  provider text not null check (provider in ('fixture')),
  scoring_version text not null check (scoring_version ~ '^v[0-9]+$'),
  profile_fingerprint text not null check (profile_fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('results', 'empty', 'partial')),
  dropped_count integer not null default 0 check (dropped_count >= 0),
  created_at timestamptz not null default now(),
  constraint job_rec_runs_user_request_key unique (user_id, request_key)
);

create index if not exists job_rec_runs_user_created
  on public.job_rec_runs (user_id, created_at desc);

create table if not exists public.job_recommendations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.job_rec_runs(id) on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  provider text not null check (provider in ('fixture')),
  provider_job_id text not null check (length(provider_job_id) between 1 and 128),
  title text not null check (length(title) between 1 and 160),
  company text not null check (length(company) between 1 and 160),
  location text check (location is null or length(location) <= 120),
  remote boolean not null default false,
  apply_url text not null check (apply_url ~ '^https://[^/@\s]+\.[^/@\s]+' and length(apply_url) <= 2048),
  posted_at timestamptz,
  score integer not null check (score between 0 and 100),
  components jsonb not null check (jsonb_typeof(components) = 'object'),
  scoring_version text not null check (scoring_version ~ '^v[0-9]+$'),
  status text not null default 'new' check (status in ('new', 'saved', 'dismissed')),
  status_updated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint job_recommendations_run_job unique (run_id, provider, provider_job_id)
);

create index if not exists job_recommendations_user_run
  on public.job_recommendations (user_id, run_id, score desc);
create index if not exists job_recommendations_user_job
  on public.job_recommendations (user_id, provider, provider_job_id);

alter table public.job_rec_consents enable row level security;
alter table public.job_rec_runs enable row level security;
alter table public.job_recommendations enable row level security;

drop policy if exists "Users view own job rec consent" on public.job_rec_consents;
create policy "Users view own job rec consent" on public.job_rec_consents
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users view own job rec runs" on public.job_rec_runs;
create policy "Users view own job rec runs" on public.job_rec_runs
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users view own job recommendations" on public.job_recommendations;
create policy "Users view own job recommendations" on public.job_recommendations
  for select to authenticated using (auth.uid() = user_id);

revoke all on table public.job_rec_consents, public.job_rec_runs, public.job_recommendations from public, anon, authenticated;
grant select on table public.job_rec_consents, public.job_rec_runs, public.job_recommendations to authenticated;
grant select, insert, update, delete on table public.job_rec_consents, public.job_rec_runs, public.job_recommendations to service_role;

-- ── consent ────────────────────────────────────────────────────────────────
create or replace function public.grant_job_rec_consent(p_user_id uuid, p_version text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_user_id is null or p_version is null then
    raise exception 'grant_job_rec_consent: arguments must not be null';
  end if;
  insert into public.job_rec_consents (user_id, consent_version, granted_at)
  values (p_user_id, p_version, now())
  on conflict (user_id) do update set consent_version = excluded.consent_version, granted_at = now();
end;
$$;

-- Withdrawing consent also deletes everything the feature stored for the user.
create or replace function public.revoke_job_rec_consent(p_user_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('job_rec_run:' || p_user_id::text, 0));
  delete from public.job_rec_runs r where r.user_id = p_user_id; -- cascades to recommendations
  delete from public.job_rec_consents c where c.user_id = p_user_id;
end;
$$;

-- ── check_job_rec_run ──────────────────────────────────────────────────────
-- Called before the provider. Outcomes:
--   ok            go ahead
--   replay        this request_key already produced run_id; return it
--   rate_limited  p_max_per_hour runs in the last hour; retry_after seconds
create or replace function public.check_job_rec_run(
  p_user_id uuid, p_request_key uuid, p_max_per_hour integer
)
returns table (outcome text, run_id uuid, retry_after integer)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_run uuid;
  v_count integer;
  v_oldest timestamptz;
begin
  select r.id into v_run from public.job_rec_runs r
   where r.user_id = p_user_id and r.request_key = p_request_key;
  if v_run is not null then
    return query select 'replay'::text, v_run, 0; return;
  end if;
  select count(*), min(r.created_at) into v_count, v_oldest from public.job_rec_runs r
   where r.user_id = p_user_id and r.created_at > now() - interval '1 hour';
  if v_count >= p_max_per_hour then
    return query select 'rate_limited'::text, null::uuid,
      greatest(1, ceil(extract(epoch from (v_oldest + interval '1 hour' - now())))::integer);
    return;
  end if;
  return query select 'ok'::text, null::uuid, 0;
end;
$$;

-- ── record_job_rec_run ─────────────────────────────────────────────────────
-- Stores a scored run in one transaction, serialised per user. Re-checks
-- consent, idempotency and the rate limit under the lock, so two tabs racing
-- cannot exceed the limit or store two runs for one request_key. Jobs the user
-- dismissed before are left out; jobs they saved before stay saved.
-- Outcomes: created | replay | rate_limited | consent_required.
create or replace function public.record_job_rec_run(
  p_user_id uuid,
  p_request_key uuid,
  p_provider text,
  p_scoring_version text,
  p_fingerprint text,
  p_status text,
  p_dropped integer,
  p_items jsonb,
  p_max_per_hour integer
)
returns table (outcome text, run_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  v_run uuid;
  v_count integer;
begin
  if p_user_id is null or p_request_key is null then
    raise exception 'record_job_rec_run: arguments must not be null';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 50 then
    raise exception 'record_job_rec_run: items must be an array of at most 50';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('job_rec_run:' || p_user_id::text, 0));

  if not exists (select 1 from public.job_rec_consents c where c.user_id = p_user_id) then
    return query select 'consent_required'::text, null::uuid; return;
  end if;

  select r.id into v_run from public.job_rec_runs r
   where r.user_id = p_user_id and r.request_key = p_request_key;
  if v_run is not null then
    return query select 'replay'::text, v_run; return;
  end if;

  select count(*) into v_count from public.job_rec_runs r
   where r.user_id = p_user_id and r.created_at > now() - interval '1 hour';
  if v_count >= p_max_per_hour then
    return query select 'rate_limited'::text, null::uuid; return;
  end if;

  -- Housekeeping, this user only: runs older than 30 days go, unless they
  -- hold a job the user saved.
  delete from public.job_rec_runs r
   where r.user_id = p_user_id and r.created_at < now() - interval '30 days'
     and not exists (select 1 from public.job_recommendations j where j.run_id = r.id and j.status = 'saved');

  insert into public.job_rec_runs (user_id, request_key, provider, scoring_version, profile_fingerprint, status, dropped_count)
  values (p_user_id, p_request_key, p_provider, p_scoring_version, p_fingerprint, p_status, coalesce(p_dropped, 0))
  returning id into v_run;

  insert into public.job_recommendations (
    run_id, user_id, provider, provider_job_id, title, company, location, remote,
    apply_url, posted_at, score, components, scoring_version, status, status_updated_at
  )
  select v_run, p_user_id, p_provider, i->>'provider_job_id', i->>'title', i->>'company',
         nullif(i->>'location', ''), coalesce((i->>'remote')::boolean, false),
         i->>'apply_url', nullif(i->>'posted_at', '')::timestamptz,
         (i->>'score')::integer, i->'components', p_scoring_version,
         case when prev.saved then 'saved' else 'new' end,
         case when prev.saved then now() else null end
    from jsonb_array_elements(p_items) as i
    left join lateral (
      select bool_or(j.status = 'saved') as saved, bool_or(j.status = 'dismissed') as dismissed
        from public.job_recommendations j
       where j.user_id = p_user_id and j.provider = p_provider and j.provider_job_id = i->>'provider_job_id'
    ) prev on true
   where not coalesce(prev.dismissed, false);

  return query select 'created'::text, v_run;
end;
$$;

-- ── set_job_rec_status ─────────────────────────────────────────────────────
-- Save / dismiss / reset one recommendation the caller owns. Returns false
-- when no such recommendation belongs to p_user_id (the route answers 404).
create or replace function public.set_job_rec_status(p_user_id uuid, p_rec_id uuid, p_status text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_status not in ('new', 'saved', 'dismissed') then
    raise exception 'set_job_rec_status: invalid status';
  end if;
  update public.job_recommendations j
     set status = p_status, status_updated_at = now()
   where j.id = p_rec_id and j.user_id = p_user_id;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke execute on function public.grant_job_rec_consent(uuid, text) from public, anon, authenticated;
revoke execute on function public.revoke_job_rec_consent(uuid) from public, anon, authenticated;
revoke execute on function public.check_job_rec_run(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.record_job_rec_run(uuid, uuid, text, text, text, text, integer, jsonb, integer) from public, anon, authenticated;
revoke execute on function public.set_job_rec_status(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.grant_job_rec_consent(uuid, text) to service_role;
grant execute on function public.revoke_job_rec_consent(uuid) to service_role;
grant execute on function public.check_job_rec_run(uuid, uuid, integer) to service_role;
grant execute on function public.record_job_rec_run(uuid, uuid, text, text, text, text, integer, jsonb, integer) to service_role;
grant execute on function public.set_job_rec_status(uuid, uuid, text) to service_role;

comment on table public.job_recommendations is
  'AI Job Recommendations Phase 1: scored jobs per run with persisted v1 components. Owner SELECT only; writes via server functions. See migration 017.';
