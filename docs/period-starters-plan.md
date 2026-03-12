# 경기별(Period/Quarter) 스타팅 멤버 운영 전환 계획

## 1) 현재 구조 요약
- `match_group_entries`: 경기그룹 단위 참가 가능 선수 풀(엔트리) 저장.
- `match_participation_events`: 경기 단위 출전 이벤트(`in/out`) 저장.
- `is_starter`와 `period` 컬럼이 이미 있어, "스타팅"과 "전/후반" 개념 일부는 이벤트 테이블에서 표현 가능.

현재는 **그룹 엔트리**와 **경기 출전(특히 스타팅)** 사이에 명시적 연결(제약/워크플로우)이 약해, 전반/후반(또는 쿼터)별로 스타팅을 사전에 등록·검증하기 어렵다.

---

## 2) 목표 상태(권장)

### 핵심 개념
1. **엔트리 풀은 경기그룹 단위로 유지**
   - 기존 `match_group_entries`는 그대로 사용(대회 당일 참가 가능 풀).
2. **실제 스타팅은 경기 + Period 단위로 분리 관리**
   - 경기마다 `1Q/2Q...` 또는 `1H/2H`별 스타팅을 별도 등록.
3. **교체 이벤트와 분리된 모델 유지**
   - 스타팅은 "라인업 스냅샷"이고, 교체는 "타임라인 이벤트"로 분리.

이렇게 하면 사용자 인식("전반 시작 라인업", "후반 시작 라인업")이 명확해지고, 교체 로직 복잡도도 줄어든다.

---

## 3) 데이터 모델 변경안

### A안(수정 권장): `match_periods` + `match_period_lineups` 2계층

리뷰 코멘트 기준으로 보면, `period_code` 문자열만으로 운영하면
- 특정 match가 몇 period 경기인지(관리자 설정값)
- period 순서(1,2,3,4...)
를 안정적으로 보장하기 어렵다.

따라서 **Period 메타(개수/순서/상태)는 `match_periods`**,
**선발 스냅샷은 `match_period_lineups`**로 분리하는 구성이 가장 안전하다.

#### 3-0. 왜 `match_periods`가 필요한가?
1. 관리자에서 "이 경기는 4 period"처럼 사전 설정 가능.
2. 진행 버튼(`N period 시작/종료`) 상태머신을 DB 기반으로 단순화 가능.
3. `sequence`(정수)로 정렬/다음 period 계산이 명확해짐.
4. `period_code`는 라벨(표시명)로 유지하되, 핵심 로직은 sequence 중심으로 운영 가능.

> 결론: **없어도 구현은 가능**하지만, 운영/확장/무결성을 고려하면 `match_periods`를 두는 편이 유리.

#### 3-1. 신규 테이블 A: `match_periods`
- `id`
- `match_id` (FK)
- `sequence` (1,2,3,4...)
- `period_code` (nullable, 예: `1H`, `Q1`, `ET1`)
- `label` (nullable, 화면 표시용: `1쿼터`, `전반` 등)
- `status` (`pending` | `live` | `ended`)
- `started_at`, `ended_at` (nullable)
- `created_at`, `updated_at`, `deleted_at`

권장 제약:
- 유니크: `(match_id, sequence)`
- 유니크(선택): `(match_id, period_code)` (코드를 쓰는 경우)
- 체크: `sequence > 0`

#### 3-2. 신규 테이블 B: `match_period_lineups`
- `match_period_lineups`
  - `id`
  - `match_id` (FK)
  - `match_period_id` (FK -> `match_periods.id`)
  - `team_side` (`A`/`B`)
  - `player_id` (FK, nullable 허용 가능)
  - `player_name` (비등록 선수 대응용)
  - `is_starter` (기본 true; 확장 대비)
  - `created_at`, `updated_at`, `deleted_at`

#### 3-3. 제약/인덱스
- 유니크: `(match_period_id, team_side, coalesce(player_id, player_name))`
- 인덱스: `(match_id, match_period_id, team_side)`
- FK 정합성: `match_period_lineups.match_id`와 `match_periods.match_id`는 동일 match를 가리키도록 보장
- (선택) period별 최대 인원 체크는 애플리케이션 레벨에서 검증.

#### 3-4. 무결성 정책
- `player_id`가 있을 경우 해당 선수가
  1) 같은 채널 소속인지,
  2) 해당 경기그룹 엔트리(`match_group_entries`)에 포함되는지
  를 API 레벨에서 검증.

> DB 트리거로도 가능하지만, 운영/디버깅 관점에서는 **API 검증 + 에러 메시지**가 초기에는 더 실용적.

---

## 4) API/서버 로직 변경

