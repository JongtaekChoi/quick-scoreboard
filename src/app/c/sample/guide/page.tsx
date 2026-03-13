import Link from "next/link";
import LoginModal from "@/app/c/[slug]/LoginModal";
import Breadcrumb from "@/components/Breadcrumb";

export default function SampleGuidePage() {
  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-3xl mx-auto space-y-5">
        <header className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <Breadcrumb items={[
              { label: "샘플 리그", href: "/c/sample" },
              { label: "사용 가이드" },
            ]} />
            <LoginModal slug="sample" />
          </div>
          <h1 className="text-2xl font-semibold">샘플 리그 사용 가이드</h1>
          <p className="text-sm text-gray-600">
            샘플 리그는 테스트/체험용입니다. 12일이 지난 기록은 자동 정리되며, 3일마다 새 경기가 생성됩니다.
          </p>
        </header>

        <section className="rounded border p-4 space-y-3 text-sm">
          <h2 className="font-semibold">샘플 계정 (공개)</h2>

          <div>
            <p className="text-gray-600 mb-1">
              <span className="font-medium">샘플리그운영자</span> — 비밀번호: <span className="font-medium">test1234</span>
            </p>
          </div>

          <div>
            <p className="text-gray-600 mb-1">매니저 계정 (비밀번호: <span className="font-medium">1234</span>)</p>
            <ul className="list-disc pl-5 text-gray-700 space-y-1">
              <li>김민수 — FC 레드 매니저</li>
              <li>장동혁 — FC 블루 매니저</li>
              <li>조현식 — FC 그린 매니저</li>
              <li>나상호 — FC 옐로 매니저</li>
            </ul>
          </div>

          <div>
            <p className="text-gray-600 mb-1">팀원 계정 (비밀번호: <span className="font-medium">1234</span>)</p>
            <ul className="list-disc pl-5 text-gray-700 space-y-1">
              <li>이정호 — FC 레드</li>
              <li>임상우 — FC 블루</li>
              <li>문지훈 — FC 그린</li>
              <li>허성민 — FC 옐로</li>
            </ul>
          </div>
        </section>

        <section className="rounded border p-4 space-y-2 text-sm">
          <h2 className="font-semibold">체험 추천 순서</h2>
          <ol className="list-decimal pl-5 text-gray-700 space-y-1">
            <li>샘플 리그 로그인</li>
            <li>엔트리 등록/제출</li>
            <li>경기 시작 → 골 입력/수정</li>
            <li>경기 종료 후 무기명 평점 입력</li>
            <li>통계 페이지에서 득점/어시/평점 확인</li>
          </ol>
        </section>

        <section className="rounded border p-4 space-y-2 text-sm">
          <h2 className="font-semibold">일일 운영 테스트 시나리오 (권장)</h2>
          <ol className="list-decimal pl-5 text-gray-700 space-y-1">
            <li>운영자: 경기그룹 일정 등록</li>
            <li>각 매니저: 경기그룹 엔트리 등록</li>
            <li>운영자: 경기그룹 엔트리 확정</li>
            <li>일반 계정: 자기 팀 외 경기 진행 + 골/교체 이벤트 등록</li>
            <li>경기 후 참여 계정: 상대 평점 등록</li>
            <li>통계 업데이트 확인</li>
          </ol>
          <p className="text-xs text-gray-500">
            상세 체크리스트는 저장소 문서를 참고하세요.
            {" "}
            <a
              className="underline"
              href="https://github.com/JongtaekChoi/quick-scoreboard/blob/main/docs/sample-test-scenarios.md"
              target="_blank"
              rel="noreferrer"
            >
              docs/sample-test-scenarios.md
            </a>
          </p>
        </section>

        <section className="rounded border p-4 space-y-2 text-sm">
          <h2 className="font-semibold">주의사항</h2>
          <ul className="list-disc pl-5 text-gray-700 space-y-1">
            <li>샘플 데이터는 운영 데이터가 아닙니다.</li>
            <li>12일이 지난 경기 데이터는 자동으로 삭제됩니다.</li>
            <li>실제 리그 계정/데이터는 샘플과 분리해서 사용하세요.</li>
          </ul>
        </section>

        <div className="flex gap-3 text-sm">
          <Link className="underline" href="/c/sample">샘플 리그로 이동</Link>
          <Link className="underline" href="/c/sample/stats">샘플 통계 보기</Link>
        </div>
      </section>
    </main>
  );
}
