# quick-scoreboard

화이트보드 수기 기록을 대체하는 경기 중심 스코어보드 웹앱.

## MVP v1
- 경기목록(날짜 필터 + 그룹)
- 경기상세(+1 즉시 저장)
- 득점 이벤트 사후 보정(번호/이름)
- 회원가입 없는 채널 비밀번호 편집모드

상세 스펙: `docs/mvp-v1.md`

## Run
```bash
npm install
cp .env.example .env.local
# fill Supabase envs + ADMIN_PASSWORD
npm run dev
```

채널 경기목록: `/c/{channel-slug}`
관리자 페이지: `/admin` (비밀번호는 `ADMIN_PASSWORD`)

## DB Migration
- 기준 마이그레이션: `supabase/migrations/20260303090100_init.sql`
- 자동 적용: `.github/workflows/ci.yml`의 `db-migrate` job (main push 시)
  - GitHub Secret `SUPABASE_DB_URL` 설정 필요
  - 예: `postgresql://postgres:<password>@<project-ref>.supabase.co:5432/postgres?sslmode=require`

## 수동 패치(기존 운영 DB)
- 이미 운영 중인 DB는 기존 1회 패치 적용 유지:
  - `db/patch_teams_master.sql`
  - `db/patch_match_scheduled_start.sql`

## CI
- `.github/workflows/ci.yml`
  - PR / main push 시 `npm ci`, `npm run lint`, `npm run build`
  - main push + secret 설정 시 `supabase db push`로 migration 적용
