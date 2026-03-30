alter table if exists public.teams
  add column if not exists short_name text;

create or replace view public.channel_teams_view as
select
  ct.channel_id,
  t.id,
  t.name,
  t.short_name,
  t.color_hex,
  ct.last_used_at
from public.channel_teams ct
join public.teams t on t.id = ct.team_id;
