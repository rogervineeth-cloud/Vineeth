-- Migration 011: persist the chosen template on the resume.
--
-- The template picker wrote to localStorage and sent the choice to
-- /api/generate-resume as a prompt hint, but it was never stored. The PDF
-- renderer had no way to know which template the user picked — and in fact
-- never looked, so all four options produced a byte-identical PDF.
--
-- Existing rows get NULL and render with the default ("classic").

alter table public.resumes
  add column if not exists template text;

alter table public.resumes
  drop constraint if exists resumes_template_check;

alter table public.resumes
  add constraint resumes_template_check
  check (template is null or template in ('classic','modern','compact','executive'));

comment on column public.resumes.template is
  'Template the user selected at generation time. NULL for rows created before migration 011 — the renderer falls back to classic.';
