-- Vote timestamps are not consumed by the application or aggregate results.
-- Removing this column prevents vote rows from being temporally correlated
-- with voter participation timestamps. This does not delete vote rows.
alter table public.votes
drop column created_at;
