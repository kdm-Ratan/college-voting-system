-- ============================================================
-- COLLEGE VOTING SYSTEM
-- Anonymous voter-facing ballot RPCs
-- Migration: 007_anonymous_voting.sql
-- ============================================================

-- Prevent new elections from being inserted directly as LIVE. The existing
-- lifecycle trigger continues to govern updates.

create or replace function public.prevent_non_draft_election_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'draft'::public.election_status then
    raise exception 'New elections must be created in DRAFT status';
  end if;

  return new;
end;
$$;

create trigger elections_require_draft_on_insert
before insert on public.elections
for each row
execute function public.prevent_non_draft_election_insert();

-- Extend the existing lifecycle function with a transaction advisory lock.
-- This prevents two concurrent READY -> LIVE updates from producing two
-- simultaneously live elections.

create or replace function public.enforce_election_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = old.status then
    if old.status = 'closed'
       and (
         new.title is distinct from old.title
         or new.description is distinct from old.description
         or new.total_voters is distinct from old.total_voters
         or new.started_at is distinct from old.started_at
         or new.ended_at is distinct from old.ended_at
       ) then
      raise exception 'Closed elections cannot be changed';
    end if;

    return new;
  end if;

  if not (
    (old.status = 'draft'::public.election_status and new.status = 'ready'::public.election_status)
    or (old.status = 'ready'::public.election_status and new.status = 'draft'::public.election_status)
    or (old.status = 'ready'::public.election_status and new.status = 'live'::public.election_status)
    or (old.status = 'live'::public.election_status and new.status = 'closed'::public.election_status)
  ) then
    raise exception 'Invalid election status transition from % to %', old.status, new.status;
  end if;

  if new.status = 'live'::public.election_status then
    perform pg_advisory_xact_lock(73219401);

    if exists (
      select 1
      from public.elections
      where status = 'live'::public.election_status
        and id <> old.id
    ) then
      raise exception 'Another election is already LIVE';
    end if;

    if new.total_voters < 1 then
      raise exception 'An election needs at least one configured voter before it can go LIVE';
    end if;

    new.started_at := now();
    new.ended_at := null;
  elsif new.status = 'closed'::public.election_status then
    new.ended_at := now();
  end if;

  return new;
end;
$$;

-- Return only the public ballot for the single LIVE election. Active
-- candidate details are intentionally exposed; voter and vote records are not.

create or replace function public.get_live_ballot()
returns table (
  election_id uuid,
  election_title text,
  candidates jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  live_election public.elections%rowtype;
  live_count integer;
begin
  select count(*)
  into live_count
  from public.elections
  where status = 'live'::public.election_status;

  if live_count = 0 then
    return;
  end if;

  if live_count > 1 then
    raise exception 'Voting is unavailable because multiple elections are LIVE';
  end if;

  select *
  into live_election
  from public.elections
  where status = 'live'::public.election_status;

  return query
  select
    live_election.id,
    live_election.title,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', candidate.id,
          'name', candidate.name,
          'symbol_key', candidate.symbol_key,
          'color', candidate.color,
          'display_order', candidate.display_order
        )
        order by candidate.display_order
      ) filter (where candidate.id is not null),
      '[]'::jsonb
    )
  from public.candidates as candidate
  where candidate.election_id = live_election.id
    and candidate.is_active = true;
end;
$$;

-- Check only whether a number can proceed to the ballot. It returns no voter
-- status and does not reveal a voter identity or vote choice.

create or replace function public.is_live_voter_eligible(p_voter_number integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  live_election_id uuid;
  live_count integer;
begin
  if p_voter_number is null or p_voter_number < 1 then
    return false;
  end if;

  select count(*)
  into live_count
  from public.elections
  where status = 'live'::public.election_status;

  if live_count <> 1 then
    return false;
  end if;

  select id
  into live_election_id
  from public.elections
  where status = 'live'::public.election_status;

  return exists (
    select 1
    from public.voters
    where election_id = live_election_id
      and voter_number = p_voter_number
      and status = 'pending'::public.voter_status
  );
end;
$$;

-- Submit a ballot or Skip atomically. The voter row is locked before checking
-- eligibility. The vote insert deliberately contains no voter identifier.

create or replace function public.submit_anonymous_vote(
  p_voter_number integer,
  p_candidate_id uuid default null,
  p_is_nota boolean default false,
  p_skip boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  live_election_id uuid;
  live_count integer;
  voter_record public.voters%rowtype;
begin
  if p_voter_number is null or p_voter_number < 1 then
    raise exception 'Voter number is not eligible';
  end if;

  select count(*)
  into live_count
  from public.elections
  where status = 'live'::public.election_status;

  if live_count <> 1 then
    raise exception 'Voting is not available';
  end if;

  select id
  into live_election_id
  from public.elections
  where status = 'live'::public.election_status;

  select *
  into voter_record
  from public.voters
  where election_id = live_election_id
    and voter_number = p_voter_number
  for update;

  if not found or voter_record.status <> 'pending'::public.voter_status then
    raise exception 'Voter number is not eligible';
  end if;

  if p_skip then
    if p_candidate_id is not null or p_is_nota then
      raise exception 'Skip cannot be combined with a ballot selection';
    end if;

    update public.voters
    set status = 'skipped'::public.voter_status,
        status_changed_at = now(),
        status_changed_by = null
    where id = voter_record.id;

    return 'skipped';
  end if;

  if (p_is_nota and p_candidate_id is not null)
     or (not p_is_nota and p_candidate_id is null) then
    raise exception 'Choose one candidate or NOTA';
  end if;

  if not p_is_nota and not exists (
    select 1
    from public.candidates
    where id = p_candidate_id
      and election_id = live_election_id
      and is_active = true
  ) then
    raise exception 'Selected candidate is not available';
  end if;

  insert into public.votes (election_id, candidate_id, is_nota)
  values (live_election_id, p_candidate_id, p_is_nota);

  update public.voters
  set status = 'voted'::public.voter_status,
      status_changed_at = now(),
      status_changed_by = null
  where id = voter_record.id;

  return 'voted';
end;
$$;

revoke all on function public.get_live_ballot() from public;
revoke all on function public.is_live_voter_eligible(integer) from public;
revoke all on function public.submit_anonymous_vote(integer, uuid, boolean, boolean) from public;

grant execute on function public.get_live_ballot() to anon, authenticated;
grant execute on function public.is_live_voter_eligible(integer) to anon, authenticated;
grant execute on function public.submit_anonymous_vote(integer, uuid, boolean, boolean) to anon, authenticated;
