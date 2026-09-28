-- Run on the production-schema copy AFTER migration 013. Compares against
-- dryrun.before, saved by preflight.sql. Raises 'CHECK FAILED: ...' on failure.
--
-- Everything here writes only to the disposable local database.

\set ON_ERROR_STOP on

-- 1. Objects exist, as specified.
do $$
begin
  if to_regclass('public.generation_requests') is null then raise exception 'CHECK FAILED: table missing'; end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'generation_requests_one_pending_per_fingerprint'
                 and indexdef ilike '%UNIQUE%' and indexdef ilike '%WHERE (status = ''pending''::text)%') then
    raise exception 'CHECK FAILED: partial unique index on pending fingerprints missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'generation_requests_user_request_key' and contype = 'u') then
    raise exception 'CHECK FAILED: UNIQUE (user_id, request_key) missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'resumes'
                 and column_name = 'generation_request_id' and is_nullable = 'YES') then
    raise exception 'CHECK FAILED: resumes.generation_request_id missing or NOT NULL';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'resumes_generation_request_id_key' and indexdef ilike '%UNIQUE%') then
    raise exception 'CHECK FAILED: unique index on resumes.generation_request_id missing';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('begin_resume_generation', 'complete_resume_generation', 'fail_resume_generation')
        and p.proconfig @> array['search_path=""']) <> 3 then
    raise exception 'CHECK FAILED: the three functions must exist with search_path=""';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.generation_requests'::regclass) then
    raise exception 'CHECK FAILED: RLS not enabled on generation_requests';
  end if;
  raise notice 'CHECK OK: objects';
end $$;

-- 2. Access: server only.
do $$
declare
  f text;
  r text;
