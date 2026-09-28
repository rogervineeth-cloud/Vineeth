-- Supabase pieces the production `public` schema depends on but that a
-- schema-only dump of `public` does not contain. Applied to the disposable
-- local database BEFORE the dump is restored. Mirrors the stubs in
-- __tests__/helpers/local-postgres.ts.

do $$
declare r text;
begin
  foreach r in array array[
    'anon', 'authenticated', 'service_role', 'supabase_admin', 'authenticator',
    'dashboard_user', 'supabase_auth_admin', 'supabase_storage_admin', 'pgbouncer'
  ] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end $$;
alter role service_role bypassrls;

create schema if not exists auth;
create schema if not exists extensions;
create table if not exists auth.users (id uuid primary key);
-- As in Supabase: the JWT's subject, from the request settings.
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create or replace function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth, extensions to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
