begin;

create table if not exists match_group_guests (
  id uuid primary key default gen_random_uuid(),
  match_group_id uuid not null references match_groups(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  source_team_id uuid not null references teams(id) on delete cascade,
  source_player_id uuid null references team_players(id) on delete set null,
  guest_name text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists match_group_guests_unique_team
  on match_group_guests (match_group_id, team_id);
create index if not exists match_group_guests_group_idx
  on match_group_guests (match_group_id);

commit;
