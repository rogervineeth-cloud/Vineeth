-- Rollback for migration 015 (Free Beta credits). Non-destructive: it stops
-- NEW grants but never deletes a user's granted or spent beta credits.
--
-- The plan_type CHECK is restored to the pre-015 list only when no beta rows
-- exist; otherwise it keeps 'beta' so existing rows stay valid (a notice says
-- so). Removing beta rows is a separate, deliberate data decision.

drop function if exists public.grant_beta_credits(uuid);
drop index if exists public.user_plans_one_beta_per_user;

do $$
begin
  if exists (select 1 from public.user_plans where plan_type = 'beta') then
    raise notice '015 rollback: beta plan rows exist; keeping ''beta'' in user_plans_plan_type_check';
  else
    alter table public.user_plans drop constraint if exists user_plans_plan_type_check;
    alter table public.user_plans
      add constraint user_plans_plan_type_check
      check (plan_type in ('single', 'fresher', 'job_hunter', 'career'));
  end if;
end;
$$;
