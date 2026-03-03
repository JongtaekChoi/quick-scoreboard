-- quick-scoreboard MVP seed (local dev)

begin;

with c as (
  insert into channels (name, slug, is_public_view, edit_password_hash)
  values ('샘플 채널', 'sample', true, '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4') -- password: 1234
  on conflict (slug) do update set name = excluded.name
  returning id
), g as (
  insert into match_groups (channel_id, play_date, venue, title, seq)
  select id, current_date, '불암산', to_char(current_date, 'YYYY-MM-DD') || ' 불암산', 1 from c
  returning id, channel_id
)
insert into matches (channel_id, match_group_id, seq, team_a_name, team_b_name, score_a, score_b, status)
select g.channel_id, g.id, 1, '화이트', '블랙', 0, 0, 'live'
from g
on conflict do nothing;

commit;
