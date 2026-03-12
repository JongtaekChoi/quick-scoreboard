begin;

create table if not exists public.match_period_substitution_plans (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  team_side text not null check (team_side in ('A','B')),
  period_sequence int not null check (period_sequence > 0),
  player_out_id uuid null references public.team_players(id) on delete set null,
  player_out_name text null,
  player_in_id uuid null references public.team_players(id) on delete set null,
  player_in_name text null,
  planned_minute int not null default 0 check (planned_minute >= 0 and planned_minute <= 200),
  applied_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint mpsp_out_identity_check
    check (player_out_id is not null or nullif(trim(coalesce(player_out_name,'')), '') is not null),
  constraint mpsp_in_identity_check
    check (player_in_id is not null or nullif(trim(coalesce(player_in_name,'')), '') is not null)
);

create index if not exists mpsp_match_period_idx
  on public.match_period_substitution_plans (match_id, period_sequence, team_side)
  where deleted_at is null;

create index if not exists mpsp_match_pending_idx
  on public.match_period_substitution_plans (match_id, applied_at)
  where deleted_at is null;

drop trigger if exists trg_match_period_substitution_plans_set_updated_at on public.match_period_substitution_plans;
create trigger trg_match_period_substitution_plans_set_updated_at
before update on public.match_period_substitution_plans
for each row execute procedure public.set_updated_at();

commit;
