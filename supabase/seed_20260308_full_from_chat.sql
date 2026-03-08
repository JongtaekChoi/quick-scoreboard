-- Seed v3 (chat 3915 기준): 팀/선수 + 엔트리 + 경기/득점
-- 채널 slug 기본값: sample
-- 실행 전 필요 시 v_channel_slug, v_play_date만 수정

begin;

do $$
declare
  v_channel_slug text := 'sls2026';
  v_play_date date := date '2026-03-08';
  v_group_title text := '2026-03-08 리그 기록';
  v_channel_id uuid;
  v_group_id uuid;
begin
  select id into v_channel_id from channels where slug = v_channel_slug;
  if v_channel_id is null then
    insert into channels (name, slug, is_public_view, edit_password_hash, edit_session_version)
    values ('SLS 2026', v_channel_slug, true, md5('sls2026'), 1)
    returning id into v_channel_id;
  end if;

  -- 1) 팀
  insert into teams (name)
  values
    ('변진석'),
    ('젊은피'),
    ('WithlordFC'),
    ('Dark lumos'),
    ('SLS JovenesFC Black'),
    ('SLS JovenesFC White'),
    ('FC 모23')
  on conflict do nothing;

  -- 2) 채널-팀 연결
  insert into channel_teams (channel_id, team_id)
  select v_channel_id, t.id
  from teams t
  where t.name in (
    '변진석','젊은피','WithlordFC','Dark lumos',
    'SLS JovenesFC Black','SLS JovenesFC White','FC 모23'
  )
  on conflict (channel_id, team_id)
  do update set last_used_at = now();

  -- 3) 팀 선수 마스터
  with tp(team_name, jersey_no, player_name) as (
    values
      ('변진석','0','변진석'),('변진석','1','오동녘어진이'),('변진석','2','구정환'),('변진석','3','이주영'),('변진석','4','차경인'),('변진석','5','김영기'),('변진석','6','허준행'),('변진석','7','김성학'),('변진석','8','김성호'),('변진석','9','김주찬'),('변진석','10','김동찬'),
      ('젊은피','1','류현우'),('젊은피','2','안기환'),('젊은피','3','유지원'),('젊은피','4','이영섭'),('젊은피','5','이윤섭'),('젊은피','6','장준영'),('젊은피','7','정호성'),('젊은피','8','주상현'),('젊은피','9','현동욱'),
      ('WithlordFC','0','신주찬'),('WithlordFC','1','김규훈'),('WithlordFC','2','박민호'),('WithlordFC','3','조동건'),('WithlordFC','4','이민형'),('WithlordFC','5','이성하'),('WithlordFC','6','백승원'),('WithlordFC','7','손여산'),('WithlordFC','8','김동혁'),('WithlordFC','9','김유현'),('WithlordFC','99','이주환'),
      ('Dark lumos','1','정지환'),('Dark lumos','2','김민제'),('Dark lumos','3','조한빛'),('Dark lumos','4','정종빈'),('Dark lumos','5','이정한'),('Dark lumos','6','신홍균'),('Dark lumos','7','정민규'),('Dark lumos','8','강시온'),('Dark lumos','9','신성욱'),('Dark lumos','10','권이혁'),
      ('SLS JovenesFC Black','03','김재철'),('SLS JovenesFC Black','10','김남운'),('SLS JovenesFC Black','11','유정곤'),('SLS JovenesFC Black','13','최상준'),('SLS JovenesFC Black','17','김화평'),('SLS JovenesFC Black','37','최종택'),('SLS JovenesFC Black','55','서청원'),('SLS JovenesFC Black','82','옥지호'),
      ('SLS JovenesFC White','4','임재호'),('SLS JovenesFC White','7','진동석'),('SLS JovenesFC White','8','김영근'),('SLS JovenesFC White','9','백명수'),('SLS JovenesFC White','15','김형기'),('SLS JovenesFC White','16','김찬정'),('SLS JovenesFC White','19','최성락'),('SLS JovenesFC White','21','송진한'),('SLS JovenesFC White','66','이종원'),('SLS JovenesFC White','77','김금성'),
      ('FC 모23','3','전세영'),('FC 모23','4','오슬기'),('FC 모23','7','정요한'),('FC 모23','8','장인혁'),('FC 모23','10','김기환'),('FC 모23','11','김범래'),('FC 모23','20','조수형'),('FC 모23','21','오세윤'),('FC 모23','23','황영규'),('FC 모23','41','김한중'),('FC 모23','91','김규원'),('FC 모23','99','이동수')
  )
  insert into team_players (channel_id, team_id, jersey_no, player_name, is_active)
  select v_channel_id, t.id, tp.jersey_no, tp.player_name, true
  from tp
  join teams t on t.name = tp.team_name
  on conflict (channel_id, team_id, jersey_no)
  do update set player_name = excluded.player_name, is_active = true, updated_at = now();

  -- 4) 그룹 생성
  insert into match_groups (channel_id, play_date, title, seq, entry_confirmed_at)
  values (
    v_channel_id,
    v_play_date,
    v_group_title,
    coalesce((select max(seq)+1 from match_groups where channel_id=v_channel_id and play_date=v_play_date),1),
    now()
  )
  returning id into v_group_id;

  -- 5) 엔트리 (요청 본문 기준)
  with entry_rows(team_name, jersey_no) as (
    values
      -- FC 모23
      ('FC 모23','3'),('FC 모23','7'),('FC 모23','8'),('FC 모23','10'),('FC 모23','11'),('FC 모23','20'),('FC 모23','21'),('FC 모23','23'),('FC 모23','41'),('FC 모23','91'),('FC 모23','99'),
      -- Black
      ('SLS JovenesFC Black','17'),('SLS JovenesFC Black','55'),('SLS JovenesFC Black','11'),('SLS JovenesFC Black','13'),('SLS JovenesFC Black','37'),('SLS JovenesFC Black','77'),
      -- 젊은피
      ('젊은피','1'),('젊은피','3'),('젊은피','4'),('젊은피','5'),('젊은피','7'),('젊은피','8'),('젊은피','9'),
      -- WithlordFC
      ('WithlordFC','1'),('WithlordFC','4'),('WithlordFC','5'),('WithlordFC','7'),('WithlordFC','0'),('WithlordFC','99'),
      -- Dark lumos
      ('Dark lumos','2'),('Dark lumos','3'),('Dark lumos','4'),('Dark lumos','5'),('Dark lumos','6'),('Dark lumos','8'),('Dark lumos','9'),('Dark lumos','10')
  )
  insert into match_group_entries (match_group_id, channel_id, team_id, player_id)
  select v_group_id, v_channel_id, t.id, tp.id
  from entry_rows e
  join teams t on t.name = e.team_name
  join team_players tp on tp.channel_id=v_channel_id and tp.team_id=t.id and tp.jersey_no=e.jersey_no and tp.is_active
  on conflict (match_group_id, team_id, player_id) do nothing;

  -- 6) 경기 생성 (표기 alias 정규화: Withload->WithlordFC, JovenesFC Black->SLS JovenesFC Black)
  with m(seq, team_a_name, team_b_name, score_a, score_b) as (
    values
      (1, 'WithlordFC', 'SLS JovenesFC Black', 4, 0),
      (2, 'FC 모23', 'SLS JovenesFC Black', 4, 3),
      (3, 'WithlordFC', 'FC 모23', 5, 0),
      (4, '젊은피', '변진석', 5, 0),
      (5, '젊은피', 'Dark lumos', 4, 1),
      (6, '변진석', 'Dark lumos', 0, 4)
  )
  insert into matches (channel_id, match_group_id, seq, team_a_name, team_b_name, score_a, score_b, status, started_at, ended_at)
  select v_channel_id, v_group_id, seq, team_a_name, team_b_name, score_a, score_b, 'ended', now(), now()
  from m;

  -- 7) 득점/어시스트
  -- seq1: WithlordFC 4-0 Black
  insert into goal_events (match_id, team_side, scorer_name, scorer_player_id, assist_name, assist_player_id)
  select m.id, 'A', x.s_name,
         (select tp.id from team_players tp join teams t on t.id=tp.team_id where tp.channel_id=v_channel_id and t.name='WithlordFC' and tp.player_name=x.s_lookup limit 1),
         x.a_name,
         (select tp.id from team_players tp join teams t on t.id=tp.team_id where tp.channel_id=v_channel_id and t.name='WithlordFC' and tp.player_name=x.a_lookup limit 1)
  from matches m
  join lateral (
    values
      ('손여산','손여산','이민형','이민형'),
      ('손여산','손여산',null,null),
      ('이성하','이성하',null,null),
      ('김규훈','김규훈','신주찬','신주찬')
  ) x(s_name, s_lookup, a_name, a_lookup) on true
  where m.match_group_id=v_group_id and m.seq=1;

  -- seq2: 모23 4-3 Black
  insert into goal_events (match_id, team_side, scorer_name, scorer_player_id, assist_name, assist_player_id)
  select m.id, x.side, x.s_name,
         (select tp.id from team_players tp join teams t on t.id=tp.team_id where tp.channel_id=v_channel_id and t.name=x.team_name and tp.player_name=x.s_lookup limit 1),
         x.a_name,
         (select tp.id from team_players tp join teams t on t.id=tp.team_id where tp.channel_id=v_channel_id and t.name=x.team_name and tp.player_name=x.a_lookup limit 1)
  from matches m
  join lateral (
    values
      ('A','FC 모23','전세영','전세영','정요한','정요한'),
      ('A','FC 모23','전세영','전세영','정요한','정요한'),
      ('A','FC 모23','김기환','김기환','김범래','김범래'),
      ('A','FC 모23','김범래','김범래','전세영','전세영'),
      ('B','SLS JovenesFC Black','서청원','서청원','김화평','김화평'),
      ('B','SLS JovenesFC Black','유정곤','유정곤','김화평','김화평'),
      ('B','SLS JovenesFC Black','유정곤','유정곤',null,null)
  ) x(side, team_name, s_name, s_lookup, a_name, a_lookup) on true
  where m.match_group_id=v_group_id and m.seq=2;

  -- seq3: WithlordFC 5-0 모23
  insert into goal_events (match_id, team_side, scorer_name, scorer_player_id, assist_name, assist_player_id)
  select m.id, 'A', x.s_name,
         (select tp.id from team_players tp join teams t on t.id=tp.team_id where tp.channel_id=v_channel_id and t.name='WithlordFC' and tp.player_name=x.s_lookup limit 1),
         x.a_name,
         (select tp.id from team_players tp join teams t on t.id=tp.team_id where tp.channel_id=v_channel_id and t.name='WithlordFC' and tp.player_name=x.a_lookup limit 1)
  from matches m
  join lateral (
    values
      ('이성하','이성하','김규훈','김규훈'),
      ('김규훈','김규훈','이성하','이성하'),
      ('김규훈','김규훈','이민형','이민형'),
      ('손여산','손여산','이민형','이민형'),
      ('손여산','손여산',null,null)
  ) x(s_name, s_lookup, a_name, a_lookup) on true
  where m.match_group_id=v_group_id and m.seq=3;

  -- seq4: 젊은피 5-0 변진석
  insert into goal_events (match_id, team_side, scorer_name, scorer_player_id, assist_name, assist_player_id)
  select m.id, 'A', x.s_name,
         (select tp.id from team_players tp join teams t on t.id=tp.team_id where tp.channel_id=v_channel_id and t.name='젊은피' and tp.player_name=x.s_lookup limit 1),
         x.a_name,
         (select tp.id from team_players tp join teams t on t.id=tp.team_id where tp.channel_id=v_channel_id and t.name='젊은피' and tp.player_name=x.a_lookup limit 1)
  from matches m
  join lateral (
    values
      ('류현우','류현우',null,null),
      ('류현우','류현우',null,null),
      ('이영섭','이영섭','이영섭','이영섭'),
      ('이윤섭','이윤섭',null,null),
      ('현동욱','현동욱',null,null)
  ) x(s_name, s_lookup, a_name, a_lookup) on true
  where m.match_group_id=v_group_id and m.seq=4;

  -- seq5: 젊은피 4-1 Dark lumos
  insert into goal_events (match_id, team_side, scorer_name, scorer_player_id)
  select m.id, x.side, x.s_name,
         (select tp.id from team_players tp join teams t on t.id=tp.team_id where tp.channel_id=v_channel_id and t.name=x.team_name and tp.player_name=x.s_lookup limit 1)
  from matches m
  join lateral (
    values
      ('A','젊은피','류현우','류현우'),
      ('A','젊은피','유지원','유지원'),
      ('A','젊은피','이영섭','이영섭'),
      ('A','젊은피','현동욱','현동욱'),
      ('B','Dark lumos','김민제','김민제')
  ) x(side, team_name, s_name, s_lookup) on true
  where m.match_group_id=v_group_id and m.seq=5;

  -- seq6: 변진석 0-4 Dark lumos (OG 포함)
  insert into goal_events (match_id, team_side, scorer_name, scorer_player_id, is_own_goal)
  select m.id, 'B', x.s_name,
         (select tp.id from team_players tp join teams t on t.id=tp.team_id where tp.channel_id=v_channel_id and t.name=x.lookup_team and tp.player_name=x.lookup_name limit 1),
         x.is_og
  from matches m
  join lateral (
    values
      ('이주영','변진석','이주영', true),
      ('강시온','Dark lumos','강시온', false),
      ('권이혁','Dark lumos','권이혁', false),
      ('권이혁','Dark lumos','권이혁', false)
  ) x(s_name, lookup_team, lookup_name, is_og) on true
  where m.match_group_id=v_group_id and m.seq=6;

  -- 8) 스코어 재계산
  update matches m
  set score_a = s.a_goals, score_b = s.b_goals, updated_at = now()
  from (
    select ge.match_id,
           sum(case when ge.team_side='A' and ge.deleted_at is null then 1 else 0 end)::int as a_goals,
           sum(case when ge.team_side='B' and ge.deleted_at is null then 1 else 0 end)::int as b_goals
    from goal_events ge
    where ge.match_id in (select id from matches where match_group_id=v_group_id)
    group by ge.match_id
  ) s
  where m.id=s.match_id;

end $$;

commit;
