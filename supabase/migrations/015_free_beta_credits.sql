-- Migration 015: Free Beta — 3 resume-generation credits per account.
--
-- Until payments (Razorpay) are integrated, every account gets exactly three
-- resume generations, once. The allowance is an ordinary user_plans row of a
-- new type, 'beta', so everything that already enforces credits enforces it
-- too: complete_resume_generation (013) charges it in the same transaction
-- that saves the resume, free same-JD regenerations stay free, and the
-- download entitlement treats it like any plan the resume was created under.
--
-- GUARANTEES
--
--   * at most one beta grant per account, ever ... partial UNIQUE index on
--     user_plans (user_id) WHERE plan_type = 'beta'. The grant is an
--     INSERT ... ON CONFLICT DO NOTHING against it: concurrent or repeated
--     grants (two tabs, retries, every page load) create one row.
--   * no reset or reclaim ... the browser still cannot INSERT, UPDATE or
--     DELETE user_plans (RLS allows SELECT only), and the grant function is
--     server-only. Using the credits never removes the row, so a later grant
--     attempt finds it and does nothing.
--   * coexists with paid plans ... a paid plan is just another row; the
--     charge takes the newest plan with a credit left (013), and the beta
--     row is charged once newer plans are used up.
--
-- The credits expire one year after the grant (user_plans.expires_at is NOT
-- NULL); resumes made with them stay downloadable after that.
--
-- ROLLOUT: apply BEFORE deploying the code that calls grant_beta_credits.
-- Without it the server logs the missing function and behaves as before
-- (no plan -> 402), so nothing breaks, but nobody gets the beta credits.
-- Rollback: supabase/rollback/015_free_beta_credits_down.sql.

alter table public.user_plans drop constraint if exists user_plans_plan_type_check;
alter table public.user_plans
  add constraint user_plans_plan_type_check
  check (plan_type in ('single', 'fresher', 'job_hunter', 'career', 'beta'));

create unique index if not exists user_plans_one_beta_per_user
  on public.user_plans (user_id)
  where plan_type = 'beta';

-- Grants the Free Beta credits if this account has never had them.
-- Returns true when this call created the grant, false when it already existed.
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
  insert into public.user_plans (user_id, plan_type, resumes_allotted, resumes_used, purchased_at, expires_at, is_test)
  values (p_user_id, 'beta', 3, 0, now(), now() + interval '1 year', false)
  on conflict (user_id) where plan_type = 'beta' do nothing
  returning id into v_id;
  return v_id is not null;
end;
$$;

revoke execute on function public.grant_beta_credits(uuid) from public, anon, authenticated;
grant execute on function public.grant_beta_credits(uuid) to service_role;

comment on function public.grant_beta_credits(uuid) is
  'Free Beta: one 3-credit user_plans row (plan_type beta) per account, idempotent. Server-only. See migration 015.';
