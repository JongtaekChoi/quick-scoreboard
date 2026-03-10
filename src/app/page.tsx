import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";

type Channel = { id: string; name: string; slug: string; is_public_view: boolean };

export default async function Home() {
  const supabase = getSupabaseServerClient();

  const { data: channels } = supabase
    ? await supabase
        .from("channels")
        .select("id,name,slug,is_public_view")
        .eq("is_public_view", true)
        .order("name", { ascending: true })
        .returns<Channel[]>()
    : { data: [] as Channel[] };

  const publicChannels = channels ?? [];

  return (
    <main className="min-h-screen bg-gray-50 p-4 pb-24 md:p-6">
      <section className="mx-auto max-w-4xl space-y-4">
        <header className="rounded-2xl border bg-white p-4 md:p-5 shadow-sm">
          <h1 className="text-2xl font-semibold">광염풋쌀리그운영</h1>
          <p className="mt-1 text-sm text-gray-600">빠르게 확인하고, 바로 기록하는 리그 운영 대시보드</p>
          <div className="mt-3 inline-flex rounded-full border bg-gray-50 px-3 py-1 text-xs font-medium text-gray-700">
            공개 리그 {publicChannels.length}개 운영 중
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-2">
          <article className="rounded-2xl border bg-white p-4 shadow-sm space-y-2">
            <h2 className="text-base font-semibold">빠른 시작</h2>
            <p className="text-xs text-gray-500">처음 쓰는 사람을 위한 바로가기</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Link href="/guide" className="rounded-xl border px-3 py-2 text-sm font-medium hover:bg-gray-50">
                사용방법
              </Link>
              <Link href="/c/sample/guide" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100">
                샘플 가이드
              </Link>
            </div>
          </article>

          <article className="rounded-2xl border bg-white p-4 shadow-sm space-y-2">
            <h2 className="text-base font-semibold">오늘 할 일</h2>
            <p className="text-xs text-gray-500">가장 많이 쓰는 운영 흐름</p>
            <ul className="space-y-1 text-sm text-gray-700">
              <li>• 경기 일정 확인</li>
              <li>• 경기 진행 중 점수 입력</li>
              <li>• 종료 후 순위/통계 확인</li>
            </ul>
          </article>
        </section>

        <section className="rounded-2xl border bg-white p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">운영 중 리그</h2>
            <span className="text-xs text-gray-500">모바일 탭에서 바로 이동 가능</span>
          </div>
          {publicChannels.length === 0 ? (
            <p className="text-sm text-gray-500">표시할 공개 리그가 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {publicChannels.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/c/${encodeURIComponent(c.slug)}`}
                    className="flex min-h-11 items-center justify-between gap-2 rounded-xl border px-3 py-2 transition-colors hover:bg-gray-50"
                  >
                    <div>
                      <div className="text-sm font-medium">{c.name}</div>
                      <div className="text-xs text-gray-500">/{c.slug}</div>
                    </div>
                    <span className="text-sm text-gray-500">열기 &rsaquo;</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
    </main>
  );
}
