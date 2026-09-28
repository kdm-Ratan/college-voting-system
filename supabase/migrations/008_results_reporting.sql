-- ============================================================
-- COLLEGE VOTING SYSTEM
-- Admin-only aggregate election results
-- Migration: 008_results_reporting.sql
-- ============================================================

-- Return aggregate results only for a closed election. This function does not
-- expose vote rows or connect a vote to a voter identity.

create or replace function public.get_election_results(p_election_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  election_title text;
  registered_voters bigint;
  votes_cast bigint;
  pending_voters bigint;
  skipped_voters bigint;
  absent_voters bigint;
  nota_votes bigint;
  turnout_percentage numeric;
  candidate_results jsonb;
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required';
  end if;

  if p_election_id is null then
    raise exception 'An election is required';
  end if;

  select election.title
  into election_title
  from public.elections as election
  where election.id = p_election_id
    and election.status = 'closed'::public.election_status;

  if not found then
    raise exception 'Final results are available only for a closed election';
  end if;

  select
    count(*),
    count(*) filter (where voter.status = 'pending'::public.voter_status),
    count(*) filter (where voter.status = 'skipped'::public.voter_status),
    count(*) filter (where voter.status = 'absent'::public.voter_status)
  into
    registered_voters,
    pending_voters,
    skipped_voters,
    absent_voters
  from public.voters as voter
  where voter.election_id = p_election_id;

  select count(*)
  into votes_cast
  from public.votes as vote
  where vote.election_id = p_election_id;

  select count(*)
  into nota_votes
  from public.votes as vote
  where vote.election_id = p_election_id
    and vote.is_nota = true;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'candidate_id', candidate.id,
        'name', candidate.name,
        'symbol_key', candidate.symbol_key,
        'color', candidate.color,
        'votes', candidate_totals.vote_count,
        'percentage',
          case
            when votes_cast = 0 then 0
            else round(candidate_totals.vote_count::numeric * 100 / votes_cast, 2)
          end
      )
      order by candidate.display_order
    ),
    '[]'::jsonb
  )
  into candidate_results
  from public.candidates as candidate
  cross join lateral (
    select count(*) as vote_count
    from public.votes as vote
    where vote.election_id = p_election_id
      and vote.candidate_id = candidate.id
      and vote.is_nota = false
  ) as candidate_totals
  where candidate.election_id = p_election_id;

  turnout_percentage := case
    when registered_voters = 0 then 0
    else round(votes_cast::numeric * 100 / registered_voters, 2)
  end;

  return jsonb_build_object(
    'election_id', p_election_id,
    'election_title', election_title,
    'registered_voters', registered_voters,
    'votes_cast', votes_cast,
    'pending_voters', pending_voters,
    'skipped_voters', skipped_voters,
    'absent_voters', absent_voters,
    'turnout_percentage', turnout_percentage,
    'nota_votes', nota_votes,
    'nota_percentage',
      case
        when votes_cast = 0 then 0
        else round(nota_votes::numeric * 100 / votes_cast, 2)
      end,
    'candidates', candidate_results
  );
end;
$$;

revoke all on function public.get_election_results(uuid) from public, anon, authenticated;
grant execute on function public.get_election_results(uuid) to authenticated;
