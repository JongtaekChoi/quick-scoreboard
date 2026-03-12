begin;

alter table public.goal_events
  add column if not exists match_period_id uuid null references public.match_periods(id) on delete set null;

alter table public.match_substitutions
  add column if not exists match_period_id uuid null references public.match_periods(id) on delete set null;

update public.goal_events g
set match_period_id = mp.id
from public.match_periods mp
where g.match_id = mp.match_id
  and g.period_sequence = mp.sequence
  and g.match_period_id is null
  and mp.deleted_at is null;

update public.match_substitutions s
set match_period_id = mp.id
from public.match_periods mp
where s.match_id = mp.match_id
  and s.period_sequence = mp.sequence
  and s.match_period_id is null
  and mp.deleted_at is null;

create index if not exists goal_events_match_period_idx
  on public.goal_events (match_id, match_period_id)
  where deleted_at is null;

create index if not exists match_substitutions_match_period_idx
  on public.match_substitutions (match_id, match_period_id)
  where deleted_at is null;

commit;