1. **라인업 저장 API 분리**
   - `PUT /api/matches/:id/lineups?sequence=1` (권장)
   - (호환) `PUT /api/matches/:id/lineups?periodCode=1H`
   - 요청: 팀별 스타팅 선수 목록
   - 동작: 기존 period 라인업 soft-delete 후 upsert(또는 diff 반영)

2. **match period 관리 API 추가**
   - `POST /api/matches/:id/periods` (관리자 설정: period 개수/라벨)
   - `PATCH /api/matches/:id/periods/:periodId` (라벨/상태 수정)
   - `POST /api/matches/:id/periods/:periodId/start|end` (진행 제어)

3. **스코어보드 조회 API 확장**
   - 기존 스코어 데이터와 함께 현재 period 라인업 반환.
   - "현재 period 스타팅"과 "직전 period 스타팅" 비교 정보를 같이 주면 UI에서 변경점 하이라이트 가능.

4. **기존 `match_participation_events`와의 관계**
   - `is_starter=true` 이벤트를 더 이상 주 저장소로 쓰지 않고,
   - 필요 시 "라인업 확정 시 starter in 이벤트 자동 생성"(옵션)으로 하위 호환.

---

## 5) UI/UX 변경

1. 관리자 경기 화면에서 Period 탭 제공 (정렬 기준: `sequence`).
2. 탭별로 스타팅 멤버 편집 UI 제공.
3. "이전 period 라인업 복사" 버튼 제공(가장 중요).
4. 저장 전 검증:
   - 엔트리 미등록 선수 경고,
   - 중복 선택 경고,
   - 최소/최대 인원 경고.
5. 라이브 화면에서는 현재 period 라인업 + 교체 이력 분리 표시.

### 5-1. 경기 진행 버튼(상태 머신) 변경
- 현재의 고정 버튼 흐름
  - `전반 시작 -> 전반 종료 -> 후반 시작 -> 경기 종료`
- 변경 후 권장 흐름(쿼터형)
  - `1Q 시작 -> 1Q 종료 -> 2Q 시작 -> 2Q 종료 -> ... -> 경기 종료`

핵심은 "문구만 바꾸는 것"이 아니라, **경기 포맷별 period 시퀀스를 설정값으로 관리**하는 것이다.

예시(내부 로직은 `sequence`, 화면은 `label/period_code`):
- 축구(기본): `sequence=1,2` + label=`전반`,`후반`
- 농구/풋살 리그: `sequence=1..4` + code=`Q1..Q4`
- 필요 시 연장: `sequence=5,6` + code=`ET1`,`ET2`

UI 동작 원칙:
1. 현재 period가 시작 전이면 `N번째 period 시작` 버튼 노출.
2. 현재 period 진행 중이면 `N번째 period 종료` 버튼 노출.
3. 마지막 period 종료 후 `경기 종료` 버튼 노출.
4. period 시작 시 해당 `sequence`의 스타팅 라인업이 없으면 저장 모달(또는 경고) 띄우기.
5. "다음 period 시작" 전 "이전 period 라인업 복사" CTA를 항상 제공.

운영상 이점:
- 전/후반 종목과 쿼터 종목을 같은 UI 프레임으로 처리 가능.
- 향후 대회 규정(3쿼터, 6피리어드 등) 변경에도 코드 수정 범위 최소화.

---

## 6) 마이그레이션/전환 전략

1. 신규 테이블 배포 (`match_periods`, `match_period_lineups`) (읽기 미연결).
2. API에 읽기 병행 추가 (없으면 기존 방식 fallback).
3. 관리자 UI에 "신규 라인업 저장" 먼저 연결.
4. 경기 진행 버튼을 period 시퀀스 기반으로 전환(기존 전/후반 하드코딩 제거).
5. 안정화 후 starter 이벤트 의존 코드 정리.
6. 데이터 백필(선택):
   - match별 기본 `match_periods` 생성(기존은 축구 기준 `sequence=1,2`로 시작)
   - 기존 `match_participation_events`에서 `is_starter=true`를 period별로 추출해 신규 테이블에 이관.

---

## 7) 예상 일정(실무 기준)

전제: 1명 개발, 기존 코드 이해도 보통, QA 포함.

- 설계/마이그레이션(2테이블): **1~1.5일**
- API 구현/검증(period 관리 + lineup): **1.5~2.5일**
- 관리자 UI(탭/복사/검증 + 진행 버튼 상태전환): **2~3일**
- 라이브/조회 화면 연동: **0.5~1일**
- QA/버그픽스/데이터 이관 스크립트: **1~2일**

**총 6~10일 (약 1.5~2주)**

---

## 8) 장단점 비교

