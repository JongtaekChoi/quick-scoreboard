import Link from 'next/link'

export default function GuidePage() {
  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-3xl mx-auto space-y-5">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">사용방법</h1>
          <p className="text-sm text-gray-600">화이트보드 대신 빠르게 기록하는 1분 가이드</p>
        </header>

        <ol className="space-y-3 text-sm list-decimal pl-5">
          <li>
            <div className="font-medium">채널 경기목록 열기</div>
            <p className="text-gray-600">공유받은 채널 링크(`/c/슬러그`)로 들어갑니다.</p>
          </li>
          <li>
            <div className="font-medium">편집모드 시작</div>
            <p className="text-gray-600">채널 상단에서 편집 비밀번호를 입력하면 편집모드가 켜집니다.</p>
          </li>
          <li>
            <div className="font-medium">경기 시작 후 +1 입력</div>
            <p className="text-gray-600">편집모드에서 경기 시작 버튼을 누른 뒤 +1 버튼을 사용하세요. 골 시간(분)은 시작시각 기준으로 자동 기록됩니다.</p>
          </li>
          <li>
            <div className="font-medium">선수정보는 나중에 보정</div>
            <p className="text-gray-600">득점 이벤트에서 득점자/어시를 통합 입력하세요(번호/이름/혼합 가능). 같은 경기에서 입력한 값은 자동추천됩니다.</p>
          </li>
          <li>
            <div className="font-medium">지난 경기 찾기</div>
            <p className="text-gray-600">경기목록 날짜 필터로 해당 날짜 경기그룹을 빠르게 찾을 수 있습니다.</p>
          </li>
        </ol>

        <div className="flex gap-3 text-sm">
          <Link className="underline" href="/">홈</Link>
          <Link className="underline" href="/c/sample-channel">샘플 채널 열기</Link>
        </div>
      </section>
    </main>
  )
}
