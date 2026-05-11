-- Migration 004: pricing v2 — new SKU set.
--
-- Renames legacy plan_type values in-place:
--   starter        → single        (1 download)
--   placement_pro  → career        (25 downloads)
-- Then swaps the CHECK constraint to the new SKU set.
--
-- "free" is NOT a valid plan_type — Free users have NO user_plans row.
-- The check constraint deliberately omits it.

-- 1) Migrate any existing rows. Use guarded UPDATEs so re-running is safe.
update public.user_plans set plan_type = 'single' where plan_type = 'starter';
update public.user_plans set plan_type = 'career' where plan_type = 'placement_pro';

-- 2) Replace the CHECK constraint.
alter table public.user_plans
  drop constraint if exists user_plans_plan_type_check;

alter table public.user_plans
  add constraint user_plans_plan_type_check
  check (plan_type in ('single','fresher','job_hunter','career'));
