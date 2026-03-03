begin;

alter table match_groups
  add column if not exists entry_confirmed_at timestamptz null;

create table if not exists match_group_entries (
  id uuid primary key default gen_random_uuid(),
  match_group_id uuid not null references match_groups(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  player_id uuid not null references team_players(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index if not exists match_group_entries_unique_player
  on match_group_entries (match_group_id, team_id, player_id);
create index if not exists match_group_entries_group_team_idx
  on match_group_entries (match_group_id, team_id);

commit;
