export const revalidate = 180;

import { getSupabaseServerClient } from "@/lib/supabase";
import ExpandableRankingList from "./ExpandableRankingList";
import ScorerRankingWithLogs from "./ScorerRankingWithLogs";
import UserGNB from "@/components/UserGNB";
import { resolveTeamColor } from "@/lib/teamColor";

type Channel = { id: string; name: string; slug: string };
type Match = {
  id: string;
  match_group_id: string | null;
  seq: number;
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
  minute: number | null;
  created_at: string;
  scorer_player_id: string | null;
  assist_player_id: string | null;
  scorer_name: string | null;
  assist_name: string | null;
  deleted_at: string | null;
};
type RatingRow = { target_player_id: string; rating: number };
type PlayerRow = { id: string; player_name: string; team_id: string; jersey_no: string | null };
type TeamRow = { id: string; name: string; color_hex: string | null };

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
    .select("id,match_group_id,seq,team_a_id,team_b_id,team_a_name,team_b_name,score_a,score_b,status")
    .eq("channel_id", channel.id)
    .eq("status", "ended")
    .returns<Match[]>();

  const matchIds = (matches ?? []).map((m) => m.id);
  const groupIds = Array.from(new Set((matches ?? []).map((m) => m.match_group_id).filter((v): v is string => Boolean(v))));

  const { data: groups } = groupIds.length
    ? await supabase
        .from("match_groups")
        .select("id,play_date,title,seq")
        .in("id", groupIds)
        .returns<{ id: string; play_date: string; title: string | null; seq: number }[]>()
    : { data: [] as { id: string; play_date: string; title: string | null; seq: number }[] };

  const { data: goals } = matchIds.length
    ? await supabase
        .from("goal_events")
        .select("match_id,minute,created_at,scorer_player_id,assist_player_id,scorer_name,assist_name,deleted_at")
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
    .select("id,player_name,team_id,jersey_no")
    .eq("channel_id", channel.id)
    .returns<PlayerRow[]>();

  const { data: teams } = await supabase
    .from("channel_teams_view")
    .select("id,name,color_hex")
    .eq("channel_id", channel.id)
    .returns<TeamRow[]>();

  const teamMap = new Map<string, TeamStat>();
  const teamNameById = new Map((teams ?? []).map((t) => [t.id, t.name]));
  const teamColorById = new Map(
    (teams ?? []).map((t) => [t.id, resolveTeamColor({ teamId: t.id, teamName: t.name, colorHex: t.color_hex })]),
  );
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

  const playerById = new Map((players ?? []).map((p) => [p.id, p]));

  const groupById = new Map((groups ?? []).map((g) => [g.id, g]));
  const matchById = new Map((matches ?? []).map((m) => [m.id, m]));

  const scorerMap = new Map<string, { key: string; name: string; team: string; jersey: string | null; goals: number }>();
  const scorerLogs = new Map<string, { matchId: string; matchLabel: string; minute: number | null; assistLabel: string | null; createdAt: string }[]>();
  const assistMap = new Map<string, { name: string; team: string; jersey: string | null; assists: number }>();

  for (const g of goals ?? []) {
    if (g.scorer_player_id || g.scorer_name) {
      const key = g.scorer_player_id ? `p:${g.scorer_player_id}` : `n:${g.scorer_name}`;
      const p = g.scorer_player_id ? playerById.get(g.scorer_player_id) : undefined;
      const prev = scorerMap.get(key) ?? {
        key,
        name: p?.player_name ?? g.scorer_name ?? "-",
        team: p ? (teamNameById.get(p.team_id) ?? "-") : "-",
        jersey: p?.jersey_no ?? null,
        goals: 0,
      };
      scorerMap.set(key, { ...prev, goals: prev.goals + 1 });

      const m = matchById.get(g.match_id);
      const group = m?.match_group_id ? groupById.get(m.match_group_id) : null;
      const matchLabel = group
        ? `${group.play_date} · ${m?.seq ?? "-"}경기 · ${m?.team_a_name ?? ""} vs ${m?.team_b_name ?? ""}`
        : `${m?.team_a_name ?? "-"} vs ${m?.team_b_name ?? "-"}`;
      const assistPlayer = g.assist_player_id ? playerById.get(g.assist_player_id) : null;
      const assistLabel = assistPlayer
        ? `${assistPlayer.jersey_no ? `#${assistPlayer.jersey_no} ` : ""}${assistPlayer.player_name}`
        : g.assist_name;
      const logs = scorerLogs.get(key) ?? [];
      logs.push({
        matchId: g.match_id,
        matchLabel,
        minute: g.minute,
        assistLabel: assistLabel ?? null,
        createdAt: g.created_at,
      });
      scorerLogs.set(key, logs);
    }

    if (g.assist_player_id) {
      const p = playerById.get(g.assist_player_id);
      const key = `p:${g.assist_player_id}`;
      const prev = assistMap.get(key) ?? {
        name: p?.player_name ?? g.assist_name ?? "-",
        team: p ? (teamNameById.get(p.team_id) ?? "-") : "-",
        jersey: p?.jersey_no ?? null,
        assists: 0,
      };
      assistMap.set(key, { ...prev, assists: prev.assists + 1 });
    } else if (g.assist_name) {
      const key = `n:${g.assist_name}`;
      const prev = assistMap.get(key) ?? { name: g.assist_name, team: "-", jersey: null, assists: 0 };
      assistMap.set(key, { ...prev, assists: prev.assists + 1 });
    }
  }

  const scorers = [...scorerMap.values()]
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));

  const assisters = [...assistMap.values()]
    .sort((a, b) => b.assists - a.assists || a.name.localeCompare(b.name));

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
        <UserGNB
          slug={channel.slug}
          channelName={channel.name}
          current="stats"
          subtitle="팀 순위 / 득점 / 어시스트 / 평점"
        />

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
                      <td className="py-1 pr-2">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-sm border border-black/10"
                            style={{ backgroundColor: t.key.startsWith('name:') ? resolveTeamColor({ teamName: t.team }) : (teamColorById.get(t.key) ?? '#D1D5DB') }}
                          />
                          <span>{t.team}</span>
                        </span>
                      </td>
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
              <ScorerRankingWithLogs
                items={scorers.map((s) => ({
                  key: s.key,
                  name: s.name,
                  team: s.team,
                  jersey: s.jersey,
                  value: s.goals,
                  logs: scorerLogs.get(s.key) ?? [],
                }))}
              />
            )}
          </section>

          <section className="rounded border p-4">
            <h2 className="text-sm font-semibold mb-2">어시스트 순위</h2>
            {assisters.length === 0 ? (
              <p className="text-sm text-gray-500">기록이 없습니다.</p>
            ) : (
              <ExpandableRankingList
                items={assisters.map((a) => ({ name: a.name, team: a.team, jersey: a.jersey, value: a.assists }))}
              />
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
