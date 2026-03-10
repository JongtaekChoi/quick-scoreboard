begin;

alter table public.teams
  add column if not exists color_hex text null;

commit;
