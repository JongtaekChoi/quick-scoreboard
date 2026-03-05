begin;

create table if not exists channel_accounts (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  role text not null check (role in ('admin', 'editor', 'manager')),
  login_id text not null,
  password_hash text not null,
  team_id uuid null references teams(id) on delete set null,
  session_version int not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists channel_accounts_unique_login
  on channel_accounts (channel_id, login_id);
create index if not exists channel_accounts_role_idx
  on channel_accounts (channel_id, role, is_active);

commit;
