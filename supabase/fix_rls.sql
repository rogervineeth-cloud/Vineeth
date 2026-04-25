-- Run this in Supabase SQL Editor to fix RLS policies
-- Safe to re-run — drops and recreates all policies

-- ── profiles ──────────────────────────────────────────
drop policy if exists "Users view own profile" on public.profiles;
drop policy if exists "Users insert own profile" on public.profiles;
drop policy if exists "Users update own profile" on public.profiles;

create policy "Users view own profile" on public.profiles
  for select using (auth.uid() = user_id);

create policy "Users insert own profile" on public.profiles
  for insert with check (auth.uid() = user_id);

-- WITH CHECK is required for upsert (INSERT … ON CONFLICT DO UPDATE)
create policy "Users update own profile" on public.profiles
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── resumes ───────────────────────────────────────────
drop policy if exists "Users view own resumes" on public.resumes;
drop policy if exists "Users insert own resumes" on public.resumes;
drop policy if exists "Users update own resumes" on public.resumes;

create policy "Users view own resumes" on public.resumes
  for select using (auth.uid() = user_id);

create policy "Users insert own resumes" on public.resumes
  for insert with check (auth.uid() = user_id);

create policy "Users update own resumes" on public.resumes
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
