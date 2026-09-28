-- ============================================================
-- COLLEGE VOTING SYSTEM
-- Election lifecycle integrity
-- Migration: 004_election_lifecycle_integrity.sql
-- ============================================================

-- Enforce lifecycle transitions at the database layer. This complements
-- the admin UI and server actions, so an authenticated admin cannot bypass
-- the election lifecycle through a direct table update.

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

create trigger elections_enforce_lifecycle
before update on public.elections
for each row
execute function public.enforce_election_lifecycle();
