begin;

-- Migrate existing team_manager_accounts into channel_accounts (role='manager')
-- Both tables use the same password hash algorithm, so hashes are compatible.
insert into channel_accounts (channel_id, role, login_id, password_hash, team_id, session_version, is_active, created_at, updated_at)
select channel_id, 'manager', login_id, password_hash, team_id, session_version, is_active, created_at, updated_at
from team_manager_accounts
on conflict (channel_id, login_id) do nothing;

-- Drop the now-redundant table
drop trigger if exists trg_team_manager_accounts_set_updated_at on team_manager_accounts;
drop table if exists team_manager_accounts;

commit;