begin
  foreach f in array array[
    'public.begin_resume_generation(uuid,uuid,text,integer)',
    'public.complete_resume_generation(uuid,uuid,boolean,jsonb)',
    'public.fail_resume_generation(uuid,uuid,text)'
  ] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'CHECK FAILED: service_role cannot execute %', f; end if;
    foreach r in array array['anon', 'authenticated'] loop
      if has_function_privilege(r, f, 'EXECUTE') then raise exception 'CHECK FAILED: % can execute %', r, f; end if;
    end loop;
  end loop;
  foreach r in array array['anon', 'authenticated'] loop
    if has_table_privilege(r, 'public.generation_requests', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'CHECK FAILED: % has privileges on generation_requests', r;
    end if;
  end loop;
  if not has_table_privilege('service_role', 'public.generation_requests', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'CHECK FAILED: service_role lacks privileges on generation_requests';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'generation_requests') then
    raise exception 'CHECK FAILED: generation_requests must have no policies';
  end if;
  raise notice 'CHECK OK: access';
end $$;

-- 3. Behaviour, as the server (service_role) would call it.
insert into auth.users (id) values ('dddddddd-0000-4000-8000-000000000001') on conflict do nothing;
-- plan_type: the first value production's own CHECK constraint allows.
insert into public.user_plans (user_id, plan_type, resumes_allotted, resumes_used, expires_at)
select 'dddddddd-0000-4000-8000-000000000001',
       coalesce((select (regexp_match(pg_get_constraintdef(c.oid), $re$'([^']+)'$re$))[1]
                   from pg_constraint c
                  where c.conrelid = 'public.user_plans'::regclass and c.contype = 'c'
                    and pg_get_constraintdef(c.oid) ilike '%plan_type%'
                  limit 1), 'job_hunter'),
       1, 0, now() + interval '1 day';

set role service_role;
do $$
declare
  u uuid := 'dddddddd-0000-4000-8000-000000000001';
  k1 uuid := gen_random_uuid();
  k2 uuid := gen_random_uuid();
  fp text := repeat('a', 64);
  o text; rid uuid; rid2 uuid;
  row jsonb := jsonb_build_object('jd_text', 'Dry-run JD', 'resume_json', '{"summary":"x"}'::jsonb, 'ats_score', 70,
    'tailored_role', 'Engineer', 'matched_keywords', '["A"]'::jsonb, 'missing_keywords', '[]'::jsonb,
    'contact_snapshot', '{"full_name":"Dry Run"}'::jsonb, 'template', 'classic', 'regen_of_resume_id', null);
begin
  select outcome into o from public.begin_resume_generation(u, k1, fp);
  if o <> 'started' then raise exception 'CHECK FAILED: begin -> %', o; end if;
  select outcome into o from public.begin_resume_generation(u, k2, fp);
  if o <> 'in_progress' then raise exception 'CHECK FAILED: identical second begin -> % (expected in_progress)', o; end if;
  select outcome, resume_id into o, rid from public.complete_resume_generation(u, k1, true, row);
  if o <> 'completed' then raise exception 'CHECK FAILED: complete -> %', o; end if;
  select outcome, resume_id into o, rid2 from public.complete_resume_generation(u, k1, true, row);
  if o <> 'replay' or rid2 <> rid then raise exception 'CHECK FAILED: second complete -> % (expected replay of the same resume)', o; end if;
  if (select resumes_used from public.user_plans where user_id = u) <> 1 then raise exception 'CHECK FAILED: charged more than once'; end if;
  if (select generation_request_id is null from public.resumes where id = rid) then raise exception 'CHECK FAILED: resume not linked to its attempt'; end if;
  -- A finished attempt's key reused for a different request is refused.
  select outcome into o from public.begin_resume_generation(u, k1, repeat('b', 64));
  if o <> 'key_reused' then raise exception 'CHECK FAILED: key reuse -> %', o; end if;
  -- Out of credits now: a different generation is refused and writes nothing.
  k2 := gen_random_uuid();
  perform public.begin_resume_generation(u, k2, repeat('b', 64));
  select outcome into o from public.complete_resume_generation(u, k2, true, row);
  if o <> 'payment_required' then raise exception 'CHECK FAILED: no credit left -> %', o; end if;
  if (select count(*) from public.resumes where user_id = u) <> 1 then raise exception 'CHECK FAILED: a resume was written without a credit'; end if;
  raise notice 'CHECK OK: behaviour (begin / in_progress / complete / replay / key_reused / payment_required)';
end $$;
reset role;

-- 4. The browser's existing INSERT (the currently deployed app) still works.
set role authenticated;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000001';
insert into public.resumes (user_id, jd_text, resume_json) values ('dddddddd-0000-4000-8000-000000000001', 'legacy browser insert', '{}'::jsonb);
reset role;
do $$ begin raise notice 'CHECK OK: legacy browser insert'; end $$;

-- 5. Nothing that existed before 013 changed (policies, columns).
do $$
declare missing int; added int;
begin
  select count(*) into missing from dryrun.before b where not exists (
    select 1 from (
      select 'policy' as kind, tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') as item
        from pg_policies where schemaname = 'public'
      union all
      select 'column', table_name || '.' || column_name || ':' || data_type || ':' || is_nullable
        from information_schema.columns where table_schema = 'public' and table_name <> 'generation_requests'
    ) a where a.kind = b.kind and a.item = b.item);
  if missing > 0 then raise exception 'CHECK FAILED: % pre-existing policies/columns changed', missing; end if;
  select count(*) into added from information_schema.columns c
   where c.table_schema = 'public' and c.table_name <> 'generation_requests'
     and not exists (select 1 from dryrun.before b where b.kind = 'column'
                     and b.item = c.table_name || '.' || c.column_name || ':' || c.data_type || ':' || c.is_nullable);
  if added <> 1 then raise exception 'CHECK FAILED: expected exactly 1 new column outside generation_requests, found %', added; end if;
  raise notice 'CHECK OK: nothing pre-existing changed (only resumes.generation_request_id added)';
end $$;
