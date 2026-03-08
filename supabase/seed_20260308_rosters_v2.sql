-- Seed v2: 2026-03-08 전달 엔트리(팀/선수) 반영
-- 목적: 리그(sample)에 팀/선수 마스터 + 채널-팀 연결만 반영

begin;

do $$
declare
  v_channel_slug text := 'sls2026';
  v_channel_id uuid;
begin
  select id into v_channel_id from channels where slug = v_channel_slug;
  if v_channel_id is null then
    raise exception 'channel not found: %', v_channel_slug;
  end if;

  -- teams
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

  -- channel_teams
  insert into channel_teams (channel_id, team_id)
  select v_channel_id, t.id
  from teams t
  where t.name in (
    '변진석','젊은피','WithlordFC','Dark lumos',
    'SLS JovenesFC Black','SLS JovenesFC White','FC 모23'
  )
  on conflict (channel_id, team_id)
  do update set last_used_at = now();

  -- team players upsert
  with tp(team_name, jersey_no, player_name) as (
    values
      -- 변진석
      ('변진석','0','변진석'),('변진석','1','오동녘어진이'),('변진석','2','구정환'),('변진석','3','이주영'),('변진석','4','차경인'),('변진석','5','김영기'),('변진석','6','허준행'),('변진석','7','김성학'),('변진석','8','김성호'),('변진석','9','김주찬'),('변진석','10','김동찬'),

      -- 젊은피
      ('젊은피','1','류현우'),('젊은피','2','안기환'),('젊은피','3','유지원'),('젊은피','4','이영섭'),('젊은피','5','이윤섭'),('젊은피','6','장준영'),('젊은피','7','정호성'),('젊은피','8','주상현'),('젊은피','9','현동욱'),

      -- WithlordFC
      ('WithlordFC','0','신주찬'),('WithlordFC','1','김규훈'),('WithlordFC','2','박민호'),('WithlordFC','3','조동건'),('WithlordFC','4','이민형'),('WithlordFC','5','이성하'),('WithlordFC','6','백승원'),('WithlordFC','7','손여산'),('WithlordFC','8','김동혁'),('WithlordFC','9','김유현'),('WithlordFC','99','이주환'),

      -- Dark lumos
      ('Dark lumos','1','정지환'),('Dark lumos','2','김민제'),('Dark lumos','3','조한빛'),('Dark lumos','4','정종빈'),('Dark lumos','5','이정한'),('Dark lumos','6','신홍균'),('Dark lumos','7','정민규'),('Dark lumos','8','강시온'),('Dark lumos','9','신성욱'),('Dark lumos','10','권이혁'),

      -- SLS JovenesFC Black
      ('SLS JovenesFC Black','3','김재철'),('SLS JovenesFC Black','10','김남운'),('SLS JovenesFC Black','11','유정곤'),('SLS JovenesFC Black','13','최상준'),('SLS JovenesFC Black','17','김화평'),('SLS JovenesFC Black','37','최종택'),('SLS JovenesFC Black','55','서청원'),('SLS JovenesFC Black','82','옥지호'),

      -- SLS JovenesFC White
      ('SLS JovenesFC White','4','임재호'),('SLS JovenesFC White','7','진동석'),('SLS JovenesFC White','8','김영근'),('SLS JovenesFC White','9','백명수'),('SLS JovenesFC White','15','김형기'),('SLS JovenesFC White','16','김찬정'),('SLS JovenesFC White','19','최성락'),('SLS JovenesFC White','21','송진한'),('SLS JovenesFC White','66','이종원'),('SLS JovenesFC White','77','김금성'),

      -- FC 모23
      ('FC 모23','3','전세영'),('FC 모23','4','오슬기'),('FC 모23','7','정요한'),('FC 모23','8','장인혁'),('FC 모23','10','김기환'),('FC 모23','11','김범래'),('FC 모23','20','조수형'),('FC 모23','21','오세윤'),('FC 모23','23','황영규'),('FC 모23','41','김한중'),('FC 모23','91','김규원'),('FC 모23','99','이동수')
  )
  insert into team_players (channel_id, team_id, jersey_no, player_name, is_active)
  select v_channel_id, t.id, tp.jersey_no, tp.player_name, true
  from tp
  join teams t on t.name = tp.team_name
  on conflict (channel_id, team_id, jersey_no)
  do update set player_name = excluded.player_name, is_active = true, updated_at = now();

  -- 현재 전달된 선수 외 기존 선수는 비활성 처리(같은 채널+팀 기준)
  update team_players p
  set is_active = false, updated_at = now()
  from teams t
  where p.channel_id = v_channel_id
    and p.team_id = t.id
    and t.name in (
      '변진석','젊은피','WithlordFC','Dark lumos',
      'SLS JovenesFC Black','SLS JovenesFC White','FC 모23'
    )
    and not exists (
      select 1
      from (
        values
          ('변진석','0','변진석'),('변진석','1','오동녘어진이'),('변진석','2','구정환'),('변진석','3','이주영'),('변진석','4','차경인'),('변진석','5','김영기'),('변진석','6','허준행'),('변진석','7','김성학'),('변진석','8','김성호'),('변진석','9','김주찬'),('변진석','10','김동찬'),
          ('젊은피','1','류현우'),('젊은피','2','안기환'),('젊은피','3','유지원'),('젊은피','4','이영섭'),('젊은피','5','이윤섭'),('젊은피','6','장준영'),('젊은피','7','정호성'),('젊은피','8','주상현'),('젊은피','9','현동욱'),
          ('WithlordFC','0','신주찬'),('WithlordFC','1','김규훈'),('WithlordFC','2','박민호'),('WithlordFC','3','조동건'),('WithlordFC','4','이민형'),('WithlordFC','5','이성하'),('WithlordFC','6','백승원'),('WithlordFC','7','손여산'),('WithlordFC','8','김동혁'),('WithlordFC','9','김유현'),('WithlordFC','99','이주환'),
          ('Dark lumos','1','정지환'),('Dark lumos','2','김민제'),('Dark lumos','3','조한빛'),('Dark lumos','4','정종빈'),('Dark lumos','5','이정한'),('Dark lumos','6','신홍균'),('Dark lumos','7','정민규'),('Dark lumos','8','강시온'),('Dark lumos','9','신성욱'),('Dark lumos','10','권이혁'),
          ('SLS JovenesFC Black','3','김재철'),('SLS JovenesFC Black','10','김남운'),('SLS JovenesFC Black','11','유정곤'),('SLS JovenesFC Black','13','최상준'),('SLS JovenesFC Black','17','김화평'),('SLS JovenesFC Black','37','최종택'),('SLS JovenesFC Black','55','서청원'),('SLS JovenesFC Black','82','옥지호'),
          ('SLS JovenesFC White','4','임재호'),('SLS JovenesFC White','7','진동석'),('SLS JovenesFC White','8','김영근'),('SLS JovenesFC White','9','백명수'),('SLS JovenesFC White','15','김형기'),('SLS JovenesFC White','16','김찬정'),('SLS JovenesFC White','19','최성락'),('SLS JovenesFC White','21','송진한'),('SLS JovenesFC White','66','이종원'),('SLS JovenesFC White','77','김금성'),
          ('FC 모23','3','전세영'),('FC 모23','4','오슬기'),('FC 모23','7','정요한'),('FC 모23','8','장인혁'),('FC 모23','10','김기환'),('FC 모23','11','김범래'),('FC 모23','20','조수형'),('FC 모23','21','오세윤'),('FC 모23','23','황영규'),('FC 모23','41','김한중'),('FC 모23','91','김규원'),('FC 모23','99','이동수')
      ) as keep(team_name, jersey_no, player_name)
      where keep.team_name = t.name
        and keep.jersey_no = p.jersey_no
        and keep.player_name = p.player_name
    );

end $$;

commit;
