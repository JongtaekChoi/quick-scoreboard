begin;

create table if not exists team_manager_accounts (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  login_id text not null,
  password_hash text not null,
  session_version int not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists team_manager_accounts_unique_login
  on team_manager_accounts (channel_id, login_id);
create index if not exists team_manager_accounts_team_idx
  on team_manager_accounts (team_id, is_active);

commit;
