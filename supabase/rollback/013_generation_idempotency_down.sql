-- Rollback for migration 013 (generation idempotency).
--
-- Kept OUTSIDE supabase/migrations so no tooling mistakes it for a forward
-- migration. Run only AFTER the application code that calls these functions
-- has been reverted — otherwise every generation request fails at
-- begin_resume_generation (safely: before any model call or charge).
--
-- Data: resumes created through the new path keep their rows; only the
-- generation_request_id link and the attempt log are removed. No credit or
-- resume is lost.

drop function if exists public.fail_resume_generation(uuid, uuid, text);
drop function if exists public.complete_resume_generation(uuid, uuid, boolean, jsonb);
drop function if exists public.begin_resume_generation(uuid, uuid, text, integer);

drop index if exists public.resumes_generation_request_id_key;
alter table public.resumes drop column if exists generation_request_id;

drop table if exists public.generation_requests;
