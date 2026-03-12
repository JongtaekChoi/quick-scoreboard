begin;

alter table public.match_participation_events
  add column if not exists is_starter boolean not null default false;

create index if not exists mpe_match_starter_idx
  on public.match_participation_events (match_id, team_side, is_starter)
  where deleted_at is null;

commit;