### 권장안(A: `match_periods` + 별도 라인업 테이블)
**장점**
- "몇 period 경기인지"를 match별로 명시적으로 관리 가능.
- `sequence` 기반으로 진행 제어/정렬/다음 period 계산이 단순.
- 스타팅(스냅샷)과 교체(이벤트) 모델 분리로 도메인 명확.
- 전/후반, 쿼터, 연장 등 포맷 확장 쉬움.
- UI 구현과 검증 로직이 직관적.

**단점**
- 테이블/API 추가로 초기 개발량 증가(기존안 대비 +0.5~1.5일).
- 기존 starter 이벤트 기반 코드와 이중 관리 구간이 일시적으로 발생.

### 대안(B: 기존 `match_participation_events`만으로 처리)
**장점**
- 신규 테이블 없이 빠르게 구현 가능.
- 마이그레이션 범위 작음.

**단점**
- "스타팅 스냅샷" 조회가 복잡(이벤트 재구성 필요).
- period별 사전 등록 UX가 불명확.
- 장기적으로 교체/스타팅 규칙이 섞여 유지보수 난이도 상승.

---


## 9) 대안 비교: "한 경기 + period" vs "같은 팀간 다경기 + 그룹 승점"

질문 주신 대안은 아래처럼 해석할 수 있다.
- **모델 C(다경기/승점형)**: 경기그룹 안에 같은 팀 조합의 경기를 여러 개 만든다.
  - 예) `A vs B`를 `Match#1`, `Match#2`, `Match#3`로 생성
  - 그룹 단위로 승/무/패 및 승점을 집계

### 언제 C가 잘 맞는가
- 실제 대회 규칙이 "세트/게임별 독립 결과"를 갖는 경우
  - 예) 3판 2선승, 리그전 미니게임 누적 승점
- 각 구간이 시간 흐름(period)이 아니라 **독립 경기 결과**로 기록되어야 할 때

### C의 장점
1. 도메인 정합성: 각 구간 결과를 독립 경기로 저장하므로 통계/순위 계산이 명확.
2. 승점 계산 단순화: 경기 단위 승패를 그룹에서 합산하면 됨.
3. 리포트 친화성: "1차전/2차전/3차전" 리포트가 직관적.

### C의 단점
1. 라이브 운영 불편: 운영자는 하나의 실제 경기인데 UI에서 여러 경기 전환이 필요.
2. 이벤트 분산: 득점/교체 로그가 match별로 쪼개져 실시간 추적이 번거로움.
3. 기존 기능 영향: 현재 match 중심 화면/라우팅(`/m/[matchId]`)을 많이 수정해야 할 가능성.

### 모델 A(한 경기 + period 라인업)와의 비교 요약
- **실제 현장 흐름이 "한 경기를 쿼터로 나눔"**이라면 A가 더 자연스럽다.
- **대회 규칙이 "여러 독립 경기의 합산"**이라면 C가 더 정확하다.

### 추천 의사결정(혼합 전략)
1. 기본 운영은 **A(한 경기 + period)**로 유지.
2. 필요 시 `match_groups.scoring_mode`(예: `single_match_period`, `multi_match_points`)를 추가.
3. `multi_match_points`일 때만 그룹 집계(승점 테이블/뷰) 활성화.

이렇게 하면 기존 라이브 UI를 크게 흔들지 않으면서, 특정 리그 포맷만 점진적으로 수용할 수 있다.

---

## 10) `period_code` vs `sequence` 검토 결론

### `sequence` 중심이 좋은 이유
1. 정렬/비교가 숫자 기반이라 안전함 (`Q10` vs `Q2` 같은 문자열 이슈 없음).
2. UI/상태머신/쿼리(`next period`)를 공통 로직으로 처리 가능.
3. 종목별 라벨 차이는 `label`/`period_code`로 흡수 가능.

### `period_code`를 완전히 버려야 하나?
- 아니다. **표시/외부연동 용도**로 유지 가치가 있다.
- 다만 코어 식별자는 `match_periods.id` + `sequence`를 권장.

### "period 숫자 컬럼만 match에 추가" 대안
- 예: `matches.period_count = 4`만 두고 period row를 만들지 않는 방식
- 장점: 초기 개발이 빠름
- 단점: 각 period별 상태(`pending/live/ended`), 시작/종료 시각, 커스텀 라벨 관리가 어려움

결론적으로, `period_count`는 보조 컬럼으로는 유효하지만,
운영 UI/상태 제어까지 고려하면 `match_periods`를 두는 편이 장기적으로 안정적이다.

---

## 11) 권장 의사결정

- 지금 단계에서 전/후반(향후 쿼터)별 스타팅을 **운영 기능**으로 확실히 가져가려면,
  **A안(별도 라인업 테이블)**로 가는 것이 안전하다.
