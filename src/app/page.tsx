export const revalidate = 300;

import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";

type Channel = { id: string; name: string; slug: string; is_public_view: boolean };
type MatchGroup = { id: string; channel_id: string; play_date: string };
type Match = {
  id: string;
  match_group_id: string | null;
  team_a_id: string | null;
  team_b_id: string | null;
  team_a_name: string;
  team_b_name: string;
  scheduled_start_at: string | null;
  status: "scheduled" | "live" | "ended";
};

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

  const channelById = new Map(publicChannels.map((c) => [c.id, c]));

  const { data: groups } = supabase
    ? await supabase
        .from("match_groups")
        .select("id,channel_id,play_date")
        .in("channel_id", publicChannels.map((c) => c.id))
        .returns<MatchGroup[]>()
    : { data: [] as MatchGroup[] };

  const groupById = new Map((groups ?? []).map((g) => [g.id, g]));
  const groupIds = (groups ?? []).map((g) => g.id);

  const { data: upcoming } = supabase && groupIds.length
    ? await supabase
        .from("matches")
        .select("id,match_group_id,team_a_id,team_b_id,team_a_name,team_b_name,scheduled_start_at,status")
        .in("match_group_id", groupIds)
        .eq("status", "scheduled")
        .not("scheduled_start_at", "is", null)
        .order("scheduled_start_at", { ascending: true })
        .limit(2)
        .returns<Match[]>()
    : { data: [] as Match[] };

  const teamIds = Array.from(
    new Set(
      (upcoming ?? [])
        .flatMap((m) => [m.team_a_id, m.team_b_id])
        .filter((v): v is string => Boolean(v)),
    ),
  );

  const { data: teams } = supabase && teamIds.length
    ? await supabase
        .from("teams")
        .select("id,name")
        .in("id", teamIds)
        .returns<{ id: string; name: string }[]>()
    : { data: [] as { id: string; name: string }[] };

  const teamNameById = new Map((teams ?? []).map((t) => [t.id, t.name]));

  const nextMatches = (upcoming ?? []).map((m) => {
    const group = m.match_group_id ? groupById.get(m.match_group_id) : undefined;
    const channel = group ? channelById.get(group.channel_id) : undefined;
    const normalized = {
      ...m,
      team_a_name: m.team_a_id ? (teamNameById.get(m.team_a_id) ?? m.team_a_name) : m.team_a_name,
      team_b_name: m.team_b_id ? (teamNameById.get(m.team_b_id) ?? m.team_b_name) : m.team_b_name,
    };
    return { match: normalized, group, channel };
  });

  return (
    <main className="min-h-screen bg-gray-50 p-4 pb-24 md:p-6">
      <section className="mx-auto max-w-4xl space-y-4">
        <header className="rounded-2xl border bg-white p-4 md:p-5 shadow-sm">
          <h1 className="text-2xl font-semibold">풋살리그운영</h1>
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
            <h2 className="text-base font-semibold">다음 경기</h2>
            <p className="text-xs text-gray-500">가장 가까운 예정 경기</p>
            {nextMatches.length === 0 ? (
              <p className="text-sm text-gray-500">예정된 경기가 없습니다.</p>
            ) : (
              <ul className="space-y-2 pt-1">
                {nextMatches.map(({ match, channel }, idx) => (
                  <li key={match.id} className="rounded-xl border bg-gray-50 px-3 py-2">
                    <div className="text-xs text-gray-500">{idx === 0 ? "가장 가까운 경기" : "다음 경기"}</div>
                    <div className="mt-0.5 text-sm font-medium">{match.team_a_name} vs {match.team_b_name}</div>
                    <div className="mt-0.5 text-xs text-gray-600">
                      {new Date(match.scheduled_start_at as string).toLocaleString("ko-KR", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </div>
                    {channel ? (
                      <Link href={`/c/${encodeURIComponent(channel.slug)}`} className="mt-1 inline-block text-xs underline text-gray-700">
                        {channel.name}로 이동
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
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
