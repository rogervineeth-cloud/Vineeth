-- Profiles table
create table public.profiles (
  user_id uuid primary key references auth.users on delete cascade,
  full_name text,
  email text,
  phone text,
  current_city text,
  graduation_year int,
  linkedin_data jsonb,
  target_roles text[],
  onboarded_at timestamptz,
  created_at timestamptz default now()
);

-- Resumes table
create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  jd_text text not null,
  jd_url text,
  resume_json jsonb not null,
  ats_score int,
  tailored_role text,
  matched_keywords text[],
  missing_keywords text[],
  downloaded_at timestamptz,
  created_at timestamptz default now()
);

-- Enable Row Level Security
alter table public.profiles enable row level security;
alter table public.resumes enable row level security;

-- Policies: users access only their own data
create policy "Users view own profile" on public.profiles
  for select using (auth.uid() = user_id);

create policy "Users insert own profile" on public.profiles
  for insert with check (auth.uid() = user_id);

create policy "Users update own profile" on public.profiles
  for update using (auth.uid() = user_id);

create policy "Users view own resumes" on public.resumes
  for select using (auth.uid() = user_id);

create policy "Users insert own resumes" on public.resumes
  for insert with check (auth.uid() = user_id);

create policy "Users update own resumes" on public.resumes
  for update using (auth.uid() = user_id);

-- Indexes
create index resumes_user_id_idx on public.resumes(user_id);
create index resumes_created_at_idx on public.resumes(created_at desc);
