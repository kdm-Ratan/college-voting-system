-- ============================================================
-- COLLEGE VOTING SYSTEM
-- Candidate table privileges for RLS-protected staff access
-- Migration: 005_candidates_authenticated_privileges.sql
-- ============================================================

-- The RLS policies created in 002_security.sql remain the authorization
-- boundary: staff can read candidates and only admins can create, update,
-- or delete them. PostgreSQL requires these table privileges before RLS
-- policies are evaluated.

grant select, insert, update, delete
on table public.candidates
to authenticated;

-- Anonymous access remains revoked by 002_security.sql.
