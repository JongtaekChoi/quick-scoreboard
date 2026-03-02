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

## CI
- `.github/workflows/ci.yml`
  - PR / main push 시 `npm ci`, `npm run lint`, `npm run build`
