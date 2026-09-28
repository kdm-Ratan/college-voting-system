-- ============================================================
-- COLLEGE VOTING SYSTEM
-- Security / Row Level Security
-- Migration: 002_security.sql
-- ============================================================


-- ------------------------------------------------------------
-- 1. HELPER FUNCTIONS
-- ------------------------------------------------------------

-- Returns TRUE when the currently authenticated user is an admin.
-- SECURITY DEFINER is used so this function can safely check
-- profiles without being blocked by the profiles RLS policy.

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'::public.user_role
  );
$$;


-- Returns TRUE when the currently authenticated user is an
-- authenticated operator or admin.

create or replace function public.is_operator()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role in (
        'admin'::public.user_role,
        'operator'::public.user_role
      )
  );
$$;


-- ------------------------------------------------------------
-- 2. ENABLE RLS
-- ------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.elections enable row level security;
alter table public.candidates enable row level security;
alter table public.voters enable row level security;
alter table public.votes enable row level security;
alter table public.audit_logs enable row level security;


-- ------------------------------------------------------------
-- 3. PROFILES
-- ------------------------------------------------------------

-- A user can see their own profile.
-- Admins can see all profiles.

create policy "profiles_select_own_or_admin"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or public.is_admin()
);


-- Only admins can create profiles directly.
-- Normal user registration will be handled separately.

create policy "profiles_insert_admin"
on public.profiles
for insert
to authenticated
with check (
  public.is_admin()
);


-- Only admins can modify profiles.

create policy "profiles_update_admin"
on public.profiles
for update
to authenticated
using (
  public.is_admin()
)
with check (
  public.is_admin()
);


-- Only admins can delete profiles.

create policy "profiles_delete_admin"
on public.profiles
for delete
to authenticated
using (
  public.is_admin()
);


-- ------------------------------------------------------------
-- 4. ELECTIONS
-- ------------------------------------------------------------

-- Authenticated staff can see elections.

create policy "elections_select_staff"
on public.elections
for select
to authenticated
using (
  public.is_operator()
);


-- Only admins can create elections.

create policy "elections_insert_admin"
on public.elections
for insert
to authenticated
with check (
  public.is_admin()
);


-- Only admins can modify elections.

create policy "elections_update_admin"
on public.elections
for update
to authenticated
using (
  public.is_admin()
)
with check (
  public.is_admin()
);


-- Only admins can delete elections.

create policy "elections_delete_admin"
on public.elections
for delete
to authenticated
using (
  public.is_admin()
);


-- ------------------------------------------------------------
-- 5. CANDIDATES
-- ------------------------------------------------------------

-- Staff can view candidates.

create policy "candidates_select_staff"
on public.candidates
for select
to authenticated
using (
  public.is_operator()
);


-- Only admins can add candidates.

create policy "candidates_insert_admin"
on public.candidates
for insert
to authenticated
with check (
  public.is_admin()
);


-- Only admins can modify candidates.
-- Our database trigger from migration 001 additionally
-- prevents modifications once the election is LIVE/CLOSED.

create policy "candidates_update_admin"
on public.candidates
for update
to authenticated
using (
  public.is_admin()
)
with check (
  public.is_admin()
);


-- Only admins can delete candidates.

create policy "candidates_delete_admin"
on public.candidates
for delete
to authenticated
using (
  public.is_admin()
);


-- ------------------------------------------------------------
-- 6. VOTERS
-- ------------------------------------------------------------

-- Staff can see voter participation status.
--
-- IMPORTANT:
-- The voters table contains NO candidate choice.

create policy "voters_select_staff"
on public.voters
for select
to authenticated
using (
  public.is_operator()
);


-- Only admins can directly create voter records.
-- The normal voter-generation process will eventually
-- use a controlled database function.

create policy "voters_insert_admin"
on public.voters
for insert
to authenticated
with check (
  public.is_admin()
);


-- IMPORTANT:
-- Operators are NOT allowed to directly update voters.
--
-- Voting/status transitions will later happen through
-- controlled PostgreSQL functions.

create policy "voters_update_admin"
on public.voters
for update
to authenticated
using (
  public.is_admin()
)
with check (
  public.is_admin()
);


create policy "voters_delete_admin"
on public.voters
for delete
to authenticated
using (
  public.is_admin()
);


-- ------------------------------------------------------------
-- 7. VOTES
-- ------------------------------------------------------------

-- There is deliberately NO SELECT policy for normal
-- authenticated users.
--
-- This means the application cannot simply query:
--
-- SELECT * FROM votes;
--
-- to obtain individual ballot records.

-- No direct INSERT policy.
--
-- Vote creation will happen through a secure transaction
-- function that we will create later.

-- No UPDATE policy.
-- Votes are immutable.

-- No DELETE policy.
-- Votes cannot be deleted through the normal application.


-- ------------------------------------------------------------
-- 8. AUDIT LOGS
-- ------------------------------------------------------------

-- Only admins can view audit logs.

create policy "audit_logs_select_admin"
on public.audit_logs
for select
to authenticated
using (
  public.is_admin()
);


-- No direct audit-log insertion from the browser.
--
-- Audit records will be created by controlled database
-- functions/server-side operations.

-- No UPDATE policy.
-- Audit records are immutable.

-- No DELETE policy.
-- Audit records cannot be deleted through the application.


-- ------------------------------------------------------------
-- 9. PRIVILEGES
-- ------------------------------------------------------------

-- Remove direct table privileges for anonymous users.

revoke all on public.profiles from anon;
revoke all on public.elections from anon;
revoke all on public.candidates from anon;
revoke all on public.voters from anon;
revoke all on public.votes from anon;
revoke all on public.audit_logs from anon;


-- Authenticated users will only be able to perform operations
-- allowed by the RLS policies above.

revoke all on public.votes from authenticated;
revoke all on public.audit_logs from authenticated;


-- ============================================================
-- END OF SECURITY MIGRATION
-- ============================================================