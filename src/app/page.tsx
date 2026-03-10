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

  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-4xl mx-auto space-y-4">
        <h1 className="text-3xl font-semibold">quick-scoreboard</h1>
        <p className="text-sm text-gray-600">화이트보드 대체용 경기 중심 스코어보드</p>

        <section className="rounded border p-4 space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">운영 중 리그</h2>
          {(channels ?? []).length === 0 ? (
            <p className="text-sm text-gray-500">표시할 공개 리그가 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {(channels ?? []).map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/c/${encodeURIComponent(c.slug)}`}
                    className="rounded border px-3 py-2 flex items-center justify-between gap-2 hover:bg-gray-50 transition-colors"
                  >
                    <div>
                      <div className="font-medium text-sm">{c.name}</div>
                      <div className="text-xs text-gray-500">/{c.slug}</div>
                    </div>
                    <span className="text-sm text-gray-500">열기 &rsaquo;</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded border p-4 space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">도움말</h2>
          <div className="flex flex-col gap-1 text-sm">
            <Link className="underline" href="/guide">
              사용방법 보기
            </Link>
          </div>
        </section>
      </section>
    </main>
  );
}
