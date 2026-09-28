-- ============================================================
-- COLLEGE VOTING SYSTEM
-- Election table privileges for RLS-protected staff access
-- Migration: 003_elections_authenticated_privileges.sql
-- ============================================================

-- RLS policies in 002_security.sql control which authenticated users
-- can access election rows. PostgreSQL also requires base table
-- privileges before those policies are evaluated.
--
-- The existing policies preserve the intended boundaries:
--   * SELECT: staff only, via public.is_operator()
--   * INSERT/UPDATE/DELETE: admins only, via public.is_admin()

grant select, insert, update, delete
on table public.elections
to authenticated;

-- Anonymous access remains revoked by 002_security.sql.
