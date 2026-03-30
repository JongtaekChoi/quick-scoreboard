export const revalidate = 180;

import { getSupabaseServerClient } from "@/lib/supabase";
import { getAccountInfo } from "@/lib/channelSession";
import ExpandableRankingList from "./ExpandableRankingList";
import ScorerRankingWithLogs from "./ScorerRankingWithLogs";
import UserGNB from "@/components/UserGNB";
import ShareButton from "@/components/ShareButton";
import AccountBadge from "@/components/AccountBadge";
import LoginModal from "../LoginModal";
import { resolveTeamColor } from "@/lib/teamColor";
import TeamRankingWithDetailModal from "./TeamRankingWithDetailModal";

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
  team_side: "A" | "B";
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
type TeamRow = { id: string; name: string; short_name: string | null; color_hex: string | null };

type TeamStat = {
  key: string;
  team: string;
  fullTeam: string;
  shortTeam: string;
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

  const accountSession = await getAccountInfo(channel.slug);

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
        .select("match_id,team_side,minute,created_at,scorer_player_id,assist_player_id,scorer_name,assist_name,deleted_at")
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
    .select("id,name,short_name,color_hex")
    .eq("channel_id", channel.id)
    .returns<TeamRow[]>();

  const teamMap = new Map<string, TeamStat>();
  const teamNameById = new Map((teams ?? []).map((t) => [t.id, t.name]));
  const teamShortById = new Map((teams ?? []).map((t) => [t.id, t.short_name ?? null]));
  const teamColorById = new Map(
    (teams ?? []).map((t) => [t.id, resolveTeamColor({ teamId: t.id, teamName: t.name, colorHex: t.color_hex })]),
  );
  const getTeam = (teamId: string | null, fallbackName: string) => {
    const key = teamId ?? `name:${fallbackName}`;
    const found = teamMap.get(key);
    if (found) return found;
    const fullTeam = teamId ? (teamNameById.get(teamId) ?? fallbackName) : fallbackName;
    const shortTeam = teamId ? (teamShortById.get(teamId) ?? fullTeam) : fallbackName;
    const init: TeamStat = {
      key,
      team: shortTeam,
      fullTeam,
      shortTeam,
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
    .sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.fullTeam.localeCompare(y.fullTeam));

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
    <main className="min-h-screen bg-gray-50 px-4 pb-24 pt-0 md:px-6 md:pb-24 md:pt-0">
      <section className="max-w-5xl mx-auto space-y-5">
        <UserGNB
          slug={channel.slug}
          channelName={channel.name}
          current="stats"
          subtitle="팀 순위 / 득점 / 어시스트 / 평점"
          isLoggedIn={!!accountSession}
          rightActions={
            <>
              {!accountSession ? (
                <LoginModal slug={channel.slug} redirectTo={`/c/${encodeURIComponent(channel.slug)}/stats`} triggerClassName="rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white" />
              ) : null}
              {accountSession ? (
                <AccountBadge
                  loginId={accountSession.loginId}
                  role={accountSession.role}
                  slug={channel.slug}
                  accountHref={`/c/${encodeURIComponent(channel.slug)}/account`}
                />
              ) : null}
              <ShareButton url={`https://quick-scoreboard.vercel.app/c/${encodeURIComponent(channel.slug)}/stats`} title={`${channel.name} 통계`} />
            </>
          }
        />

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 mb-1">팀 순위</h2>
          <p className="text-xs text-gray-500 mb-2">승점/득실/다득점 기준</p>
          {teamStats.length === 0 ? (
            <p className="text-sm text-gray-500">종료된 경기가 없습니다.</p>
          ) : (
            <TeamRankingWithDetailModal
              slug={channel.slug}
              teamStats={teamStats}
              teamColorById={Object.fromEntries(teamColorById.entries())}
            />
          )}
        </section>

        <div className="grid md:grid-cols-2 gap-4">
          <section className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900 mb-1">득점 순위</h2>
            <p className="text-xs text-gray-500 mb-2">선수별 득점 기록</p>
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

          <section className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900 mb-1">어시스트 순위</h2>
            <p className="text-xs text-gray-500 mb-2">선수별 도움 기록</p>
            {assisters.length === 0 ? (
              <p className="text-sm text-gray-500">기록이 없습니다.</p>
            ) : (
              <ExpandableRankingList
                items={assisters.map((a) => ({ name: a.name, team: a.team, jersey: a.jersey, value: a.assists }))}
              />
            )}
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900 mb-1">평점 순위</h2>
            <p className="text-xs text-gray-500 mb-2">경기 후 입력된 평점 평균</p>
            {ratingLeaders.length === 0 ? (
              <p className="text-sm text-gray-500">평점 기록이 없습니다.</p>
            ) : (
              <ul className="divide-y divide-gray-100 text-sm">
                {ratingLeaders.slice(0, 30).map((r, i) => (
                  <li key={`${r.team}-${r.player}`} className="flex justify-between py-2">
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
