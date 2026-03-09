begin;

alter table public.goal_events
  add column if not exists period text not null default 'first_half';

alter table public.goal_events
  drop constraint if exists goal_events_period_check;

alter table public.goal_events
  add constraint goal_events_period_check
  check (period in ('first_half','second_half'));

update public.goal_events
set period = case when coalesce(minute, 0) > 15 then 'second_half' else 'first_half' end
where period is null or period = 'first_half';

commit;
