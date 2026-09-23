-- Migration 012: make regeneration lineage safe to actually use.
--
-- resumes.regen_of_resume_id has existed since migration 002 but was never
-- written — the API accepted a parent id, used it for the free-regen credit
-- check, and then discarded it. Verified in production: 0 rows carry lineage.
--
-- Turning it on surfaces two pre-existing problems.
--
-- 1. THE FOREIGN KEY HAS NO ON DELETE BEHAVIOUR
--
--    Today:  FOREIGN KEY (regen_of_resume_id) REFERENCES resumes(id)
--    i.e. NO ACTION. Harmless only because no row has ever had a parent.
--
--    Users can now delete resumes (migration 010 + the dashboard delete).
--    The moment lineage is written, deleting a resume that has been
--    regenerated would fail with a foreign key violation, and the UI would
--    show "Couldn't delete: ...". Deleting the parent must not be blocked by,
--    nor cascade into, its regenerations — a regenerated resume is a
--    document in its own right. ON DELETE SET NULL keeps the child and drops
--    only the now-dangling reference.
--
-- 2. THE INSERT POLICY DOES NOT CHECK THE PARENT'S OWNER
--
--    Today:  WITH CHECK (auth.uid() = user_id)
--    That constrains who the row belongs to, but says nothing about whose
--    resume it claims to descend from. The client performs the insert, so
--    without this a crafted request could point regen_of_resume_id at another
--    user's resume and create a cross-account reference.
--
--    The API already resolves ownership server-side and echoes back only a
--    verified id, but that is a cooperating-client guarantee, not an enforced
--    one. RLS WITH CHECK supports subqueries, so the rule is enforced in the
--    database where it cannot be bypassed.
--
--    The subquery reads public.resumes under the caller's own RLS context, so
--    a parent the caller cannot SELECT is also a parent they cannot reference.

-- 1) Re-point the foreign key with ON DELETE SET NULL.
alter table public.resumes
  drop constraint if exists resumes_regen_of_resume_id_fkey;

alter table public.resumes
  add constraint resumes_regen_of_resume_id_fkey
  foreign key (regen_of_resume_id)
  references public.resumes(id)
  on delete set null;

-- 2) Require any referenced parent to belong to the same user.
--
--    NOTE the `resumes.` qualification on regen_of_resume_id. Unqualified, it
--    binds to the SUBQUERY's table (parent.regen_of_resume_id), not the new
--    row, so the EXISTS is always false and every lineage insert is rejected
--    — including the owner's own. That version was written, tested against a
--    role-switched session, and caught by case 2 below before it shipped.
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

-- Verified in a rolled-back transaction against production, impersonating the
-- `authenticated` role with request.jwt.claims set (auth.uid() confirmed to
-- resolve correctly first):
--
--   cross-user parent .............. BLOCKED
--   own parent ..................... ALLOWED
--   no lineage (ordinary insert) ... ALLOWED
--   nonexistent parent ............. BLOCKED
--   delete parent that has a child . ALLOWED, child kept, lineage NULLed

-- Lookups by parent (version history, and the FK's own SET NULL scan).
create index if not exists resumes_regen_of_resume_id_idx
  on public.resumes(regen_of_resume_id)
  where regen_of_resume_id is not null;
