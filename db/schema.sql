-- quick-scoreboard DB schema (MVP v1)
-- Postgres / Supabase compatible

begin;

-- Optional extension for UUID generation
create extension if not exists pgcrypto;

-- 1) Channel (리그/모임 단위)
create table if not exists channels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  is_public_view boolean not null default false,

  -- 로그인 대신 채널 편집 비밀번호 해시 저장
  -- (argon2/bcrypt 등 앱 레이어에서 생성한 해시 문자열)
  edit_password_hash text not null,
  edit_session_version int not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists channels_name_idx on channels (name);

-- 1.5) 팀 마스터(채널 내 빠른 입력/추천용)
create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  name text not null,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists teams_unique_channel_name on teams (channel_id, name);
create index if not exists teams_channel_last_used_idx on teams (channel_id, last_used_at desc);

-- 2) 비공개 링크 토큰(뷰/에딧)
-- raw token은 저장하지 않고 hash만 저장
create table if not exists channel_share_links (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  mode text not null check (mode in ('view', 'edit')),
  token_hash text not null unique,
  expires_at timestamptz null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists channel_share_links_channel_idx on channel_share_links (channel_id, mode);
create index if not exists channel_share_links_expires_idx on channel_share_links (expires_at);

-- 3) 경기 그룹 (같은 날짜/구장 묶음)
create table if not exists match_groups (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  play_date date not null,
  venue text null,
  title text null,
  note text null,
  seq int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists match_groups_channel_date_idx on match_groups (channel_id, play_date desc);
create unique index if not exists match_groups_unique_channel_date_venue_seq
  on match_groups (channel_id, play_date, coalesce(venue, ''), seq);

-- 4) 경기
create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  match_group_id uuid null references match_groups(id) on delete set null,

  seq int not null,
  team_a_name text not null,
  team_b_name text not null,

  score_a int not null default 0,
  score_b int not null default 0,

  status text not null default 'live' check (status in ('scheduled', 'live', 'ended')),
  scheduled_start_at timestamptz null,
  started_at timestamptz null,
  ended_at timestamptz null,
  note text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint matches_team_distinct check (team_a_name <> team_b_name)
);

create index if not exists matches_channel_created_idx on matches (channel_id, created_at desc);
create index if not exists matches_group_seq_idx on matches (match_group_id, seq);
create index if not exists matches_scheduled_start_idx on matches (status, scheduled_start_at);

-- 5) 골 이벤트 (append-first, 나중 보정)
create table if not exists goal_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,

  team_side text not null check (team_side in ('A', 'B')),
  minute int null,

  scorer_no text null,
  scorer_name text null,
  assist_no text null,
  assist_name text null,

  is_own_goal boolean not null default false,
  note text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index if not exists goal_events_match_created_idx on goal_events (match_id, created_at asc);
create index if not exists goal_events_match_deleted_idx on goal_events (match_id, deleted_at);

-- 6) 경기 내 추천 사전 (번호/이름 자동완성)
create table if not exists match_player_aliases (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  jersey_no text null,
  player_name text null,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists match_player_aliases_match_last_used_idx
  on match_player_aliases (match_id, last_used_at desc);

create unique index if not exists match_player_aliases_unique_pair
  on match_player_aliases (match_id, coalesce(jersey_no, ''), coalesce(player_name, ''));

-- updated_at auto trigger
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_channels_set_updated_at on channels;
create trigger trg_channels_set_updated_at
before update on channels
for each row execute procedure set_updated_at();

drop trigger if exists trg_match_groups_set_updated_at on match_groups;
create trigger trg_match_groups_set_updated_at
before update on match_groups
for each row execute procedure set_updated_at();

drop trigger if exists trg_matches_set_updated_at on matches;
create trigger trg_matches_set_updated_at
before update on matches
for each row execute procedure set_updated_at();

drop trigger if exists trg_goal_events_set_updated_at on goal_events;
create trigger trg_goal_events_set_updated_at
before update on goal_events
for each row execute procedure set_updated_at();

drop trigger if exists trg_teams_set_updated_at on teams;
create trigger trg_teams_set_updated_at
before update on teams
for each row execute procedure set_updated_at();

commit;
