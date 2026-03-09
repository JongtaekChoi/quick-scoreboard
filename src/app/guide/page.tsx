import Link from "next/link";

export default function GuidePage() {
  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-3xl mx-auto space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">사용 가이드</h1>
          <p className="text-sm text-gray-600">
            빠른 경기 기록을 위한 핵심 사용법입니다.
          </p>
        </header>

        <section className="space-y-2 text-sm">
          <h2 className="font-semibold">1) 공통 시작</h2>
          <ol className="list-decimal pl-5 space-y-1 text-gray-700">
            <li>
              리그 링크(`/c/슬러그`)로 접속합니다. (기본 예시: `/c/sample`)
            </li>
            <li>상단 로그인 폼에서 계정 ID/비밀번호로 로그인합니다.</li>
            <li>로그인 직후 비밀번호 변경 안내가 나오면 먼저 변경합니다.</li>
          </ol>
        </section>

        <section className="space-y-2 text-sm">
          <h2 className="font-semibold">2) 계정 유형별 사용 범위</h2>
          <ul className="space-y-2 text-gray-700">
            <li>
              <span className="font-medium">admin</span>: 리그 전체
              운영(경기그룹/팀/계정/변경이력) + 모든 경기 기록 수정
            </li>
            <li>
              <span className="font-medium">manager</span>: 팀 운영 + 경기 기록
              가능. 단,{" "}
              <span className="font-medium">
                본인 팀 경기 스코어 입력은 제한
              </span>
              됩니다.
            </li>
            <li>
              <span className="font-medium">player</span>: 경기 기록 가능. 단,{" "}
              <span className="font-medium">
                본인 팀 경기 스코어 입력은 제한
              </span>
              됩니다.
            </li>
          </ul>
        </section>

        <section className="space-y-2 text-sm">
          <h2 className="font-semibold">3) 경기 진행(전/후반 15분 기준)</h2>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>전반전 시작 → 전반전 종료(휴식) → 후반전 시작 → 경기 종료</li>
            <li>전반 시작/경기 종료는 확인창을 한 번 더 거칩니다.</li>
            <li>
              후반 득점 시간은 누적 분으로 저장됩니다. (예: 후반 3분 = 18분)
            </li>
            <li>
              전/후반 추가시간(루즈타임)은 수동 종료 전까지 경과 시간으로
              반영됩니다.
            </li>
          </ul>
        </section>

        <section className="space-y-2 text-sm">
          <h2 className="font-semibold">4) 스코어 입력/수정 규칙</h2>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>
              <span className="font-medium">경기 시작 전(pre)</span>:
              입력/수정/삭제 불가
            </li>
            <li>
              <span className="font-medium">전반/후반 진행중</span>:
              입력/수정/삭제 가능
            </li>
            <li>
              <span className="font-medium">휴식(halftime)</span>: 수정/삭제만
              가능, 신규 +1 불가
            </li>
            <li>
              <span className="font-medium">경기 종료(ended)</span>: admin만
              수정 가능
            </li>
          </ul>
        </section>

        <section className="space-y-2 text-sm">
          <h2 className="font-semibold">5) 운영/이력 확인</h2>
          <ul className="list-disc pl-5 space-y-1 text-gray-700">
            <li>
              통계는 리그 화면의 <span className="font-medium">통계 보기</span>
              에서 확인합니다.
            </li>
            <li>
              변경 이력은{" "}
              <span className="font-medium">어드민 &gt; 변경 이력</span>에서
              페이지 단위로 확인합니다.
            </li>
          </ul>
        </section>

        <div className="flex gap-3 text-sm">
          <Link className="underline" href="/">
            홈
          </Link>
          <Link className="underline" href="/c/sample">
            샘플 리그 열기
          </Link>
        </div>
      </section>
    </main>
  );
}
