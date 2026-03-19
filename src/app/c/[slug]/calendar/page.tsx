export const revalidate = 120;

import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";
import UserGNB from "@/components/UserGNB";

type Channel = { id: string; name: string; slug: string };
type MatchGroup = { id: string; channel_id: string; play_date: string; venue: string | null; title: string | null };
type Match = { id: string; match_group_id: string | null; team_a_id: string | null; team_b_id: string | null; team_a_name: string; team_b_name: string; status: "scheduled" | "live" | "ended"; scheduled_start_at: string | null };

type DateStats = { total: number; scheduled: number; ended: number };

function daysInMonth(year: number, month0: number) {
  return new Date(year, month0 + 1, 0).getDate();
}

function weekdayOffset(year: number, month0: number) {
  return new Date(year, month0, 1).getDay();
}

function addMonth(year: number, month0: number, diff: number) {
  const d = new Date(year, month0 + diff, 1);
  return { year: d.getFullYear(), month0: d.getMonth() };
}

export default async function ChannelCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ d?: string; ym?: string }>;
}) {
  const { slug } = await params;
  const { d, ym } = await searchParams;

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

  const now = new Date();
  let year = now.getFullYear();
  let month0 = now.getMonth();

  if (ym && /^\d{4}-\d{2}$/.test(ym)) {
    const [y, m] = ym.split("-").map(Number);
    if (y >= 2000 && m >= 1 && m <= 12) {
      year = y;
      month0 = m - 1;
    }
  }

  const currentYm = `${year}-${String(month0 + 1).padStart(2, "0")}`;
  const prev = addMonth(year, month0, -1);
  const next = addMonth(year, month0, 1);
  const prevYm = `${prev.year}-${String(prev.month0 + 1).padStart(2, "0")}`;
  const nextYm = `${next.year}-${String(next.month0 + 1).padStart(2, "0")}`;

  const { data: groups } = await supabase
    .from("match_groups")
    .select("id,channel_id,play_date,venue,title")
    .eq("channel_id", channel.id)
    .gte("play_date", `${year}-${String(month0 + 1).padStart(2, "0")}-01`)
    .lte("play_date", `${year}-${String(month0 + 1).padStart(2, "0")}-${String(daysInMonth(year, month0)).padStart(2, "0")}`)
    .returns<MatchGroup[]>();

  const groupIds = (groups ?? []).map((g) => g.id);
  const { data: matches } = groupIds.length
    ? await supabase
        .from("matches")
        .select("id,match_group_id,team_a_id,team_b_id,team_a_name,team_b_name,status,scheduled_start_at")
        .in("match_group_id", groupIds)
        .returns<Match[]>()
    : { data: [] as Match[] };

  const teamIds = Array.from(
    new Set(
      (matches ?? [])
        .flatMap((m) => [m.team_a_id, m.team_b_id])
        .filter((v): v is string => Boolean(v)),
    ),
  );

  const { data: teams } = teamIds.length
    ? await supabase
        .from("teams")
        .select("id,name")
        .in("id", teamIds)
        .returns<{ id: string; name: string }[]>()
    : { data: [] as { id: string; name: string }[] };

  const teamNameById = new Map((teams ?? []).map((t) => [t.id, t.name]));
  const normalizedMatches = (matches ?? []).map((m) => ({
    ...m,
    team_a_name: m.team_a_id ? (teamNameById.get(m.team_a_id) ?? m.team_a_name) : m.team_a_name,
    team_b_name: m.team_b_id ? (teamNameById.get(m.team_b_id) ?? m.team_b_name) : m.team_b_name,
  }));

  const groupById = new Map((groups ?? []).map((g) => [g.id, g]));
  const statsByDate = new Map<string, DateStats>();

  for (const g of groups ?? []) {
    if (!statsByDate.has(g.play_date)) {
      statsByDate.set(g.play_date, { total: 0, scheduled: 0, ended: 0 });
    }
  }

  for (const m of normalizedMatches) {
    if (!m.match_group_id) continue;
    const g = groupById.get(m.match_group_id);
    if (!g) continue;

    const stats = statsByDate.get(g.play_date) ?? { total: 0, scheduled: 0, ended: 0 };
    stats.total += 1;
    if (m.status === "ended") stats.ended += 1;
    else stats.scheduled += 1;
    statsByDate.set(g.play_date, stats);
  }

  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const total = daysInMonth(year, month0);
  const offset = weekdayOffset(year, month0);

  const selected = d && /^\d{4}-\d{2}-\d{2}$/.test(d)
    ? d
    : `${year}-${String(month0 + 1).padStart(2, "0")}-01`;

  const selectedGroups = (groups ?? [])
    .filter((g) => g.play_date === selected)
    .sort((a, b) => (a.venue ?? "").localeCompare(b.venue ?? ""));

  const matchesByGroup = new Map<string, Match[]>();
  for (const m of normalizedMatches) {
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
    <main className="min-h-screen bg-gray-50 p-3 pb-24 md:p-6">
      <section className="mx-auto max-w-4xl space-y-3 md:space-y-4">
        <UserGNB
          slug={channel.slug}
          channelName={channel.name}
          current="calendar"
          subtitle="날짜를 누르면 해당 날짜 경기로 이동할 수 있습니다."
        />

        <section className="rounded-2xl border border-gray-200 bg-white p-2.5 md:p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <Link
              href={`/c/${encodeURIComponent(channel.slug)}/calendar?ym=${prevYm}`}
              className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
            >
              이전달
            </Link>
            <div className="text-sm font-medium">{year}년 {month0 + 1}월</div>
            <Link
              href={`/c/${encodeURIComponent(channel.slug)}/calendar?ym=${nextYm}`}
              className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
            >
              다음달
            </Link>
          </div>

          <div className="mb-1.5 grid grid-cols-7 text-center text-xs">
            <div className="text-red-500">일</div><div className="text-gray-500">월</div><div className="text-gray-500">화</div><div className="text-gray-500">수</div><div className="text-gray-500">목</div><div className="text-gray-500">금</div><div className="text-blue-500">토</div>
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {cells.map((c, idx) => {
              const weekday = idx % 7;
              const isSunday = weekday === 0;
              const isSaturday = weekday === 6;

              if (!c.date || !c.day) return <div key={idx} className="h-14 rounded-lg bg-gray-50/80" />;

              const stats = statsByDate.get(c.date) ?? { total: 0, scheduled: 0, ended: 0 };
              const active = c.date === selected;
              const isToday = c.date === todayKey;
              const dayColor = isSunday ? "text-red-500" : isSaturday ? "text-blue-500" : "text-gray-800";

              return (
                <Link
                  key={c.date}
                  href={`/c/${encodeURIComponent(channel.slug)}/calendar?ym=${currentYm}&d=${c.date}`}
                  className={`h-14 rounded-lg border border-gray-200 p-1.5 text-left text-xs ${active ? "border-blue-300 bg-blue-50" : "hover:bg-gray-50"}`}
                >
                  <div className="flex items-center justify-between">
                    <div className={`font-medium ${dayColor}`}>{c.day}</div>
                    {isToday ? <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" aria-label="오늘" /> : null}
                  </div>
                  <div className="mt-1 text-[11px] text-gray-600 leading-tight">
                    {stats.total > 0 ? (
                      <>
                        <span className="md:hidden">{stats.total}경기</span>
                        <span className="hidden md:inline">완료 {stats.ended} · 예정 {stats.scheduled}</span>
                      </>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-3 md:p-4 shadow-sm space-y-2">
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
                <section key={g.id} className="rounded-xl border border-gray-200 p-3">
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
