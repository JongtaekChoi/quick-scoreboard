begin;

drop view if exists public.channel_teams_view;

create view public.channel_teams_view as
select
  ct.channel_id,
  t.id,
  t.name,
  t.color_hex,
  ct.last_used_at,
  t.created_at,
  t.updated_at
from public.channel_teams ct
join public.teams t on t.id = ct.team_id;

commit;
