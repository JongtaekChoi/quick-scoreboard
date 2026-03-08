-- Seed: 2026-03-08 모23/Withload/Jovenes/젊은피/Dark lumos 기록
-- 사용 전 확인
-- 1) v_channel_slug / v_play_date / v_group_title
-- 2) Withload 팀명, 변진석 팀명, 유지원 표기, 신주찬 표기

begin;

do $$
declare
  v_channel_slug text := 'sample';
  v_play_date date := date '2026-03-08';
  v_group_title text := '모23 리그 기록 입력';
  v_channel_id uuid;
  v_group_id uuid;
begin
  -- channel
  select id into v_channel_id from channels where slug = v_channel_slug;
  if v_channel_id is null then
    raise exception 'channel not found: %', v_channel_slug;
  end if;

  -- teams master upsert
  insert into teams (name)
  values
    ('FC 모23'),
    ('SLS JovenesFC Black'),
    ('용병 젊은피'),
    ('Withload'),
    ('Dark lumos'),
    ('변진석')
  on conflict do nothing;

  -- channel_teams link
  insert into channel_teams (channel_id, team_id)
  select v_channel_id, t.id
  from teams t
  where t.name in ('FC 모23','SLS JovenesFC Black','용병 젊은피','Withload','Dark lumos','변진석')
  on conflict (channel_id, team_id) do update set last_used_at = now();

  -- players
  with tp(team_name, jersey_no, player_name) as (
    values
      ('FC 모23','3','전세영'),('FC 모23','7','정요한'),('FC 모23','8','장인혁'),('FC 모23','10','김기환'),('FC 모23','11','김범래'),('FC 모23','20','조수형'),('FC 모23','21','오세윤'),('FC 모23','23','황영규'),('FC 모23','41','김한중'),('FC 모23','91','김규원'),('FC 모23','99','이동수'),
      ('SLS JovenesFC Black','17','김화평'),('SLS JovenesFC Black','55','서청원'),('SLS JovenesFC Black','11','유정곤'),('SLS JovenesFC Black','13','최상준'),('SLS JovenesFC Black','37','최종택'),('SLS JovenesFC Black','77','김금성'),
      ('용병 젊은피','1','류현우'),('용병 젊은피','3','유지원'),('용병 젊은피','4','이영섭'),('용병 젊은피','5','이윤섭'),('용병 젊은피','7','정호성'),('용병 젊은피','8','주상현'),('용병 젊은피','9','현동욱'),
      ('Withload','1','김규훈'),('Withload','4','이민형'),('Withload','5','이성하'),('Withload','7','손여산'),('Withload','98','신주찬래'),('Withload','99','이주환'),
      ('Dark lumos','2','김민제'),('Dark lumos','3','조한빛'),('Dark lumos','4','정종빈'),('Dark lumos','5','이정한'),('Dark lumos','6','신홍균'),('Dark lumos','8','강시온'),('Dark lumos','9','신성욱'),('Dark lumos','10','권이혁'),
      ('변진석','2','이주영')
  )
  insert into team_players (channel_id, team_id, jersey_no, player_name, is_active)
  select v_channel_id, t.id, tp.jersey_no, tp.player_name, true
  from tp
  join teams t on t.name = tp.team_name
  on conflict (channel_id, team_id, jersey_no)
  do update set player_name = excluded.player_name, is_active = true, updated_at = now();

  -- match group
  insert into match_groups (channel_id, play_date, title, seq, entry_confirmed_at)
  values (
    v_channel_id,
    v_play_date,
    v_group_title,
    coalesce((select max(seq) + 1 from match_groups where channel_id = v_channel_id and play_date = v_play_date), 1),
    now()
  )
  returning id into v_group_id;

  -- entries (전원 등록)
  insert into match_group_entries (match_group_id, channel_id, team_id, player_id)
  select v_group_id, v_channel_id, tp.team_id, tp.id
  from team_players tp
  join teams t on t.id = tp.team_id
  where tp.channel_id = v_channel_id
    and t.name in ('FC 모23','SLS JovenesFC Black','용병 젊은피','Withload','Dark lumos','변진석')
  on conflict (match_group_id, team_id, player_id) do nothing;

  -- matches
  with m(seq, team_a, team_b, score_a, score_b) as (
    values
      (1, 'Withload', 'SLS JovenesFC Black', 4, 0),
      (2, 'FC 모23', 'SLS JovenesFC Black', 4, 3),
      (3, 'Withload', 'FC 모23', 5, 0),
      (4, '용병 젊은피', '변진석', 5, 0),
      (5, '용병 젊은피', 'Dark lumos', 4, 1),
      (6, '변진석', 'Dark lumos', 0, 4)
  )
  insert into matches (
    channel_id, match_group_id, seq, team_a_name, team_b_name, score_a, score_b, status, started_at, ended_at
  )
  select v_channel_id, v_group_id, m.seq, m.team_a, m.team_b, m.score_a, m.score_b, 'ended', now(), now()
  from m;

  -- goal events (minute 미기재)
  -- 1) Withload 4 : 0 Jovenes
  insert into goal_events (match_id, team_side, minute, scorer_name, scorer_player_id, assist_name, assist_player_id)
  select m.id, 'A', null, x.scorer_name,
         (select tp.id from team_players tp join teams t on t.id=tp.team_id where tp.channel_id=v_channel_id and t.name='Withload' and tp.player_name=x.scorer_lookup limit 1),
         x.assist_name,
         (select tp.id from team_players tp join teams t on t.id=tp.team_id where tp.channel_id=v_channel_id and t.name='Withload' and tp.player_name=x.assist_lookup limit 1)
  from matches m
  join lateral (
    values
      ('손여산','손여산','이민형','이민형'),
      ('손여산','손여산',null,null),
      ('이성하','이성하',null,null),
      ('김규훈','김규훈','신주찬','신주찬래')
  ) x(scorer_name, scorer_lookup, assist_name, assist_lookup) on true
  where m.match_group_id = v_group_id and m.seq = 1;

  -- 2) 모23 4 : 3 Jovenes
  insert into goal_events (match_id, team_side, minute, scorer_name, scorer_player_id, assist_name, assist_player_id)
  select m.id, x.team_side, null, x.scorer_name,
         (select tp.id from team_players tp join teams t on t.id=tp.team_id where tp.channel_id=v_channel_id and t.name=x.team_lookup and tp.player_name=x.scorer_lookup limit 1),
         x.assist_name,
         (select tp.id from team_players tp join teams t on t.id=tp.team_id where tp.channel_id=v_channel_id and t.name=x.team_lookup and tp.player_name=x.assist_lookup limit 1)
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
  ) x(team_side, team_lookup, scorer_name, scorer_lookup, assist_name, assist_lookup) on true
  where m.match_group_id = v_group_id and m.seq = 2;

  -- 3) Withload 5 : 0 모23
  insert into goal_events (match_id, team_side, minute, scorer_name, scorer_player_id, assist_name, assist_player_id)
  select m.id, 'A', null, x.scorer_name,
         (select tp.id from team_players tp join teams t on t.id=tp.team_id where tp.channel_id=v_channel_id and t.name='Withload' and tp.player_name=x.scorer_lookup limit 1),
         x.assist_name,
         (select tp.id from team_players tp join teams t on t.id=tp.team_id where tp.channel_id=v_channel_id and t.name='Withload' and tp.player_name=x.assist_lookup limit 1)
  from matches m
  join lateral (
    values
      ('이성하','이성하','김규훈','김규훈'),
      ('김규훈','김규훈','이성하','이성하'),
      ('김규훈','김규훈','이민형','이민형'),
      ('손여산','손여산','이민형','이민형'),
      ('손여산','손여산',null,null)
  ) x(scorer_name, scorer_lookup, assist_name, assist_lookup) on true
  where m.match_group_id = v_group_id and m.seq = 3;

  -- 4) 젊은피 5 : 0 변진석
  insert into goal_events (match_id, team_side, minute, scorer_name, scorer_player_id, assist_name, assist_player_id)
  select m.id, 'A', null, x.scorer_name,
         (select tp.id from team_players tp join teams t on t.id=tp.team_id where tp.channel_id=v_channel_id and t.name='용병 젊은피' and tp.player_name=x.scorer_lookup limit 1),
         x.assist_name,
         (select tp.id from team_players tp join teams t on t.id=tp.team_id where tp.channel_id=v_channel_id and t.name='용병 젊은피' and tp.player_name=x.assist_lookup limit 1)
  from matches m
  join lateral (
    values
      ('류현우','류현우',null,null),
      ('류현우','류현우',null,null),
      ('이영섭','이영섭','이영섭','이영섭'),
      ('이윤섭','이윤섭',null,null),
      ('현동욱','현동욱',null,null)
  ) x(scorer_name, scorer_lookup, assist_name, assist_lookup) on true
  where m.match_group_id = v_group_id and m.seq = 4;

  -- 5) 젊은피 4 : 1 Dark lumos
  insert into goal_events (match_id, team_side, minute, scorer_name, scorer_player_id, assist_name, assist_player_id)
  select m.id, x.team_side, null, x.scorer_name,
         (select tp.id from team_players tp join teams t on t.id=tp.team_id where tp.channel_id=v_channel_id and t.name=x.team_lookup and tp.player_name=x.scorer_lookup limit 1),
         null, null
  from matches m
  join lateral (
    values
      ('A','용병 젊은피','류현우','류현우'),
      ('A','용병 젊은피','유지원','유지원'),
      ('A','용병 젊은피','이영섭','이영섭'),
      ('A','용병 젊은피','현동욱','현동욱'),
      ('B','Dark lumos','김민제','김민제')
  ) x(team_side, team_lookup, scorer_name, scorer_lookup) on true
  where m.match_group_id = v_group_id and m.seq = 5;

  -- 6) 변진석 0 : 4 Dark lumos (자책 1 포함)
  insert into goal_events (match_id, team_side, minute, scorer_name, scorer_player_id, is_own_goal)
  select m.id, x.team_side, null, x.scorer_name,
         (select tp.id from team_players tp join teams t on t.id=tp.team_id where tp.channel_id=v_channel_id and t.name=x.team_lookup and tp.player_name=x.scorer_lookup limit 1),
         x.is_og
  from matches m
  join lateral (
    values
      ('B','Dark lumos','이주영','변진석', true),
      ('B','Dark lumos','강시온','Dark lumos', false),
      ('B','Dark lumos','권이혁','Dark lumos', false),
      ('B','Dark lumos','권이혁','Dark lumos', false)
  ) x(team_side, scorer_name, scorer_lookup, team_lookup, is_og) on true
  where m.match_group_id = v_group_id and m.seq = 6;

  -- recalc scores from non-deleted goals
  update matches m
  set
    score_a = coalesce(s.a_goals, 0),
    score_b = coalesce(s.b_goals, 0),
    updated_at = now()
  from (
    select
      ge.match_id,
      sum(case when ge.team_side = 'A' then 1 else 0 end)::int as a_goals,
      sum(case when ge.team_side = 'B' then 1 else 0 end)::int as b_goals
    from goal_events ge
    where ge.deleted_at is null
      and ge.match_id in (select id from matches where match_group_id = v_group_id)
    group by ge.match_id
  ) s
  where m.id = s.match_id;

end $$;

commit;
