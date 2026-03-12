begin;

alter table public.match_period_substitution_plans
  add column if not exists match_period_id uuid null references public.match_periods(id) on delete cascade;

update public.match_period_substitution_plans p
set match_period_id = mp.id
from public.match_periods mp
where p.match_id = mp.match_id
  and p.period_sequence = mp.sequence
  and p.match_period_id is null
  and mp.deleted_at is null;

create index if not exists match_period_substitution_plans_period_idx
  on public.match_period_substitution_plans (match_id, match_period_id, team_side)
  where deleted_at is null and applied_at is null;

commit;
