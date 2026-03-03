begin;

create table if not exists team_players (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  jersey_no text not null,
  player_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists team_players_unique_number
  on team_players (team_id, jersey_no);
create index if not exists team_players_team_active_idx
  on team_players (team_id, is_active, jersey_no);

commit;
