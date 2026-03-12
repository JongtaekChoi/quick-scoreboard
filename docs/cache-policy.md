# 캐시 정책 가이드

실시간 점수 정확도가 중요한 화면과, 조회 빈도가 높지만 즉시성이 덜 중요한 화면을 분리해 서버 렌더링 부하를 낮춘다.

## 라우트별 정책

| 라우트 | 성격 | 정책 | 목적 |
| --- | --- | --- | --- |
| `/m/[matchId]` | 실시간 라이브 스코어(민감) | `dynamic = "force-dynamic"`, `fetchCache = "force-no-store"` | 최신 스코어/교체/이벤트를 즉시 반영 (정확성 우선) |
| `/api/matches/[matchId]/scoreboard` | 실시간 스코어 API(민감) | `ETag` + `Cache-Control: s-maxage=5, stale-while-revalidate=5` | 짧은 TTL과 조건부 요청으로 트래픽 절감 + 최신성 유지 |
| `/c/[slug]` | 경기 목록(비민감) | `revalidate = 60` (ISR) | 반복 조회 시 서버 렌더 빈도 감소 (속도/비용 최적화) |
| `/c/[slug]/calendar` | 일정 달력(비민감) | `revalidate = 120` (ISR) | 월/일정 탐색 응답 개선 |
| `/c/[slug]/stats` | 통계(비민감) | `revalidate = 180` (ISR) | 집계 계산 재사용으로 렌더 비용 감소 |
| `/` | 공개 홈(비민감) | `revalidate = 300` (ISR) | 공개 채널/다음 경기 요약 캐시 |

## 운영 원칙

1. **정확성 우선 라우트**는 no-store 또는 매우 짧은 TTL을 유지한다.
2. **탐색/요약 라우트**는 ISR(`revalidate`)로 캐시해 DB 조회와 SSR 부하를 줄인다.
3. 라이브 업데이트 직후 즉시 반영이 필요하면 `revalidatePath`를 함께 사용한다.
4. 응답 바디가 큰 API는 `ETag` 기반 304 응답을 우선 고려한다.
