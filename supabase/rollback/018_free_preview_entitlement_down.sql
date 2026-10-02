-- Rollback for migration 018 (free preview + download entitlements).
--
-- Drops the _v2 generation functions, the unlock function, the reservation
-- column and the entitlement table, and restores the 3-credit beta grant of
-- migration 015. It does NOT restore beta allowances that 018 capped, and it
-- does not refund credits spent on unlocks (resume_entitlements rows are
-- dropped). Code that calls the _v2 functions must be rolled back first.

drop function if exists public.unlock_resume_download(uuid, uuid);
drop function if exists public.fail_resume_generation_v2(uuid, uuid, text);
drop function if exists public.complete_resume_generation_v2(uuid, uuid, jsonb, boolean);
drop function if exists public.begin_resume_generation_v2(uuid, uuid, text, integer, boolean);
drop function if exists public._release_generation_reservation(uuid);

alter table public.generation_requests drop column if exists reserved_plan_id;
drop table if exists public.resume_entitlements;

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
