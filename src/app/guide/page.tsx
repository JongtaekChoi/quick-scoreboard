import Link from "next/link";

export default function GuidePage() {
  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-3xl mx-auto space-y-5">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">사용방법</h1>
          <p className="text-sm text-gray-600">
            화이트보드 대신 빠르게 기록하는 1분 가이드
          </p>
        </header>

        <ol className="space-y-3 text-sm list-decimal pl-5">
          <li>
            <div className="font-medium">리그 경기목록 열기</div>
            <p className="text-gray-600">
              공유받은 리그 링크(`/c/슬러그`)로 들어갑니다. 기본 시드 기준 리그는
              `/c/sls2026` 입니다.
            </p>
          </li>
          <li>
            <div className="font-medium">계정 로그인</div>
            <p className="text-gray-600">
              리그 상단에서 계정 ID/비밀번호로 로그인합니다. 권한은 관리자/팀장/팀원
              으로 나뉘며 기능 범위가 다릅니다.
            </p>
          </li>
          <li>
            <div className="font-medium">경기 시작 후 +1 입력</div>
            <p className="text-gray-600">
              편집모드에서 경기 시작 버튼을 누른 뒤 +1 버튼을 사용하세요. 골
              시간(분)은 시작 시각 기준으로 자동 기록됩니다. 팀원(player)은 본인팀
              경기 입력이 제한됩니다.
            </p>
          </li>
          <li>
            <div className="font-medium">득점자/어시스트 보정</div>
            <p className="text-gray-600">
              이벤트를 선택해 득점자와 어시스트를 수정할 수 있습니다. 엔트리가
              확정된 경우 선수 목록에서 선택하고, 필요 시 직접 입력으로 보정할 수
              있습니다.
            </p>
          </li>
          <li>
            <div className="font-medium">통계 확인</div>
            <p className="text-gray-600">
              리그 페이지의 `통계 보기` 링크에서 팀 순위/득점 순위/어시스트 순위를
              확인할 수 있습니다.
            </p>
          </li>
          <li>
            <div className="font-medium">지난 경기 찾기</div>
            <p className="text-gray-600">
              경기목록 날짜 필터로 해당 날짜 경기그룹을 빠르게 찾을 수 있습니다.
            </p>
          </li>
        </ol>

        <div className="flex gap-3 text-sm">
          <Link className="underline" href="/">
            홈
          </Link>
          <Link className="underline" href="/c/sls2026">
            샘플 리그 열기
          </Link>
        </div>
      </section>
    </main>
  );
}
