import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase";

type Channel = { id: string; name: string; slug: string };
type Match = {
  id: string;
  team_a_id: string | null;
  team_b_id: string | null;
  team_a_name: string;
  team_b_name: string;
  score_a: number;
  score_b: number;
  status: "scheduled" | "live" | "ended";
};
type Goal = {
  match_id: string;
  scorer_name: string | null;
  assist_name: string | null;
  deleted_at: string | null;
};
type RatingRow = { target_player_id: string; rating: number };
type PlayerRow = { id: string; player_name: string; team_id: string };
type TeamRow = { id: string; name: string };

type TeamStat = {
  key: string;
  team: string;
  played: number;
  win: number;
  draw: number;
  loss: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
};

export default async function StatsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return <main className="p-6">Supabase env가 필요합니다.</main>;
  }

  const { data: channel } = await supabase
    .from("channels")
    .select("id,name,slug")
    .eq("slug", slug)
    .maybeSingle<Channel>();

  if (!channel) {
    return <main className="p-6">리그를 찾을 수 없습니다.</main>;
  }

  const { data: matches } = await supabase
    .from("matches")
    .select("id,team_a_id,team_b_id,team_a_name,team_b_name,score_a,score_b,status")
    .eq("channel_id", channel.id)
    .eq("status", "ended")
    .returns<Match[]>();

  const matchIds = (matches ?? []).map((m) => m.id);

  const { data: goals } = matchIds.length
    ? await supabase
        .from("goal_events")
        .select("match_id,scorer_name,assist_name,deleted_at")
        .in("match_id", matchIds)
        .is("deleted_at", null)
        .returns<Goal[]>()
    : { data: [] as Goal[] };

  const { data: ratings } = matchIds.length
    ? await supabase
        .from("player_ratings")
        .select("target_player_id,rating")
        .in("match_id", matchIds)
        .returns<RatingRow[]>()
    : { data: [] as RatingRow[] };

  const { data: players } = await supabase
    .from("team_players")
    .select("id,player_name,team_id")
    .eq("channel_id", channel.id)
    .returns<PlayerRow[]>();

  const { data: teams } = await supabase
    .from("channel_teams_view")
    .select("id,name")
    .eq("channel_id", channel.id)
    .returns<TeamRow[]>();

  const teamMap = new Map<string, TeamStat>();
  const teamNameById = new Map((teams ?? []).map((t) => [t.id, t.name]));
  const getTeam = (teamId: string | null, fallbackName: string) => {
    const key = teamId ?? `name:${fallbackName}`;
    const found = teamMap.get(key);
    if (found) return found;
    const init: TeamStat = {
      key,
      team: teamId ? (teamNameById.get(teamId) ?? fallbackName) : fallbackName,
      played: 0,
      win: 0,
      draw: 0,
      loss: 0,
      gf: 0,
      ga: 0,
      gd: 0,
      pts: 0,
    };
    teamMap.set(key, init);
    return init;
  };

  for (const m of matches ?? []) {
    const a = getTeam(m.team_a_id, m.team_a_name);
    const b = getTeam(m.team_b_id, m.team_b_name);

    a.played += 1;
    b.played += 1;
    a.gf += m.score_a;
    a.ga += m.score_b;
    b.gf += m.score_b;
    b.ga += m.score_a;

    if (m.score_a > m.score_b) {
      a.win += 1;
      b.loss += 1;
      a.pts += 3;
    } else if (m.score_a < m.score_b) {
      b.win += 1;
      a.loss += 1;
      b.pts += 3;
    } else {
      a.draw += 1;
      b.draw += 1;
      a.pts += 1;
      b.pts += 1;
    }
  }

  const teamStats = [...teamMap.values()]
    .map((t) => ({ ...t, gd: t.gf - t.ga }))
    .sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.team.localeCompare(y.team));

  const scorerMap = new Map<string, number>();
  const assistMap = new Map<string, number>();

  for (const g of goals ?? []) {
    if (g.scorer_name) {
      scorerMap.set(g.scorer_name, (scorerMap.get(g.scorer_name) ?? 0) + 1);
    }
    if (g.assist_name) {
      assistMap.set(g.assist_name, (assistMap.get(g.assist_name) ?? 0) + 1);
    }
  }

  const scorers = [...scorerMap.entries()]
    .map(([name, goals]) => ({ name, goals }))
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));

  const assisters = [...assistMap.entries()]
    .map(([name, assists]) => ({ name, assists }))
    .sort((a, b) => b.assists - a.assists || a.name.localeCompare(b.name));

  const playerById = new Map((players ?? []).map((p) => [p.id, p]));
  const ratingAgg = new Map<string, { player: string; team: string; count: number; avg: number }>();

  for (const r of ratings ?? []) {
    const p = playerById.get(r.target_player_id);
    if (!p) continue;
    const key = r.target_player_id;
    const prev = ratingAgg.get(key) ?? {
      player: p.player_name,
      team: teamNameById.get(p.team_id) ?? "-",
      count: 0,
      avg: 0,
    };
    const total = prev.avg * prev.count + r.rating;
    const count = prev.count + 1;
    ratingAgg.set(key, {
      player: prev.player,
      team: prev.team,
      count,
      avg: Number((total / count).toFixed(2)),
    });
  }

  const ratingLeaders = [...ratingAgg.values()]
    .sort((a, b) => b.avg - a.avg || b.count - a.count || a.player.localeCompare(b.player));

  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-5xl mx-auto space-y-5">
        <header className="space-y-1">
          <div className="text-xs text-gray-500 flex items-center gap-1">
            <Link className="underline" href={`/c/${channel.slug}`}>리그 경기목록</Link>
            <span>›</span>
            <span>통계</span>
          </div>
          <h1 className="text-2xl font-semibold">통계</h1>
          <p className="text-sm text-gray-600">{channel.name} · 팀 순위 / 득점 / 어시스트 / 평점</p>
        </header>

        <section className="rounded border p-4">
          <h2 className="text-sm font-semibold mb-2">팀 순위</h2>
          {teamStats.length === 0 ? (
            <p className="text-sm text-gray-500">종료된 경기가 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-1 pr-2">순위</th>
                    <th className="py-1 pr-2">팀</th>
                    <th className="py-1 pr-2">경기</th>
                    <th className="py-1 pr-2">승</th>
                    <th className="py-1 pr-2">무</th>
                    <th className="py-1 pr-2">패</th>
                    <th className="py-1 pr-2">득점</th>
                    <th className="py-1 pr-2">실점</th>
                    <th className="py-1 pr-2">득실</th>
                    <th className="py-1 pr-2">승점</th>
                  </tr>
                </thead>
                <tbody>
                  {teamStats.map((t, i) => (
                    <tr key={t.key} className="border-b last:border-0">
                      <td className="py-1 pr-2">{i + 1}</td>
                      <td className="py-1 pr-2">{t.team}</td>
                      <td className="py-1 pr-2">{t.played}</td>
                      <td className="py-1 pr-2">{t.win}</td>
                      <td className="py-1 pr-2">{t.draw}</td>
                      <td className="py-1 pr-2">{t.loss}</td>
                      <td className="py-1 pr-2">{t.gf}</td>
                      <td className="py-1 pr-2">{t.ga}</td>
                      <td className="py-1 pr-2">{t.gd}</td>
                      <td className="py-1 pr-2 font-semibold">{t.pts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="grid md:grid-cols-2 gap-4">
          <section className="rounded border p-4">
            <h2 className="text-sm font-semibold mb-2">득점 순위</h2>
            {scorers.length === 0 ? (
              <p className="text-sm text-gray-500">기록이 없습니다.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {scorers.map((s, i) => (
                  <li key={s.name} className="flex justify-between border-b last:border-0 py-1">
                    <span>{i + 1}. {s.name}</span>
                    <span className="font-medium">{s.goals}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded border p-4">
            <h2 className="text-sm font-semibold mb-2">어시스트 순위</h2>
            {assisters.length === 0 ? (
              <p className="text-sm text-gray-500">기록이 없습니다.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {assisters.map((a, i) => (
                  <li key={a.name} className="flex justify-between border-b last:border-0 py-1">
                    <span>{i + 1}. {a.name}</span>
                    <span className="font-medium">{a.assists}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded border p-4">
            <h2 className="text-sm font-semibold mb-2">평점 순위</h2>
            {ratingLeaders.length === 0 ? (
              <p className="text-sm text-gray-500">평점 기록이 없습니다.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {ratingLeaders.slice(0, 30).map((r, i) => (
                  <li key={`${r.team}-${r.player}`} className="flex justify-between border-b last:border-0 py-1">
                    <span>{i + 1}. {r.player} <span className="text-xs text-gray-500">({r.team})</span></span>
                    <span className="font-medium">{r.avg} <span className="text-xs text-gray-500">({r.count})</span></span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
