-- Migration 007: restore service_role table privileges.
--
-- A security-hardening pass revoked read/write privileges from every role in
-- `public`, then re-granted only `authenticated`. `service_role` was left with
-- just REFERENCES, TRIGGER and TRUNCATE — i.e. it could not read or write
-- anything.
--
-- That silently broke every server-side path that uses the service client:
--   lib/plans.ts      consumeCredit / refundCredit / grantTestPlan
--   lib/addons.ts     consumeAddon / grantTestAddon
--   /api/score-free   the free_review_used_at upsert
--   /api/keep-alive   the liveness ping
--
-- Symptom in production: "permission denied for table profiles" (SQLSTATE
-- 42501). Because consumeCredit() only returns a boolean, generate-resume
-- would call Anthropic successfully, fail to debit the credit, and return 402
-- to the user — burning an API call for nothing.
--
-- service_role is the trusted backend identity. Its key is server-only (a
-- sensitive Vercel env var, never shipped to the browser), and it is designed
-- to bypass RLS. Restoring full table access on the app schema returns it to
-- the Supabase default. anon and authenticated privileges are deliberately
-- left exactly as they are.

grant usage on schema public to service_role;

grant select, insert, update, delete
  on all tables in schema public
  to service_role;

grant usage, select on all sequences in schema public to service_role;

-- Future tables created in this schema should not silently repeat the bug.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges in schema public
  grant usage, select on sequences to service_role;