- 단기 출시가 최우선이면 B안으로 임시 적용 후, 다음 스프린트에서 A안으로 승격하는 2단계 전략도 가능.

---

## 12) 구현 체크리스트
- [ ] Supabase migration: `match_periods`, `match_period_lineups` 생성
- [ ] match 생성/수정 시 period 개수(`period_count` 또는 period row) 설정 UX 정의
- [ ] 라인업 CRUD API + 엔트리 검증
- [ ] 관리자 화면 Period 탭 + "이전 period 복사"
- [ ] 진행 버튼을 period 시퀀스 기반(`NQ 시작/종료`)으로 전환
- [ ] (선택) 경기그룹 `scoring_mode` 도입 및 그룹 승점 집계 뷰/쿼리 정의
- [ ] 라이브/조회 API 응답 확장
- [ ] 백필 스크립트(필요 시)
- [ ] 롤백 플랜(테이블 드롭 대신 기능 플래그 비활성 권장)

---

## 13) 브랜치 구현 시작 현황 (1차)

이번 브랜치에서 우선 반영한 항목:
1. **DB 스키마 선반영**
   - `matches.period_count` 추가(기본 2, 범위 체크)
   - `match_periods`, `match_period_lineups` 신규 생성
   - `match_period_lineups.match_id`와 `match_periods.match_id` 정합성 트리거 추가
   - 기존 경기 대상 기본 period row 백필(1..period_count)
2. **UI 파서(헬퍼) 도입**
   - `sequence`/`label`/`period_code` 기반 표시명을 계산하는 유틸 추가
   - 기존 전/후반 상태값을 period 라벨로 매핑해 버튼/상태 텍스트를 동적으로 표시
3. **기존 흐름과 호환 유지**
   - 실제 상태 전환 로직(`start_first/end_first/start_second/end_match`)은 유지
   - 즉, 이번 단계는 "구조 준비 + 표시/파서 시작"까지 반영하고,
     다음 단계에서 period row 기반 상태머신으로 치환 예정

다음 구현 우선순위:
- period row 기반 시작/종료 API(`start|end`)로 `applyPeriodAction` 치환
- 라인업 CRUD(`match_period_id` 기준) 및 "이전 period 복사"
- `match_participation_events.is_starter` 의존 제거(읽기 fallback만 유지)

## 14) 구현 진행 업데이트 (2차)

이번 반영에서 추가로 처리한 항목:
- **빌드 안정화**: `next/font/google` 의존을 제거해 오프라인/네트워크 제한 환경에서도 `next build`가 실패하지 않도록 조정.
- **period row 기반 진행 제어 시작**: 경기 상세의 period 제어 액션을 `match_periods.status`(`pending/live/ended`) 중심으로 동작하도록 전환하고, 기존 `matches.period_state`는 호환용으로 동기화.
- **라인업 저장 전환**: 관리자 경기그룹 화면의 선발 제출 저장소를 `match_participation_events(is_starter)`에서 `match_period_lineups`로 전환.
- **이전 period 복사**: 동일 화면에서 `N period` 선발에 대해 `N-1 period` 선발 복사 액션 추가.
- **읽기 fallback 유지**: 라이브 화면은 `match_period_lineups`를 우선 사용하고, 데이터가 없으면 기존 starter 이벤트를 fallback으로 사용.
- **period_count 운영 반영**: 경기 생성/수정에서 `period_count`를 설정하고 부족한 `match_periods` row를 자동 보충.

남은 작업(후속):
- `match_period_lineups`에 `player_name` 입력 지원(비등록 선수 완전 대응)
- period 상태머신을 `matches.period_state` 의존 없이 완전 분리
- scoreboard API에서 현재 period/라인업 비교 응답 정식화

## 15) 구현 진행 업데이트 (3차)

요청 반영: **특정 period 시작 전 교체 예약**
- `match_period_substitution_plans` 테이블을 추가해, 즉시 교체와 분리된 예약 교체를 저장.
- 경기 화면의 교체 모달에서 `즉시 교체` / `Period 시작 전 예약` 모드를 선택 가능하게 변경.
- 예약은 `pending` 상태 period만 선택 가능하며, period 시작 액션 시 자동으로 교체 이벤트(`out/in`)로 반영.
- 잘못된 예약(이미 시작/종료된 period, 동일 선수 OUT/IN)은 서버에서 차단.
- 시작 전에는 이미 예약에 포함된 선수(OUT/IN)를 같은 period에 다시 예약할 수 없도록 중복 예약 차단.
- 시작 전 예약은 경기 화면에서 개별 취소 가능(`예약 취소` 버튼).
