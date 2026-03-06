-- teams-channels N:M 관계 변경
-- teams.channel_id (N:1) → channel_teams junction table (N:M)

begin;

-- 1. channel_teams junction 테이블 생성
create table channel_teams (
  channel_id uuid not null references channels(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (channel_id, team_id)
);

-- 2. 기존 데이터 마이그레이션
insert into channel_teams (channel_id, team_id, last_used_at, created_at)
select channel_id, id, last_used_at, created_at from teams;

-- 3. teams 테이블에서 channel_id, last_used_at 제거
alter table teams drop column channel_id;
alter table teams drop column last_used_at;

-- 기존 인덱스 삭제
drop index if exists teams_unique_channel_name;
drop index if exists teams_channel_last_used_idx;

-- 4. 쿼리용 VIEW 생성
create or replace view channel_teams_view as
select ct.channel_id, t.id, t.name, ct.last_used_at, t.created_at, t.updated_at
from channel_teams ct
join teams t on t.id = ct.team_id;

-- 5. team_players unique index 변경 (채널별 로스터)
drop index if exists team_players_unique_number;
create unique index team_players_unique_channel_team_number
  on team_players (channel_id, team_id, jersey_no);

commit;
