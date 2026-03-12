begin;

alter table public.goal_events
  add column if not exists period_sequence int null;

update public.goal_events
set period_sequence = case
  when period = 'first_half' then 1
  when period = 'second_half' then 2
  else 1
end
where period_sequence is null;

create table if not exists public.match_substitutions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  period_sequence int not null,
  minute int not null check (minute >= 0 and minute <= 200),
  team_side text not null check (team_side in ('A','B')),
  player_out_id uuid null references public.team_players(id) on delete set null,
  player_out_name text null,
  player_in_id uuid null references public.team_players(id) on delete set null,
  player_in_name text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index if not exists match_substitutions_match_idx
  on public.match_substitutions (match_id, period_sequence, minute)
  where deleted_at is null;

drop trigger if exists trg_match_substitutions_set_updated_at on public.match_substitutions;
create trigger trg_match_substitutions_set_updated_at
before update on public.match_substitutions
for each row execute procedure public.set_updated_at();

commit;
