-- Run on the restored production-schema copy BEFORE migration 013.
-- Each check raises 'PREFLIGHT FAILED: ...' on failure (psql ON_ERROR_STOP).

do $$
begin
  if to_regclass('public.resumes') is null or to_regclass('public.user_plans') is null then
    raise exception 'PREFLIGHT FAILED: public.resumes / public.user_plans missing from the dump';
  end if;
  if to_regclass('public.generation_requests') is not null then
    raise exception 'PREFLIGHT FAILED: public.generation_requests already exists (013 applied already?)';
  end if;
  if exists (select 1 from pg_proc where proname in ('begin_resume_generation', 'complete_resume_generation', 'fail_resume_generation')) then
    raise exception 'PREFLIGHT FAILED: a 013 function name is already taken';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'resumes' and column_name = 'generation_request_id') then
    raise exception 'PREFLIGHT FAILED: resumes.generation_request_id already exists';
  end if;
  -- Supabase grants USAGE on public to its API roles explicitly, so the dump
  -- carries it. Without it every later check would fail for the wrong reason.
  if not (has_schema_privilege('service_role', 'public', 'USAGE') and has_schema_privilege('authenticated', 'public', 'USAGE')) then
    raise exception 'PREFLIGHT FAILED: the restored schema does not grant USAGE on public to service_role/authenticated (dump ACL differs from Supabase defaults)';
  end if;
  if not has_table_privilege('service_role', 'public.user_plans', 'UPDATE') then
    raise exception 'PREFLIGHT FAILED: service_role cannot UPDATE user_plans (the charge would fail)';
  end if;
  if exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
             where c.relname in ('resumes', 'user_plans') and not t.tgisinternal) then
    raise notice 'PREFLIGHT NOTE: user triggers exist on resumes/user_plans — review them against 013';
  end if;
  raise notice 'PREFLIGHT OK';
end $$;

-- Snapshot what 013 must not change, for postcheck.sql (a separate psql
-- session, so a real table in its own schema, not a temporary table).
create schema dryrun;
create table dryrun.before as
select 'policy' as kind, tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') as item
  from pg_policies where schemaname = 'public'
union all
select 'column', table_name || '.' || column_name || ':' || data_type || ':' || is_nullable
  from information_schema.columns where table_schema = 'public' and table_name <> 'generation_requests';
