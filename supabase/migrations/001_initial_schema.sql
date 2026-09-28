-- ============================================================
-- COLLEGE VOTING SYSTEM
-- Initial Database Schema
-- Migration: 001_initial_schema.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. EXTENSIONS
-- ------------------------------------------------------------

create extension if not exists pgcrypto;


-- ------------------------------------------------------------
-- 2. ENUM TYPES
-- ------------------------------------------------------------

create type public.user_role as enum (
  'admin',
  'operator'
);

create type public.election_status as enum (
  'draft',
  'ready',
  'live',
  'closed'
);

create type public.voter_status as enum (
  'pending',
  'skipped',
  'absent',
  'voted'
);


-- ------------------------------------------------------------
-- 3. UPDATED_AT HELPER
-- ------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ------------------------------------------------------------
-- 4. PROFILES
-- Linked to Supabase Auth users
-- ------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,

  role public.user_role not null default 'operator',

  display_name text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_display_name_not_empty
    check (length(trim(display_name)) > 0)
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();


-- ------------------------------------------------------------
-- 5. ELECTIONS
-- ------------------------------------------------------------

create table public.elections (
  id uuid primary key default gen_random_uuid(),

  title text not null,
  description text,

  status public.election_status not null default 'draft',

  total_voters integer not null default 0,

  voters_generated_at timestamptz,

  started_at timestamptz,
  ended_at timestamptz,

  created_by uuid references public.profiles(id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint elections_title_not_empty
    check (length(trim(title)) > 0),

  constraint elections_total_voters_non_negative
    check (total_voters >= 0),

  constraint elections_dates_valid
    check (
      ended_at is null
      or started_at is null
      or ended_at >= started_at
    )
);

create index elections_status_idx
on public.elections(status);

create index elections_created_by_idx
on public.elections(created_by);

create trigger elections_set_updated_at
before update on public.elections
for each row
execute function public.set_updated_at();


-- ------------------------------------------------------------
-- 6. CANDIDATES
-- ------------------------------------------------------------

create table public.candidates (
  id uuid primary key default gen_random_uuid(),

  election_id uuid not null
    references public.elections(id) on delete cascade,

  name text not null,

  -- Identifier for the visual symbol/pattern.
  -- Example: circle, star, lotus, book, etc.
  symbol_key text not null,

  -- CSS-compatible/display color.
  -- Example: #2563EB
  color text not null,

  display_order integer not null default 0,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint candidates_name_not_empty
    check (length(trim(name)) > 0),

  constraint candidates_symbol_not_empty
    check (length(trim(symbol_key)) > 0),

  constraint candidates_color_not_empty
    check (length(trim(color)) > 0),

  constraint candidates_display_order_non_negative
    check (display_order >= 0),

  constraint candidates_unique_name_per_election
    unique (election_id, name),

  constraint candidates_unique_order_per_election
    unique (election_id, display_order),

  -- Needed for the composite FK used by votes.
  constraint candidates_id_election_unique
    unique (id, election_id)
);

create index candidates_election_idx
on public.candidates(election_id);

create trigger candidates_set_updated_at
before update on public.candidates
for each row
execute function public.set_updated_at();


-- ------------------------------------------------------------
-- 7. VOTERS
-- ------------------------------------------------------------

create table public.voters (
  id uuid primary key default gen_random_uuid(),

  election_id uuid not null
    references public.elections(id) on delete cascade,

  voter_number integer not null,

  status public.voter_status not null default 'pending',

  status_changed_at timestamptz,
  status_changed_by uuid
    references public.profiles(id) on delete restrict,

  created_at timestamptz not null default now(),

  constraint voters_voter_number_positive
    check (voter_number > 0),

  constraint voters_unique_number_per_election
    unique (election_id, voter_number),

  -- Needed for composite relationships.
  constraint voters_id_election_unique
    unique (id, election_id)
);

create index voters_election_status_idx
on public.voters(election_id, status);

create index voters_election_number_idx
on public.voters(election_id, voter_number);


-- ------------------------------------------------------------
-- 8. VOTES
--
-- IMPORTANT:
-- There is intentionally NO voter_id here.
--
-- This prevents a direct database relationship between:
--
--     Voter #123 -> Candidate A
--
-- A vote is associated with an election and either:
--     1. a candidate
--     2. NOTA
-- ------------------------------------------------------------

create table public.votes (
  id uuid primary key default gen_random_uuid(),

  election_id uuid not null
    references public.elections(id) on delete restrict,

  candidate_id uuid,

  is_nota boolean not null default false,

  created_at timestamptz not null default now(),

  constraint votes_nota_or_candidate
    check (
      (is_nota = true and candidate_id is null)
      or
      (is_nota = false and candidate_id is not null)
    ),

  -- Ensures the candidate belongs to the SAME election
  -- as the vote.
  constraint votes_candidate_same_election_fk
    foreign key (candidate_id, election_id)
    references public.candidates(id, election_id)
    on delete restrict
);

create index votes_election_idx
on public.votes(election_id);

create index votes_candidate_idx
on public.votes(candidate_id);

create index votes_election_nota_idx
on public.votes(election_id, is_nota);


-- ------------------------------------------------------------
-- 9. AUDIT LOGS
-- ------------------------------------------------------------

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),

  election_id uuid
    references public.elections(id) on delete restrict,

  actor_id uuid
    references public.profiles(id) on delete restrict,

  action text not null,

  -- Used for actions such as:
  -- voter.mark_absent
  -- voter.skip
  -- voter.vote
  --
  -- This stores the voter number when operationally necessary.
  -- It MUST NOT contain the candidate choice.
  voter_number integer,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint audit_action_not_empty
    check (length(trim(action)) > 0),

  constraint audit_voter_number_positive
    check (
      voter_number is null
      or voter_number > 0
    )
);

