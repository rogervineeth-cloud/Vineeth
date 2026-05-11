-- Migration 005: user_addons — entitlement table for one-shot add-ons
-- (LinkedIn Rewrite today; future add-ons can re-use the same table).
--
-- One row per granted add-on. used_at is set when the entitlement is consumed
-- so it can't be redeemed twice.

create table public.user_addons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  addon_id text check (addon_id in ('linkedin_rewrite')) not null,
  granted_at timestamptz default now(),
  used_at timestamptz,
  is_test boolean default false,
  created_at timestamptz default now()
);

alter table public.user_addons enable row level security;

create policy "Users view own addons" on public.user_addons
  for select using (auth.uid() = user_id);

create index user_addons_user_id_unused
  on public.user_addons(user_id, addon_id)
  where used_at is null;

grant select on public.user_addons to authenticated;
