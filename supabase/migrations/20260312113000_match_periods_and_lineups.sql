begin;

alter table public.matches
  add column if not exists period_count int not null default 2;

alter table public.matches
  drop constraint if exists matches_period_count_check;

alter table public.matches
  add constraint matches_period_count_check
  check (period_count > 0 and period_count <= 12);

create table if not exists public.match_periods (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  sequence int not null,
  period_code text null,
  label text null,
  status text not null default 'pending' check (status in ('pending', 'live', 'ended')),
  started_at timestamptz null,
  ended_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create unique index if not exists match_periods_match_sequence_unique
  on public.match_periods (match_id, sequence)
  where deleted_at is null;

create unique index if not exists match_periods_match_code_unique
  on public.match_periods (match_id, period_code)
  where period_code is not null and deleted_at is null;

create index if not exists match_periods_match_status_idx
  on public.match_periods (match_id, status, sequence)
  where deleted_at is null;

create table if not exists public.match_period_lineups (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  match_period_id uuid not null references public.match_periods(id) on delete cascade,
  team_side text not null check (team_side in ('A', 'B')),
  player_id uuid null references public.team_players(id) on delete set null,
  player_name text null,
  is_starter boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint match_period_lineups_player_identity_check
    check (player_id is not null or nullif(trim(coalesce(player_name, '')), '') is not null)
);

create unique index if not exists match_period_lineups_unique_player
  on public.match_period_lineups (match_period_id, team_side, coalesce(player_id::text, player_name))
  where deleted_at is null;

create index if not exists match_period_lineups_match_period_team_idx
  on public.match_period_lineups (match_id, match_period_id, team_side)
  where deleted_at is null;

create index if not exists match_period_lineups_match_idx
  on public.match_period_lineups (match_id)
  where deleted_at is null;

create or replace function public.validate_match_period_lineups_match_id()
returns trigger as $$
declare
  period_match_id uuid;
begin
  select match_id into period_match_id
  from public.match_periods
  where id = new.match_period_id;

  if period_match_id is null then
    raise exception 'match_period_id % does not exist', new.match_period_id;
  end if;

  if period_match_id <> new.match_id then
    raise exception 'match_id % does not match period''s match_id %', new.match_id, period_match_id;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_match_period_lineups_validate_match_id on public.match_period_lineups;
create trigger trg_match_period_lineups_validate_match_id
before insert or update on public.match_period_lineups
for each row execute procedure public.validate_match_period_lineups_match_id();

drop trigger if exists trg_match_periods_set_updated_at on public.match_periods;
create trigger trg_match_periods_set_updated_at
before update on public.match_periods
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_match_period_lineups_set_updated_at on public.match_period_lineups;
create trigger trg_match_period_lineups_set_updated_at
before update on public.match_period_lineups
for each row execute procedure public.set_updated_at();

insert into public.match_periods (match_id, sequence, period_code, label)
select m.id,
       gs.seq,
       case
         when gs.seq <= 4 then concat('Q', gs.seq)
         else concat('P', gs.seq)
       end as period_code,
       concat(gs.seq, 'P') as label
from public.matches m
cross join lateral generate_series(1, greatest(1, m.period_count)) as gs(seq)
where not exists (
  select 1 from public.match_periods mp where mp.match_id = m.id and mp.deleted_at is null
);

commit;
