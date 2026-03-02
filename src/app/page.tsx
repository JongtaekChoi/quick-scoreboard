import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-3xl mx-auto space-y-4">
        <h1 className="text-3xl font-semibold">quick-scoreboard</h1>
        <p className="text-sm text-gray-600">화이트보드 대체용 경기 중심 스코어보드</p>

        <section className="rounded border p-4 space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">빠른 시작</h2>
          <p className="text-sm text-gray-600">채널 슬러그로 경기목록 진입</p>
          <div className="flex flex-col gap-1 text-sm">
            <Link className="underline" href="/c/sample-channel">
              /c/sample-channel 열기
            </Link>
            <Link className="underline" href="/guide">
              사용방법 보기
            </Link>
          </div>
        </section>
      </section>
    </main>
  )
}
