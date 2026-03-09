begin;

create table if not exists public.match_change_logs (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  channel_id uuid null references public.channels(id) on delete set null,
  action_type text not null,
  actor_login_id text null,
  actor_role text null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists match_change_logs_match_created_idx
  on public.match_change_logs (match_id, created_at desc);

create index if not exists match_change_logs_channel_created_idx
  on public.match_change_logs (channel_id, created_at desc);

commit;
