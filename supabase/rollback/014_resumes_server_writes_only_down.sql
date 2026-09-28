-- Rollback for migration 014: restores the browser's INSERT and UPDATE on
-- public.resumes exactly as they were after migration 012 (policies from 001
-- and 012, table privileges as Supabase grants them). Re-opens the gap 014
-- closed; use only to restore the pre-PR-#38 browser insert flow.

grant insert, update on table public.resumes to authenticated;

drop policy if exists "Users insert own resumes" on public.resumes;
create policy "Users insert own resumes" on public.resumes
  for insert with check (
    auth.uid() = user_id
    and (
      resumes.regen_of_resume_id is null
      or exists (
        select 1 from public.resumes parent
        where parent.id = resumes.regen_of_resume_id
          and parent.user_id = auth.uid()
      )
    )
  );

drop policy if exists "Users update own resumes" on public.resumes;
create policy "Users update own resumes" on public.resumes
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
