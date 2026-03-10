import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";

type Channel = { id: string; name: string; slug: string };
type MatchGroup = { id: string; channel_id: string; play_date: string; venue: string | null; title: string | null };
type Match = { id: string; match_group_id: string | null; team_a_name: string; team_b_name: string; status: "scheduled" | "live" | "ended"; scheduled_start_at: string | null };

type DateStats = { total: number; scheduled: number; ended: number };

function daysInMonth(year: number, month0: number) {
  return new Date(year, month0 + 1, 0).getDate();
}

function weekdayOffset(year: number, month0: number) {
  return new Date(year, month0, 1).getDay();
}

export default async function ChannelCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ d?: string }>;
}) {
  const { slug } = await params;
  const { d } = await searchParams;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return <main className="min-h-screen p-4">환경설정이 필요합니다.</main>;
  }

  const { data: channel } = await supabase
    .from("channels")
    .select("id,name,slug")
    .eq("slug", slug)
    .maybeSingle<Channel>();

  if (!channel) {
    return <main className="min-h-screen p-4">리그를 찾을 수 없습니다.</main>;
  }

  const { data: groups } = await supabase
    .from("match_groups")
    .select("id,channel_id,play_date,venue,title")
    .eq("channel_id", channel.id)
    .returns<MatchGroup[]>();

  const groupIds = (groups ?? []).map((g) => g.id);
  const { data: matches } = groupIds.length
    ? await supabase
        .from("matches")
        .select("id,match_group_id,team_a_name,team_b_name,status,scheduled_start_at")
        .in("match_group_id", groupIds)
        .returns<Match[]>()
    : { data: [] as Match[] };

  const groupById = new Map((groups ?? []).map((g) => [g.id, g]));
  const statsByDate = new Map<string, DateStats>();

  for (const g of groups ?? []) {
    if (!statsByDate.has(g.play_date)) {
      statsByDate.set(g.play_date, { total: 0, scheduled: 0, ended: 0 });
    }
  }

  for (const m of matches ?? []) {
    if (!m.match_group_id) continue;
    const g = groupById.get(m.match_group_id);
    if (!g) continue;

    const stats = statsByDate.get(g.play_date) ?? { total: 0, scheduled: 0, ended: 0 };
    stats.total += 1;
    if (m.status === "ended") stats.ended += 1;
    else stats.scheduled += 1;
    statsByDate.set(g.play_date, stats);
  }

  const now = new Date();
  const year = now.getFullYear();
  const month0 = now.getMonth();
  const todayKey = `${year}-${String(month0 + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const total = daysInMonth(year, month0);
  const offset = weekdayOffset(year, month0);

  const selected = d ?? todayKey;

  const selectedGroups = (groups ?? [])
    .filter((g) => g.play_date === selected)
    .sort((a, b) => (a.venue ?? "").localeCompare(b.venue ?? ""));

  const matchesByGroup = new Map<string, Match[]>();
  for (const m of matches ?? []) {
    if (!m.match_group_id) continue;
    const arr = matchesByGroup.get(m.match_group_id) ?? [];
    arr.push(m);
    matchesByGroup.set(m.match_group_id, arr);
  }

  const cells: Array<{ date: string | null; day: number | null }> = [];
  for (let i = 0; i < offset; i++) cells.push({ date: null, day: null });
  for (let day = 1; day <= total; day++) {
    const date = `${year}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ date, day });
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 pb-24 md:p-6">
      <section className="mx-auto max-w-4xl space-y-4">
        <header className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-xl font-semibold">{channel.name} · 달력 보기</h1>
            <Link href={`/c/${encodeURIComponent(channel.slug)}`} className="text-xs underline text-gray-700">
              경기목록으로
            </Link>
          </div>
          <p className="mt-1 text-xs text-gray-500">날짜를 누르면 해당 날짜 경기로 이동할 수 있어.</p>
        </header>

        <section className="rounded-2xl border bg-white p-3 shadow-sm">
          <div className="mb-2 text-sm font-medium">{year}년 {month0 + 1}월</div>
          <div className="mb-2 grid grid-cols-7 text-center text-xs">
            <div className="text-red-500">일</div><div className="text-gray-500">월</div><div className="text-gray-500">화</div><div className="text-gray-500">수</div><div className="text-gray-500">목</div><div className="text-gray-500">금</div><div className="text-blue-500">토</div>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((c, idx) => {
              const weekday = idx % 7;
              const isSunday = weekday === 0;
              const isSaturday = weekday === 6;

              if (!c.date || !c.day) return <div key={idx} className="h-16 rounded-lg bg-gray-50" />;

              const stats = statsByDate.get(c.date) ?? { total: 0, scheduled: 0, ended: 0 };
              const active = c.date === selected;
              const isToday = c.date === todayKey;
              const dayColor = isSunday ? "text-red-500" : isSaturday ? "text-blue-500" : "text-gray-800";

              return (
                <Link
                  key={c.date}
                  href={`/c/${encodeURIComponent(channel.slug)}/calendar?d=${c.date}`}
                  className={`h-16 rounded-lg border p-2 text-left text-xs ${active ? "border-blue-300 bg-blue-50" : "hover:bg-gray-50"}`}
                >
                  <div className="flex items-center justify-between">
                    <div className={`font-medium ${dayColor}`}>{c.day}</div>
                    {isToday ? <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-700">오늘</span> : null}
                  </div>
                  <div className="mt-1 text-[11px] text-gray-600">
                    {stats.total > 0 ? `완료 ${stats.ended} · 예정 ${stats.scheduled}` : "-"}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-4 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{selected} 경기</h2>
            <Link href={`/c/${encodeURIComponent(channel.slug)}#date-${selected}`} className="text-xs underline text-gray-700">
              목록에서 보기
            </Link>
          </div>

          {selectedGroups.length === 0 ? (
            <p className="text-sm text-gray-500">선택한 날짜에 경기가 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {selectedGroups.map((g) => (
                <section key={g.id} className="rounded-xl border p-3">
                  <h3 className="text-sm font-medium">{g.title ?? g.venue ?? "경기"}</h3>
                  <ul className="mt-2 space-y-1">
                    {(matchesByGroup.get(g.id) ?? []).map((m) => (
                      <li key={m.id} className="text-sm text-gray-700">
                        <Link href={`/m/${m.id}`} className="hover:underline">
                          {m.team_a_name} vs {m.team_b_name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
