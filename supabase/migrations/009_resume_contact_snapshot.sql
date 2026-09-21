-- Migration 009: snapshot contact details onto each resume.
--
-- Preview and PDF both rendered the contact header by joining to the CURRENT
-- profile row, so editing your profile silently rewrote the identity on every
-- resume you had already generated (and paid to download). Observed: the same
-- resume rendered three different names/emails across three profile edits.
--
-- Contact details are now captured at generation time and stored with the
-- resume. Existing rows get NULL and fall back to the live profile, so nothing
-- breaks for the 9 resumes that predate this.
--
-- Shape: { full_name, email, phone, current_city }

alter table public.resumes
  add column if not exists contact_snapshot jsonb;

comment on column public.resumes.contact_snapshot is
  'Contact details as they were when this resume was generated. NULL for rows created before migration 009 — renderers fall back to the live profile.';
