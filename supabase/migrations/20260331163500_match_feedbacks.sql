create table if not exists public.match_feedbacks (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  author_login_id text null,
  author_role text null,
  content text not null check (char_length(content) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index if not exists match_feedbacks_match_created_idx
  on public.match_feedbacks (match_id, created_at desc);

create index if not exists match_feedbacks_channel_created_idx
  on public.match_feedbacks (channel_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_match_feedbacks_set_updated_at on public.match_feedbacks;
create trigger trg_match_feedbacks_set_updated_at
before update on public.match_feedbacks
for each row execute function public.set_updated_at();
