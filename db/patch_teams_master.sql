begin;

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  name text not null,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists teams_unique_channel_name on teams (channel_id, name);
create index if not exists teams_channel_last_used_idx on teams (channel_id, last_used_at desc);

commit;
