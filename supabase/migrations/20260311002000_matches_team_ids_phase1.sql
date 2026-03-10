-- Phase 1: add nullable team ids to matches and backfill from existing team names
-- Safe migration: keeps team_a_name/team_b_name for backward compatibility

begin;

-- 1) Add columns
alter table public.matches
  add column if not exists team_a_id uuid null references public.teams(id) on delete set null,
  add column if not exists team_b_id uuid null references public.teams(id) on delete set null;

-- 2) Indexes
create index if not exists matches_team_a_id_idx on public.matches(team_a_id);
create index if not exists matches_team_b_id_idx on public.matches(team_b_id);

-- 3) Backfill by exact team name match
update public.matches m
set team_a_id = t.id
from public.teams t
where m.team_a_id is null
  and m.team_a_name = t.name;

update public.matches m
set team_b_id = t.id
from public.teams t
where m.team_b_id is null
  and m.team_b_name = t.name;

-- 4) ID distinct constraint (only when both ids are present)
alter table public.matches
  drop constraint if exists matches_team_ids_distinct_check;

alter table public.matches
  add constraint matches_team_ids_distinct_check
  check (
    team_a_id is null
    or team_b_id is null
    or team_a_id <> team_b_id
  );

commit;
