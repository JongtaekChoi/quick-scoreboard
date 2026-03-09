begin;

alter table public.matches
  add column if not exists period_state text not null default 'pre',
  add column if not exists first_half_started_at timestamptz null,
  add column if not exists first_half_ended_at timestamptz null,
  add column if not exists halftime_started_at timestamptz null,
  add column if not exists second_half_started_at timestamptz null,
  add column if not exists second_half_ended_at timestamptz null;

alter table public.matches
  drop constraint if exists matches_period_state_check;

alter table public.matches
  add constraint matches_period_state_check
  check (period_state in ('pre','first_half','halftime','second_half','ended'));

update public.matches
set period_state = case
  when status = 'ended' then 'ended'
  when status = 'live' then 'first_half'
  else 'pre'
end
where period_state is null or period_state = 'pre';

commit;
