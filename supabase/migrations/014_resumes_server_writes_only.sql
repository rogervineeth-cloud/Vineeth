-- Migration 014: only the server may create or change resumes.
--
-- THE GAP
--
-- Since 001 the browser (anon key + the user's JWT, role `authenticated`) has
-- had INSERT and UPDATE on public.resumes, limited by RLS only to the user's
-- own rows. That let any signed-in user, straight from the browser console:
--   * INSERT a resume row with any content — bypassing generation and its
--     credit charge — and then download it as a PDF;
--   * UPDATE downloaded_at on any of their resumes, which the download gate
--     treats as "already downloaded, re-downloads are free";
--   * UPDATE created_at, which the download entitlement compares with plan
--     purchase times (lib/download-entitlement.ts).
-- It exposed no other user's data (RLS held), but it made the paid steps
-- bypassable by the account owner.
--
-- WHY NOW
--
-- Nothing legitimate writes resumes from the browser any more:
--   * generation inserts the row server-side, in the same transaction that
--     charges the credit (migration 013, complete_resume_generation);
--   * /api/download-pdf sets downloaded_at with the service role;
--   * there is no in-app resume edit (profile edits live on profiles).
-- The browser keeps SELECT (dashboard, preview) and DELETE (dashboard delete,
-- migration 010) on its own rows.
--
-- ROLLOUT ORDER — IMPORTANT
--
-- Apply this ONLY AFTER the code that no longer inserts resumes from the
-- browser (PR #38) is live in production. The code on main before PR #38
-- inserts the generated resume from the browser; with this migration applied
-- underneath it, generation would charge the credit and then fail to save the
-- resume. Rollback: supabase/rollback/014_resumes_server_writes_only_down.sql.

drop policy if exists "Users insert own resumes" on public.resumes;
drop policy if exists "Users update own resumes" on public.resumes;

-- Table-level REVOKE also removes the matching column privileges.
revoke insert, update on table public.resumes from anon, authenticated;

-- Unchanged, stated for the record: owners may read and delete their rows.
--   "Users view own resumes"   (select)  — migration 001
--   "Users delete own resumes" (delete)  — migration 010
-- service_role (the server) keeps full access and bypasses RLS.
