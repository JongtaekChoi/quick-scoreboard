begin;

alter table matches
  add column if not exists scheduled_start_at timestamptz null;

create index if not exists matches_scheduled_start_idx
  on matches (status, scheduled_start_at);

commit;
