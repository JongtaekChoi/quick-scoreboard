begin;

create table if not exists player_ratings (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  match_id uuid not null references matches(id) on delete cascade,
  target_player_id uuid not null references team_players(id) on delete cascade,
  target_team_id uuid not null references teams(id) on delete cascade,
  rater_team_id uuid not null references teams(id) on delete cascade,
  rater_fingerprint text not null,
  rating numeric(2,1) not null check (rating between 1 and 5 and mod((rating * 10)::int, 5) = 0),
  created_at timestamptz not null default now()
);

create unique index if not exists player_ratings_unique_rater
  on player_ratings (match_id, target_player_id, rater_fingerprint);
create index if not exists player_ratings_match_target_idx on player_ratings (match_id, target_player_id);
create index if not exists player_ratings_channel_created_idx on player_ratings (channel_id, created_at desc);

commit;
