-- Migration 003: generation_issues table + rich profile_data column

-- Rich profile editor data (experience, skills, education, projects)
-- Stored separately from linkedin_data so users can edit freely
alter table public.profiles
  add column if not exists profile_data jsonb;

-- generation_issues: log AI errors for manual triage + possible credit refund
create table public.generation_issues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  resume_id uuid references public.resumes on delete cascade not null,
  description text not null,
  resolved_at timestamptz,
  created_at timestamptz default now()
);

alter table public.generation_issues enable row level security;

create policy "Users manage own issues" on public.generation_issues
  for all using (auth.uid() = user_id);

grant select, insert on public.generation_issues to authenticated;
