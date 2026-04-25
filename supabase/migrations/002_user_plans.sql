-- Migration 002: user_plans table + free regen column on resumes

create table public.user_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  plan_type text check (plan_type in ('starter','fresher','job_hunter','placement_pro')) not null,
  resumes_allotted int not null,
  resumes_used int default 0,
  purchased_at timestamptz default now(),
  expires_at timestamptz not null,
  razorpay_payment_id text,
  is_test boolean default false,
  created_at timestamptz default now()
);

alter table public.user_plans enable row level security;

create policy "Users view own plans" on public.user_plans
  for select using (auth.uid() = user_id);

create index user_plans_user_id_active on public.user_plans(user_id, expires_at)
  where resumes_used < resumes_allotted;

-- Allow authenticated users to SELECT their own plans from the browser
grant select on public.user_plans to authenticated;

-- regen_of_resume_id tracks when a resume is a re-generation of an existing one
-- Re-generates within 24 h of the original are free (no credit consumed)
alter table public.resumes
  add column regen_of_resume_id uuid references public.resumes(id);
