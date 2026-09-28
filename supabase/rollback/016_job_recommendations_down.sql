-- Rollback for migration 016 (AI Job Recommendations, Phase 1).
--
-- DESTRUCTIVE for this feature's data only: it drops the three job
-- recommendation tables (consents, runs, recommendations) and their
-- functions. Nothing else — profiles, resumes, plans — is touched.
-- Turn the feature off first (unset JOB_RECOMMENDATIONS_ENABLED).

drop function if exists public.set_job_rec_status(uuid, uuid, text);
drop function if exists public.record_job_rec_run(uuid, uuid, text, text, text, text, integer, jsonb, integer);
drop function if exists public.check_job_rec_run(uuid, uuid, integer);
drop function if exists public.revoke_job_rec_consent(uuid);
drop function if exists public.grant_job_rec_consent(uuid, text);
drop table if exists public.job_recommendations;
drop table if exists public.job_rec_runs;
drop table if exists public.job_rec_consents;
