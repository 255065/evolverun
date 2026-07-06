-- Security hardening: public.handle_new_user() is a SECURITY DEFINER trigger on
-- auth.users that runs on signup (it inserts the profiles row). It was also
-- reachable as an RPC (/rest/v1/rpc/handle_new_user) by the anon and
-- authenticated roles, which the Supabase linter flags (lints 0028/0029).
-- Revoke EXECUTE from the API roles so the function can only ever fire as a
-- trigger. Trigger execution does not check the EXECUTE privilege, so signups
-- are unaffected. Idempotent — safe to re-run.
revoke execute on function public.handle_new_user() from anon, authenticated, public;
