# quick-scoreboard MVP v1

## 목표
화이트보드 수기 기록을 대체하는 경기 중심 웹앱.

## 페이지
1. 경기목록 화면
   - 날짜 필터
   - 경기 그룹(같은 날짜/구장)
   - 각 경기 스코어 요약
2. 경기 상세 화면
   - 팀 A/B +1 버튼 (즉시 저장)
   - 득점 이벤트 목록
   - 득점 이벤트 사후 수정(득점자/어시 통합 입력)
   - 편집모드(비밀번호)

## 인증/권한
- 회원가입 없음
- 채널 단위 편집 비밀번호
- 편집 성공 시 쿠키 세션 유지
- MVP에서는 SHA-256 해시 비교 사용(후속으로 argon2/bcrypt 강화)

## 데이터 개념
- channels
- channel_share_links
- match_groups
- matches
- goal_events
- match_player_aliases

스키마 파일: `db/schema.sql`
시드 예시: `db/seed.sql`

## 핵심 UX
- 점수 입력은 1탭 저장
- 선수정보는 나중에 보정
- 같은 경기 내 입력 번호/이름 추천
