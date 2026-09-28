-- ============================================================
-- COLLEGE VOTING SYSTEM
-- Voter management privileges and roster generation
-- Migration: 006_voter_management.sql
-- ============================================================

-- RLS policies from 002_security.sql remain the authorization boundary:
-- staff may read voter status and only admins may insert or update voters.
-- PostgreSQL requires base privileges before it evaluates those policies.

grant select, insert, update
on table public.voters
to authenticated;

-- Generate all missing voter numbers for an editable election in one
-- transaction. Existing voter rows and their statuses are preserved.

create or replace function public.generate_election_voters(p_election_id uuid)
returns integer
language plpgsql
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
  from generate_series(1, election_record.total_voters) as voter_number
  on conflict (election_id, voter_number) do nothing;

  get diagnostics inserted_count = row_count;

  update public.elections
  set voters_generated_at = now()
  where id = election_record.id;

  return inserted_count;
end;
$$;

revoke all on function public.generate_election_voters(uuid) from public;
grant execute on function public.generate_election_voters(uuid) to authenticated;
