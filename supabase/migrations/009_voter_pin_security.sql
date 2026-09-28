-- ============================================================
-- COLLEGE VOTING SYSTEM
-- Confidential voter PINs for anonymous voting
-- Migration: 009_voter_pin_security.sql
-- ============================================================

alter table public.voters
add column pin_hash text;

create table public.voter_pin_attempts (
  voter_id uuid primary key references public.voters(id) on delete cascade,
  attempt_count smallint not null default 0,
  window_started_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint voter_pin_attempts_count_valid
    check (attempt_count between 0 and 10)
);

alter table public.voter_pin_attempts enable row level security;
revoke all on table public.voter_pin_attempts from public, anon, authenticated;

-- Keep PIN hashes out of voter roster reads. RLS still determines which rows
-- authenticated users can read; these column grants expose no PIN material.
revoke select on table public.voters from authenticated;
grant select (
  id,
  election_id,
  voter_number,
  status,
  status_changed_at,
  status_changed_by,
  created_at
)
on table public.voters
to authenticated;

revoke insert, update on table public.voters from authenticated;
grant insert (election_id, voter_number)
on table public.voters
to authenticated;
grant update (status, status_changed_at, status_changed_by)
on table public.voters
to authenticated;

-- The roster generator writes voter rows on behalf of an authenticated admin.
-- It runs as its owner so the narrower browser INSERT grant remains in place.
create or replace function public.generate_election_voters(p_election_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  election_record public.elections%rowtype;
  inserted_count integer;
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required';
  end if;

  select *
  into election_record
  from public.elections
  where id = p_election_id
  for update;

  if not found then
    raise exception 'Election could not be found';
  end if;

  if election_record.status not in ('draft'::public.election_status, 'ready'::public.election_status) then
    raise exception 'Voters can only be generated while the election is Draft or Ready';
  end if;

  if election_record.total_voters < 1 then
    raise exception 'Configure at least one voter before generating the roster';
  end if;

  insert into public.voters (election_id, voter_number)
  select election_record.id, voter_number
  from pg_catalog.generate_series(1, election_record.total_voters) as voter_number
  on conflict (election_id, voter_number) do nothing;

  get diagnostics inserted_count = row_count;

  update public.elections
  set voters_generated_at = pg_catalog.now()
  where id = election_record.id;

  return inserted_count;
end;
$$;

revoke all on function public.generate_election_voters(uuid) from public;
grant execute on function public.generate_election_voters(uuid) to authenticated;

create or replace function public.consume_voter_pin_attempt(
  p_voter_id uuid,
  p_pin_valid boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_attempts smallint;
  current_window timestamptz;
  inserted_count integer;
  attempt_time timestamptz := pg_catalog.clock_timestamp();
begin
  insert into public.voter_pin_attempts (voter_id, attempt_count, window_started_at)
  values (
    p_voter_id,
    case when p_pin_valid then 0 else 1 end,
    attempt_time
  )
  on conflict (voter_id) do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count = 1 then
    return true;
  end if;

  select attempt.attempt_count, attempt.window_started_at
  into current_attempts, current_window
  from public.voter_pin_attempts as attempt
  where attempt.voter_id = p_voter_id
  for update;

  if not found then
    return false;
  end if;

  if current_window <= attempt_time - interval '15 minutes' then
    update public.voter_pin_attempts
    set attempt_count = case when p_pin_valid then 0 else 1 end,
        window_started_at = attempt_time
    where voter_id = p_voter_id;
    return true;
  end if;

  if current_attempts >= 10 then
    return false;
  end if;

  if p_pin_valid then
    return true;
  end if;

  update public.voter_pin_attempts
  set attempt_count = (attempt_count + 1)::smallint
  where voter_id = p_voter_id;

  return true;
end;
$$;

create or replace function public.verify_voter_pin(
  p_voter_pin text,
  p_pin_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  crypto_schema text;
  pin_matches boolean;
begin
  select namespace.nspname
  into crypto_schema
  from pg_catalog.pg_extension as extension
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = extension.extnamespace
  where extension.extname = 'pgcrypto';

  if crypto_schema is null then
    raise exception 'The pgcrypto extension is required to verify voter PINs';
  end if;

  execute pg_catalog.format(
    'select %1$I.crypt($1, coalesce($2, %1$I.gen_salt(''bf'', 12))) = $2',
    crypto_schema
  )
  into pin_matches
  using p_voter_pin, p_pin_hash;

  return coalesce(pin_matches, false);
end;
$$;

create or replace function public.issue_voter_pin(
  p_election_id uuid,
  p_voter_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  election_status public.election_status;
  voter_record public.voters%rowtype;
  crypto_schema text;
  random_bytes bytea;
  random_value bigint;
  voter_pin text;
  voter_pin_hash text;
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required';
  end if;

  select election.status
  into election_status
  from public.elections as election
  where election.id = p_election_id
  for update;

  if not found or election_status not in (
    'draft'::public.election_status,
    'ready'::public.election_status,
    'live'::public.election_status
  ) then
    raise exception 'PINs can only be issued while an election is Draft, Ready, or Live';
  end if;

  select *
  into voter_record
  from public.voters as voter
  where voter.id = p_voter_id
    and voter.election_id = p_election_id
  for update;

  if not found or voter_record.status <> 'pending'::public.voter_status then
    raise exception 'A PIN can only be issued to a pending voter';
  end if;

  select namespace.nspname
  into crypto_schema
  from pg_catalog.pg_extension as extension
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = extension.extnamespace
  where extension.extname = 'pgcrypto';

  if crypto_schema is null then
    raise exception 'The pgcrypto extension is required to issue voter PINs';
  end if;

  execute pg_catalog.format('select %I.gen_random_bytes(6)', crypto_schema)
  into random_bytes;

  random_value :=
      pg_catalog.get_byte(random_bytes, 0)::bigint * 1099511627776
    + pg_catalog.get_byte(random_bytes, 1)::bigint * 4294967296
    + pg_catalog.get_byte(random_bytes, 2)::bigint * 16777216
    + pg_catalog.get_byte(random_bytes, 3)::bigint * 65536
    + pg_catalog.get_byte(random_bytes, 4)::bigint * 256
    + pg_catalog.get_byte(random_bytes, 5)::bigint;

  voter_pin := pg_catalog.lpad((random_value % 1000000000000)::text, 12, '0');

  execute pg_catalog.format(
    'select %1$I.crypt($1, %1$I.gen_salt(''bf'', 12))',
    crypto_schema
  )
  into voter_pin_hash
  using voter_pin;

  update public.voters
  set pin_hash = voter_pin_hash
  where id = voter_record.id
    and election_id = p_election_id
    and status = 'pending'::public.voter_status;

  if not found then
    raise exception 'The voter is no longer pending';
  end if;

  delete from public.voter_pin_attempts
  where voter_id = voter_record.id;

  return voter_pin;
end;
$$;

create or replace function public.is_live_voter_eligible(
  p_voter_number integer,
  p_voter_pin text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  live_election_id uuid;
  live_count integer;
  voter_record public.voters%rowtype;
  pin_matches boolean;
begin
  if p_voter_number is null
     or p_voter_number < 1
     or p_voter_pin is null
     or p_voter_pin !~ '^[0-9]{12}$' then
    return false;
  end if;

  select count(*)
  into live_count
  from public.elections as election
  where election.status = 'live'::public.election_status;

  if live_count <> 1 then
    return false;
  end if;

  select election.id
  into live_election_id
  from public.elections as election
  where election.status = 'live'::public.election_status;

  select *
  into voter_record
  from public.voters as voter
  where voter.election_id = live_election_id
    and voter.voter_number = p_voter_number;

  if not found
     or voter_record.status <> 'pending'::public.voter_status
     or voter_record.pin_hash is null then
    perform public.verify_voter_pin(p_voter_pin, null);
    return false;
  end if;

  pin_matches := public.verify_voter_pin(p_voter_pin, voter_record.pin_hash);

  if not public.consume_voter_pin_attempt(voter_record.id, coalesce(pin_matches, false)) then
    return false;
  end if;

  return coalesce(pin_matches, false);
end;
$$;

create or replace function public.submit_anonymous_vote(
  p_voter_number integer,
  p_voter_pin text,
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
  pin_matches boolean;
begin
  if p_voter_number is null
     or p_voter_number < 1
     or p_voter_pin is null
     or p_voter_pin !~ '^[0-9]{12}$' then
    return 'ineligible';
  end if;

  select count(*)
  into live_count
  from public.elections as election
  where election.status = 'live'::public.election_status;

  if live_count <> 1 then
    return 'ineligible';
  end if;

  select election.id
  into live_election_id
  from public.elections as election
  where election.status = 'live'::public.election_status;

  select *
  into voter_record
  from public.voters as voter
  where voter.election_id = live_election_id
    and voter.voter_number = p_voter_number
  for update;

  if not found
     or voter_record.status <> 'pending'::public.voter_status
     or voter_record.pin_hash is null then
    perform public.verify_voter_pin(p_voter_pin, null);
    return 'ineligible';
  end if;

  pin_matches := public.verify_voter_pin(p_voter_pin, voter_record.pin_hash);

  if not public.consume_voter_pin_attempt(voter_record.id, coalesce(pin_matches, false)) then
    return 'ineligible';
  end if;

  if not coalesce(pin_matches, false) then
    return 'ineligible';
  end if;

  if p_skip then
    if p_candidate_id is not null or p_is_nota then
      raise exception 'Skip cannot be combined with a ballot selection';
    end if;

    update public.voters
    set status = 'skipped'::public.voter_status,
        status_changed_at = pg_catalog.now(),
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
    from public.candidates as candidate
    where candidate.id = p_candidate_id
      and candidate.election_id = live_election_id
      and candidate.is_active = true
  ) then
    raise exception 'Selected candidate is not available';
  end if;

  insert into public.votes (election_id, candidate_id, is_nota)
  values (live_election_id, p_candidate_id, p_is_nota);

  update public.voters
  set status = 'voted'::public.voter_status,
      status_changed_at = pg_catalog.now(),
      status_changed_by = null
  where id = voter_record.id;

  return 'voted';
end;
$$;

revoke all on function public.consume_voter_pin_attempt(uuid, boolean) from public, anon, authenticated;
revoke all on function public.verify_voter_pin(text, text) from public, anon, authenticated;
revoke all on function public.issue_voter_pin(uuid, uuid) from public, anon, authenticated;
revoke all on function public.is_live_voter_eligible(integer) from public, anon, authenticated;
revoke all on function public.is_live_voter_eligible(integer, text) from public;
revoke all on function public.submit_anonymous_vote(integer, uuid, boolean, boolean) from public, anon, authenticated;
revoke all on function public.submit_anonymous_vote(integer, text, uuid, boolean, boolean) from public;

grant execute on function public.issue_voter_pin(uuid, uuid) to authenticated;
grant execute on function public.is_live_voter_eligible(integer, text) to anon, authenticated;
grant execute on function public.submit_anonymous_vote(integer, text, uuid, boolean, boolean) to anon, authenticated;
