-- Migration 006: track 1-per-account free ATS review usage.
--
-- Decision recap: Free users have NO user_plans row. We track the single
-- free ATS preview entitlement on profiles instead, so /api/score-free can
-- reject a second attempt with 402 and route them to /pricing.

alter table public.profiles
  add column if not exists free_review_used_at timestamptz;
