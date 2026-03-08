begin;

alter table channel_accounts drop constraint if exists channel_accounts_role_check;
alter table channel_accounts add constraint channel_accounts_role_check check (role in ('admin','manager','player'));

alter table channel_accounts add column if not exists player_id uuid null references team_players(id) on delete set null;

create unique index if not exists channel_accounts_unique_player on channel_accounts(channel_id, player_id) where player_id is not null;

commit;
