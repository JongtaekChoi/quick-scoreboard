begin;

-- Backfill unified substitution rows from legacy participation events (out/in pair rows).
-- Pairing rule: within same match/team/minute, OUT and IN are paired by created_at order.
with outs as (
  select
    e.match_id,
    e.team_side,
    e.minute,
    e.player_id as player_out_id,
    e.player_name as player_out_name,
    e.created_at,
    row_number() over (
      partition by e.match_id, e.team_side, e.minute
      order by e.created_at asc, e.id asc
    ) as rn
  from public.match_participation_events e
  where e.deleted_at is null
    and coalesce(e.is_starter, false) = false
    and e.event_type = 'out'
),
ins as (
  select
    e.match_id,
    e.team_side,
    e.minute,
    e.player_id as player_in_id,
    e.player_name as player_in_name,
    e.created_at,
    row_number() over (
      partition by e.match_id, e.team_side, e.minute
      order by e.created_at asc, e.id asc
    ) as rn
  from public.match_participation_events e
  where e.deleted_at is null
    and coalesce(e.is_starter, false) = false
    and e.event_type = 'in'
),
paired as (
  select
    o.match_id,
    o.team_side,
    o.minute,
    o.player_out_id,
    o.player_out_name,
    i.player_in_id,
    i.player_in_name,
    greatest(o.created_at, i.created_at) as created_at,
    case
      when o.minute >= 15 then 2
      else 1
    end as period_sequence
  from outs o
  join ins i
    on i.match_id = o.match_id
   and i.team_side = o.team_side
   and i.minute = o.minute
   and i.rn = o.rn
)
insert into public.match_substitutions (
  match_id,
  period_sequence,
  minute,
  team_side,
  player_out_id,
  player_out_name,
  player_in_id,
  player_in_name,
  created_at
)
select
  p.match_id,
  p.period_sequence,
  p.minute,
  p.team_side,
  p.player_out_id,
  p.player_out_name,
  p.player_in_id,
  p.player_in_name,
  p.created_at
from paired p
where not exists (
  select 1
  from public.match_substitutions s
  where s.deleted_at is null
    and s.match_id = p.match_id
    and s.team_side = p.team_side
    and s.minute = p.minute
    and coalesce(s.player_out_id::text, '') = coalesce(p.player_out_id::text, '')
    and coalesce(s.player_in_id::text, '') = coalesce(p.player_in_id::text, '')
);

commit;
