-- Migration 008: stop exposing rls_auto_enable() to public API roles.
--
-- Supabase's linter flags public.rls_auto_enable() as a SECURITY DEFINER
-- function executable by `anon` and `authenticated` over
-- /rest/v1/rpc/rls_auto_enable.
--
-- In practice it is NOT exploitable: the function returns `event_trigger`, and
-- Postgres refuses to run those outside an event-trigger context —
--   ERROR: 0A000: trigger functions can only be called as triggers
-- (verified against this database). The EXECUTE grant only exists because
-- Postgres grants EXECUTE to PUBLIC on new functions by default.
--
-- Revoking anyway: it costs nothing, satisfies least privilege, and clears the
-- linter so a genuinely exploitable SECURITY DEFINER function can't hide in
-- the noise later. The event trigger itself keeps working — event triggers run
-- as the trigger owner and do not consult EXECUTE grants.

revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from anon;
revoke execute on function public.rls_auto_enable() from authenticated;
