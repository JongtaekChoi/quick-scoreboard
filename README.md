# quick-scoreboard

화이트보드 수기 기록을 대체하는 경기 중심 스코어보드 웹앱.

## MVP v1
- 경기목록(날짜 필터 + 그룹)
- 경기상세(+1 즉시 저장)
- 득점 이벤트 사후 보정(번호/이름)
- 회원가입 없는 리그 비밀번호 편집모드

상세 스펙: `docs/mvp-v1.md`

## Run
```bash
npm install
cp .env.example .env.local
# fill Supabase envs + ADMIN_PASSWORD
npm run dev
```

리그 경기목록: `/c/{channel-slug}`
관리자 페이지: `/admin` (비밀번호는 `ADMIN_PASSWORD`)

## DB Migration
- 기준 마이그레이션: `supabase/migrations/*`
- 무료 플랜 권장: 로컬 수동 적용
  - `.env.local`에 아래 값 저장(로컬 전용, git 커밋 금지)
    - `SUPABASE_DB_URL_DEVELOP='postgresql://...'`
    - `SUPABASE_DB_URL_MAIN='postgresql://...'`
  - 실행
    - `npm run db:migrate:develop`
    - `npm run db:migrate:main` (YES 확인 필요)
- `scripts/db-migrate.sh`는 실행 시 `.env.local`을 자동 로드합니다.
- CI 자동 마이그레이션은 네트워크/플랜 제약으로 실패할 수 있음(IPv4/접속 이슈).

## 수동 패치(기존 운영 DB)
- 이미 운영 중인 DB는 기존 1회 패치 적용 유지:
  - `db/patch_teams_master.sql`
  - `db/patch_match_scheduled_start.sql`
  - `db/patch_team_players.sql`
  - `db/patch_match_group_entries.sql`
  - `db/patch_team_manager_accounts.sql`
  - `db/patch_channel_accounts.sql`
  - `db/patch_match_group_guests.sql`

## CI
- `.github/workflows/ci.yml`
  - PR / main push 시 `npm ci`, `npm run lint`, `npm run build`
  - main push + secret 설정 시 `supabase db push`로 migration 적용
