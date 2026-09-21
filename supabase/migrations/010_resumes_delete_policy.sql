-- Migration 010: let users delete their own resumes.
--
-- The dashboard now has a delete action. `authenticated` already holds the
-- DELETE table grant, but RLS is enabled on public.resumes and there was no
-- DELETE policy — only SELECT, INSERT and UPDATE. Without this, a delete
-- matches zero rows and returns NO error: the UI would report success while
-- the row stayed exactly where it was.
--
-- Scoped to the owner, matching the existing policies on this table.

create policy "Users delete own resumes" on public.resumes
  for delete using (auth.uid() = user_id);
