begin;

-- Legacy table is no longer used after migration to match_period_lineups + match_substitutions.
drop table if exists public.match_participation_events;

commit;
