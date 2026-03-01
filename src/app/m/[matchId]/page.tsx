export default async function MatchDetailPlaceholder({
  params,
}: {
  params: Promise<{ matchId: string }>
}) {
  const { matchId } = await params

  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-3xl mx-auto space-y-2">
        <h1 className="text-2xl font-semibold">경기 상세</h1>
        <p className="text-sm text-gray-600">match_id: {matchId}</p>
        <p className="text-sm text-gray-500">다음 단계에서 +1 즉시 저장/골 이벤트 입력 화면을 구현합니다.</p>
      </section>
    </main>
  )
}
