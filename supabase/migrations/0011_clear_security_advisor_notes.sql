-- Clear the remaining Supabase security-advisor notes.

-- 1) set_updated_at only calls now() (in pg_catalog, always resolvable), so an
--    empty search_path is safe and closes lint 0011 (function_search_path_mutable).
alter function public.set_updated_at() set search_path = '';

-- 2) These four tables are written only by the backend service_role, which
--    bypasses RLS. RLS is enabled but had no policy, which the linter flags
--    (lint 0008, rls_enabled_no_policy). Add an explicit deny-all for the API
--    roles to make the intent explicit and clear the advisor. service_role is
--    unaffected, so the backend keeps working.
create policy "no public access" on public.oauth_clients
  for all to anon, authenticated using (false) with check (false);
create policy "no public access" on public.oauth_consumed_tokens
  for all to anon, authenticated using (false) with check (false);
create policy "no public access" on public.oauth_revoked_grants
  for all to anon, authenticated using (false) with check (false);
create policy "no public access" on public.stripe_processed_events
  for all to anon, authenticated using (false) with check (false);