create index audit_logs_election_idx
on public.audit_logs(election_id);

create index audit_logs_actor_idx
on public.audit_logs(actor_id);

create index audit_logs_created_at_idx
on public.audit_logs(created_at);


-- ------------------------------------------------------------
-- 10. BASIC DATA-INTEGRITY TRIGGER
--
-- Prevent candidate modifications once voting has started.
-- ------------------------------------------------------------

create or replace function public.prevent_candidate_changes_after_live()
returns trigger
language plpgsql
as $$
declare
  election_current_status public.election_status;
begin

  select status
  into election_current_status
  from public.elections
  where id = coalesce(new.election_id, old.election_id);

  if election_current_status in ('live', 'closed') then
    raise exception
      'Candidates cannot be modified after the election becomes LIVE';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger candidates_prevent_changes_after_live
before insert or update or delete on public.candidates
for each row
execute function public.prevent_candidate_changes_after_live();


-- ------------------------------------------------------------
-- 11. PREVENT VOTER NUMBER CHANGES AFTER ELECTION STARTS
--
-- Status changes will still be allowed.
-- Only the identity/number of a voter is protected.
-- ------------------------------------------------------------

create or replace function public.prevent_voter_identity_changes_after_live()
returns trigger
language plpgsql
as $$
declare
  election_current_status public.election_status;
begin

  select status
  into election_current_status
  from public.elections
  where id = coalesce(new.election_id, old.election_id);

  if election_current_status in ('live', 'closed') then

    if new.election_id <> old.election_id
       or new.voter_number <> old.voter_number then

      raise exception
        'Voter identity cannot be changed after the election starts';

    end if;

  end if;

  return new;
end;
$$;

create trigger voters_prevent_identity_changes_after_live
before update on public.voters
for each row
execute function public.prevent_voter_identity_changes_after_live();


-- ------------------------------------------------------------
-- 12. PREVENT VOTE INSERTION INTO NON-LIVE ELECTIONS
-- ------------------------------------------------------------

create or replace function public.prevent_invalid_vote_insert()
returns trigger
language plpgsql
as $$
declare
  election_current_status public.election_status;
begin

  select status
  into election_current_status
  from public.elections
  where id = new.election_id;

  if election_current_status <> 'live' then
    raise exception
      'Votes can only be recorded while the election is LIVE';
  end if;

  return new;
end;
$$;

create trigger votes_only_during_live_election
before insert on public.votes
for each row
execute function public.prevent_invalid_vote_insert();


-- ------------------------------------------------------------
-- 13. COMMENTS FOR IMPORTANT SECURITY INVARIANTS
-- ------------------------------------------------------------

comment on table public.votes is
'Anonymous ballot records. Deliberately contains no voter_id.';

comment on column public.votes.candidate_id is
'Candidate selected by the anonymous ballot. NULL means NOTA.';

comment on table public.voters is
'Tracks voter participation/status. Does not store the voter choice.';

comment on table public.audit_logs is
'Administrative/operational audit trail. Must never store candidate choice alongside voter identity.';


-- ============================================================
-- END OF INITIAL SCHEMA
-- ============================================================