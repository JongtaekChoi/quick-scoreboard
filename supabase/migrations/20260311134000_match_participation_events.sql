begin;

create table if not exists public.match_participation_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  team_side text not null check (team_side in ('A','B')),
  player_id uuid null references public.team_players(id) on delete set null,
  player_name text null,
  event_type text not null check (event_type in ('in','out')),
  minute int not null check (minute >= 0 and minute <= 200),
  period text null check (period in ('1H','2H','ET1','ET2') or period is null),
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index if not exists mpe_match_minute_idx
  on public.match_participation_events (match_id, minute asc, created_at asc);

create index if not exists mpe_match_player_idx
  on public.match_participation_events (match_id, player_id)
  where player_id is not null;

create index if not exists mpe_match_deleted_idx
  on public.match_participation_events (match_id, deleted_at);

drop trigger if exists trg_match_participation_events_set_updated_at on public.match_participation_events;
create trigger trg_match_participation_events_set_updated_at
before update on public.match_participation_events
for each row execute function public.set_updated_at();

commit;
