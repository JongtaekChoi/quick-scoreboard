import Link from "next/link";

export default function SampleGuidePage() {
  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-3xl mx-auto space-y-5">
        <header className="space-y-2">
          <div className="text-xs text-gray-500 flex items-center gap-1">
            <Link className="underline" href="/c/sample">샘플 리그</Link>
            <span>›</span>
            <span>사용 가이드</span>
          </div>
          <h1 className="text-2xl font-semibold">샘플 리그 사용 가이드</h1>
          <p className="text-sm text-gray-600">
            샘플 리그는 테스트/체험용입니다. 데이터는 주기적으로 초기화될 수 있습니다.
          </p>
        </header>

        <section className="rounded border p-4 space-y-2 text-sm">
          <h2 className="font-semibold">샘플 계정 (공개)</h2>
          <p className="text-gray-600">아래 계정 비밀번호는 모두 <span className="font-medium">test1234</span> 입니다.</p>
          <ul className="list-disc pl-5 text-gray-700 space-y-1">
            <li>admin</li>
            <li>mgr-red</li>
            <li>mgr-blue</li>
            <li>mgr-green</li>
            <li>mgr-yellow</li>
          </ul>
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
          <h2 className="font-semibold">주의사항</h2>
          <ul className="list-disc pl-5 text-gray-700 space-y-1">
            <li>샘플 데이터는 운영 데이터가 아닙니다.</li>
            <li>초기화 시 기존 입력 내용이 사라질 수 있습니다.</li>
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
