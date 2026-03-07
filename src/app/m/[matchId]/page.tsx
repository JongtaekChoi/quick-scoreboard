import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import {
  isEditAuthorized,
  validateManagerAgainstDb,
  getAccountInfo,
} from "@/lib/channelSession";
import { isAdminAuthorized } from "@/lib/adminAuth";
import { autoStartDueMatches } from "@/lib/matchSchedule";
import ScoreActions from "./ScoreActions";
import LiveScoreboard from "./LiveScoreboard";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import ShareButton from "@/components/ShareButton";

type Match = {
  id: string;
  seq: number;
  team_a_name: string;
  team_b_name: string;
  score_a: number;
  score_b: number;
  status: "scheduled" | "live" | "ended";
  scheduled_start_at: string | null;
  started_at: string | null;
  channel_id: string;
  match_group_id: string | null;
};

type Channel = { id: string; slug: string; edit_session_version: number };
type MatchGroup = {
  id: string;
  play_date: string;
  venue: string | null;
  title: string | null;
  seq: number;
};

type GoalEvent = {
  id: string;
  team_side: "A" | "B";
  minute: number | null;
  scorer_name: string | null;
  scorer_player_id: string | null;
  assist_name: string | null;
  assist_player_id: string | null;
  created_at: string;
};

type Alias = { jersey_no: string | null; player_name: string | null };

type RosterPlayer = {
  playerId: string;
  jerseyNo: string;
  playerName: string;
  value: string;
};

type GoalPermission = { canGoalEdit: boolean; canManageMatch: boolean };

async function getChannelPermission(
  channelSlug: string,
  channelVersion: number,
): Promise<GoalPermission> {
  const isAdmin = await isAdminAuthorized();
  if (isAdmin) return { canGoalEdit: true, canManageMatch: true };

  const supabase = getSupabaseServerClient();
  if (!supabase) return { canGoalEdit: false, canManageMatch: false };

  const { data: ch } = await supabase
    .from("channels")
    .select("id")
    .eq("slug", channelSlug)
    .maybeSingle<{ id: string }>();

  if (ch) {
    const { ok } = await validateManagerAgainstDb(channelSlug, ch.id);
    if (ok) return { canGoalEdit: true, canManageMatch: true };
  }

  const isEditor = await isEditAuthorized(channelSlug, channelVersion);
  if (isEditor) return { canGoalEdit: true, canManageMatch: false };

  return { canGoalEdit: false, canManageMatch: false };
}

async function addGoal(
  matchId: string,
  teamSide: "A" | "B",
  channelSlug: string,
  channelVersion: number,
) {
  "use server";

  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  const permission = await getChannelPermission(channelSlug, channelVersion);
  if (!permission.canGoalEdit) return;

  const { data: match } = await supabase
    .from("matches")
    .select("id,status,started_at")
    .eq("id", matchId)
    .maybeSingle<{
      id: string;
      status: "scheduled" | "live" | "ended";
      started_at: string | null;
    }>();

  if (!match) return;

  const now = new Date();
  const minute = match.started_at
    ? Math.max(
        0,
        Math.floor(
          (now.getTime() - new Date(match.started_at).getTime()) / 60000,
        ),
      )
    : 0;

  const { data: insertedGoal, error: insertError } = await supabase
    .from("goal_events")
    .insert({
      match_id: matchId,
      team_side: teamSide,
      minute,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (insertError || !insertedGoal?.id) {
    console.error("[addGoal] goal_events insert failed", {
      matchId,
      teamSide,
      error: insertError?.message,
    });
    redirect(`/m/${matchId}?mode=edit&err=goal_insert_failed`);
  }

  const { data: countedGoals, error: countError } = await supabase
    .from("goal_events")
    .select("team_side")
    .eq("match_id", matchId)
    .is("deleted_at", null);

  if (countError) {
    console.error("[addGoal] recount failed", {
      matchId,
      error: countError.message,
    });
    redirect(`/m/${matchId}?mode=edit&err=goal_recount_failed`);
  }

  let scoreA = 0;
  let scoreB = 0;
  for (const g of countedGoals ?? []) {
    if (g.team_side === "A") scoreA += 1;
    else if (g.team_side === "B") scoreB += 1;
  }

  const { error: updateError } = await supabase
    .from("matches")
    .update({
      score_a: scoreA,
      score_b: scoreB,
      status: match.status === "scheduled" ? "live" : match.status,
      started_at: match.status === "scheduled" ? now.toISOString() : undefined,
    })
    .eq("id", matchId);

  if (updateError) {
    await supabase
      .from("goal_events")
      .update({ deleted_at: now.toISOString() })
      .eq("id", insertedGoal.id)
      .eq("match_id", matchId);
    console.error("[addGoal] matches update failed", {
      matchId,
      error: updateError.message,
    });
    redirect(`/m/${matchId}?mode=edit&err=score_update_failed`);
  }

  revalidatePath(`/m/${matchId}`);
  redirect(`/m/${matchId}?mode=edit`);
}

async function startMatch(
  matchId: string,
  channelSlug: string,
  channelVersion: number,
) {
  "use server";

  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  const permission = await getChannelPermission(channelSlug, channelVersion);
  if (!permission.canManageMatch) return;

  await supabase
    .from("matches")
    .update({
      status: "live",
      started_at: new Date().toISOString(),
      scheduled_start_at: null,
    })
    .eq("id", matchId);

  revalidatePath(`/m/${matchId}`);
  redirect(`/m/${matchId}?mode=edit`);
}

async function endMatch(
  matchId: string,
  channelSlug: string,
  channelVersion: number,
) {
  "use server";

  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  const permission = await getChannelPermission(channelSlug, channelVersion);
  if (!permission.canManageMatch) return;

  await supabase
    .from("matches")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", matchId);

  revalidatePath(`/m/${matchId}`);
  redirect(`/m/${matchId}?mode=edit`);
}

async function changeStartTime(
  matchId: string,
  channelSlug: string,
  channelVersion: number,
  formData: FormData,
) {
  "use server";

  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  const permission = await getChannelPermission(channelSlug, channelVersion);
  if (!permission.canManageMatch) return;

  const minutesAgo = Math.max(0, Number(formData.get("minutes_ago")) || 0);
  const startedAt = new Date(Date.now() - minutesAgo * 60000).toISOString();

  await supabase
    .from("matches")
    .update({ started_at: startedAt })
    .eq("id", matchId);

  revalidatePath(`/m/${matchId}`);
  redirect(`/m/${matchId}?mode=edit`);
}

async function updateGoalEvent(
  matchId: string,
  goalId: string,
  channelSlug: string,
  channelVersion: number,
  formData: FormData,
) {
  "use server";

  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  const permission = await getChannelPermission(channelSlug, channelVersion);
  if (!permission.canGoalEdit) return;

  const scorerRaw = String(formData.get("scorer") || "").trim();
  const assistRaw = String(formData.get("assist") || "").trim();
  const minuteRaw = String(formData.get("minute") || "").trim();
  const minute = minuteRaw === "" ? null : Math.max(0, Number(minuteRaw) || 0);

  const parsePlayerValue = (raw: string) => {
    const idx = raw.indexOf("|");
    if (idx >= 0) {
      return {
        playerId: raw.slice(0, idx) || null,
        name: raw.slice(idx + 1) || null,
      };
    }
    return { playerId: null, name: raw || null };
  };

  const scorer = parsePlayerValue(scorerRaw);
  const assist = parsePlayerValue(assistRaw);

  await supabase
    .from("goal_events")
    .update({
      minute,
      scorer_player_id: scorer.playerId,
      scorer_name: scorer.name,
      assist_player_id: assist.playerId,
      assist_name: assist.name,
    })
    .eq("id", goalId)
    .eq("match_id", matchId);

  const aliasPairs = [
    { jersey_no: null, player_name: scorer.name },
    { jersey_no: null, player_name: assist.name },
  ].filter((x) => x.player_name);

  for (const a of aliasPairs) {
    await supabase.from("match_player_aliases").upsert(
      {
        match_id: matchId,
        jersey_no: a.jersey_no,
        player_name: a.player_name,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: "match_id,jersey_no,player_name" },
    );
  }

  revalidatePath(`/m/${matchId}`);
  redirect(`/m/${matchId}?mode=edit`);
}

async function deleteGoalEvent(
  matchId: string,
  goalId: string,
  teamSide: "A" | "B",
  channelSlug: string,
  channelVersion: number,
) {
  "use server";

  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  const permission = await getChannelPermission(channelSlug, channelVersion);
  if (!permission.canGoalEdit) return;

  await supabase
    .from("goal_events")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", goalId)
    .eq("match_id", matchId);

  const { data: match } = await supabase
    .from("matches")
    .select("score_a,score_b")
    .eq("id", matchId)
    .maybeSingle<{ score_a: number; score_b: number }>();

  if (match) {
    const nextA =
      teamSide === "A" ? Math.max(0, (match.score_a ?? 0) - 1) : match.score_a;
    const nextB =
      teamSide === "B" ? Math.max(0, (match.score_b ?? 0) - 1) : match.score_b;
    await supabase
      .from("matches")
      .update({ score_a: nextA, score_b: nextB })
      .eq("id", matchId);
  }

  revalidatePath(`/m/${matchId}`);
  redirect(`/m/${matchId}?mode=edit`);
}

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ matchId: string }>;
}): Promise<Metadata> {
  const { matchId } = await params;
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return { title: `경기 ${matchId}` };
  }

  const { data: match } = await supabase
    .from("matches")
    .select("seq,team_a_name,team_b_name")
    .eq("id", matchId)
    .maybeSingle<{ seq: number; team_a_name: string; team_b_name: string }>();

  if (!match) {
    return { title: `경기 ${matchId}` };
  }

  return {
    title: `${match.seq}경기 ${match.team_a_name} vs ${match.team_b_name}`,
    description: `${match.team_a_name} vs ${match.team_b_name} 경기 상세`,
  };
}

export default async function MatchDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ matchId: string }>;
  searchParams: Promise<{
    goal?: string;
    err?: string;
    mode?: string;
  }>;
}) {
  const { matchId } = await params;
  const { goal: goalParam, err, mode } = await searchParams;
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return (
      <main className="min-h-screen p-4 md:p-6 bg-white page-enter">
        <section className="max-w-3xl mx-auto space-y-3">
          <h1 className="text-2xl font-semibold">경기 상세</h1>
          <p className="text-sm text-amber-700">
            Supabase 환경변수가 없어서 데이터 연결을 건너뛰었습니다.
          </p>
        </section>
      </main>
    );
  }

  await autoStartDueMatches(supabase, matchId);

  const { data: match } = await supabase
    .from("matches")
    .select(
      "id,seq,team_a_name,team_b_name,score_a,score_b,status,scheduled_start_at,started_at,channel_id,match_group_id",
    )
    .eq("id", matchId)
    .maybeSingle<Match>();

  if (!match) {
    return (
      <main className="min-h-screen p-4 md:p-6 bg-white page-enter">
        <section className="max-w-3xl mx-auto space-y-3">
          <h1 className="text-2xl font-semibold">경기를 찾을 수 없음</h1>
          <p className="text-sm text-gray-600">
            유효한 경기 링크인지 확인해 주세요.
          </p>
        </section>
      </main>
    );
  }

  const { data: channel } = await supabase
    .from("channels")
    .select("id,slug,edit_session_version")
    .eq("id", match.channel_id)
    .maybeSingle<Channel>();

  const { data: group } = match.match_group_id
    ? await supabase
        .from("match_groups")
        .select("id,play_date,venue,title,seq")
        .eq("id", match.match_group_id)
        .maybeSingle<MatchGroup>()
    : { data: null as MatchGroup | null };

  // 엔트리/게스트 기반 roster 구성
  let rosterA: RosterPlayer[] = [];
  let rosterB: RosterPlayer[] = [];

  if (match.match_group_id) {
    const [
      { data: teamARow },
      { data: teamBRow },
      { data: entries },
      { data: guests },
    ] = await Promise.all([
      supabase
        .from("channel_teams_view")
        .select("id")
        .eq("channel_id", match.channel_id)
        .eq("name", match.team_a_name)
        .maybeSingle<{ id: string }>(),
      supabase
        .from("channel_teams_view")
        .select("id")
        .eq("channel_id", match.channel_id)
        .eq("name", match.team_b_name)
        .maybeSingle<{ id: string }>(),
      supabase
        .from("match_group_entries")
        .select("team_id, player_id, team_players(jersey_no, player_name)")
        .eq("match_group_id", match.match_group_id)
        .returns<
          {
            team_id: string;
            player_id: string;
            team_players: { jersey_no: string; player_name: string };
          }[]
        >(),
      supabase
        .from("match_group_guests")
        .select(
          "team_id, guest_name, source_player_id, team_players!match_group_guests_source_player_id_fkey(jersey_no)",
        )
        .eq("match_group_id", match.match_group_id)
        .returns<
          {
            team_id: string;
            guest_name: string;
            source_player_id: string | null;
            team_players: { jersey_no: string } | null;
          }[]
        >(),
    ]);

    const teamAId = teamARow?.id;
    const teamBId = teamBRow?.id;

    const buildRoster = (teamId: string | undefined): RosterPlayer[] => {
      if (!teamId) return [];
      const players: RosterPlayer[] = [];
      for (const e of entries ?? []) {
        if (e.team_id === teamId && e.team_players) {
          const { jersey_no, player_name } = e.team_players;
          players.push({
            playerId: e.player_id,
            jerseyNo: jersey_no,
            playerName: player_name,
            value: `${e.player_id}|#${jersey_no} ${player_name}`,
          });
        }
      }
      for (const g of guests ?? []) {
        if (g.team_id === teamId) {
          const jerseyNo = g.team_players?.jersey_no ?? "";
          const pid = g.source_player_id ?? "";
          const displayName = jerseyNo
            ? `#${jerseyNo} ${g.guest_name}`
            : g.guest_name;
          players.push({
            playerId: pid,
            jerseyNo,
            playerName: g.guest_name,
            value: `${pid}|${displayName}`,
          });
        }
      }
      players.sort((a, b) => {
        const na = parseInt(a.jerseyNo, 10);
        const nb = parseInt(b.jerseyNo, 10);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.jerseyNo.localeCompare(b.jerseyNo);
      });
      return players;
    };

    rosterA = buildRoster(teamAId);
    rosterB = buildRoster(teamBId);
  }

  const { data: goals } = await supabase
    .from("goal_events")
    .select(
      "id,team_side,minute,scorer_name,scorer_player_id,assist_name,assist_player_id,created_at",
    )
    .eq("match_id", matchId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .returns<GoalEvent[]>();

  const { data: aliases } = await supabase
    .from("match_player_aliases")
    .select("jersey_no,player_name")
    .eq("match_id", matchId)
    .order("last_used_at", { ascending: false })
    .limit(50)
    .returns<Alias[]>();

  const permission = channel
    ? await getChannelPermission(channel.slug, channel.edit_session_version)
    : { canGoalEdit: false, canManageMatch: false };
  const canGoalEdit = permission.canGoalEdit;
  const canManageMatch = permission.canManageMatch;
  const accountSession = channel ? await getAccountInfo(channel.slug) : null;
  const isEditMode = canGoalEdit && mode === "edit";
  const matchUrl = `https://quick-scoreboard.vercel.app/m/${matchId}`;
  const currentPath = `/m/${matchId}`;

  const activeGoalId = goalParam || (goals?.[0]?.id ?? "");
  const activeGoal =
    (goals ?? []).find((g) => g.id === activeGoalId) ?? goals?.[0] ?? null;

  const suggestedNames = Array.from(
    new Set([
      ...(aliases ?? []).map((a) => a.player_name).filter(Boolean),
      ...(goals ?? [])
        .flatMap((g) => [g.scorer_name, g.assist_name])
        .filter(Boolean),
    ] as string[]),
  ).slice(0, 20);

  const addGoalA = channel
    ? addGoal.bind(
        null,
        matchId,
        "A",
        channel.slug,
        channel.edit_session_version,
      )
    : async () => {};
  const addGoalB = channel
    ? addGoal.bind(
        null,
        matchId,
        "B",
        channel.slug,
        channel.edit_session_version,
      )
    : async () => {};
  const startMatchAction = channel
    ? startMatch.bind(null, matchId, channel.slug, channel.edit_session_version)
    : async () => {};
  const endMatchAction = channel
    ? endMatch.bind(null, matchId, channel.slug, channel.edit_session_version)
    : async () => {};
  const changeStartTimeAction = channel
    ? changeStartTime.bind(
        null,
        matchId,
        channel.slug,
        channel.edit_session_version,
      )
    : async () => {};

  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const elapsedMinutes = match.started_at
    ? Math.max(
        0,
        Math.floor((now - new Date(match.started_at).getTime()) / 60000),
      )
    : null;

  return (
    <main className="min-h-screen p-4 md:p-6 bg-white page-enter">
      <section className="max-w-3xl mx-auto space-y-4">
        <header className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-gray-500 flex flex-wrap items-center gap-1">
              <Link href={channel ? `/c/${channel.slug}` : "/"} className="underline">경기목록</Link>
              {group ? (<><span>›</span><span>{group.title ?? `${group.play_date} 그룹 ${group.seq}`}</span></>) : null}
              <span>›</span>
              <span className="font-semibold text-gray-900 text-base">{match.seq}경기</span>
              <span className="text-gray-400">({match.status})</span>
            </div>
            <ShareButton url={matchUrl} title={`${match.seq}경기 ${match.team_a_name} vs ${match.team_b_name}`} className="rounded border px-2 py-1 text-xs" />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {accountSession ? (
              <>
                <span className="rounded px-2 py-0.5 border bg-green-50 border-green-200 text-green-700">
                  {accountSession.loginId} ({accountSession.role})
                </span>
                <form action={`/c/${encodeURIComponent(channel!.slug)}/login`} method="post">
                  <input type="hidden" name="action" value="logout" />
                  <input type="hidden" name="redirect_to" value={currentPath} />
                  <button className="underline" type="submit">로그아웃</button>
                </form>
              </>
            ) : null}
            {canGoalEdit && !isEditMode ? (
              <Link href={`/m/${matchId}?mode=edit`} className="rounded border border-blue-300 bg-blue-50 px-2 py-0.5 text-blue-700">편집모드로 전환</Link>
            ) : null}
            {isEditMode ? (
              <Link href={`/m/${matchId}`} className="rounded border border-gray-300 bg-gray-50 px-2 py-0.5 text-gray-700">보기모드로 돌아가기</Link>
            ) : null}
          </div>
          {err ? <p className="text-xs text-red-600">저장 중 오류가 발생했습니다: {err}</p> : null}
        </header>

        <LiveScoreboard
          matchId={matchId}
          readonly={!isEditMode}
          matchStatus={match.status}
          initialMatch={{
            id: match.id,
            team_a_name: match.team_a_name,
            team_b_name: match.team_b_name,
            score_a: match.score_a,
            score_b: match.score_b,
          }}
          initialGoals={(goals ?? []).map((g) => ({
            id: g.id,
            team_side: g.team_side,
            minute: g.minute,
            scorer_name: g.scorer_name,
            assist_name: g.assist_name,
            created_at: g.created_at,
          }))}
        />

        {isEditMode && canManageMatch ? (
          <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-2 shadow-sm">
            <div className="flex flex-wrap gap-2">
              {match.status === "scheduled" ? (
                <form action={startMatchAction}>
                  <PendingSubmitButton
                    className="rounded border px-3 py-2 text-sm"
                    pendingText="시작중..."
                  >
                    경기 시작
                  </PendingSubmitButton>
                </form>
              ) : null}
              {match.status !== "ended" ? (
                <form action={endMatchAction}>
                  <PendingSubmitButton
                    className="rounded border px-3 py-2 text-sm"
                    pendingText="종료중..."
                  >
                    경기 종료
                  </PendingSubmitButton>
                </form>
              ) : (
                <p className="text-xs text-gray-500">종료된 경기입니다.</p>
              )}
            </div>
            {match.status !== "ended" ? (
              <form
                action={changeStartTimeAction}
                className="flex items-center gap-2"
              >
                <input
                  className="rounded border px-2 py-1.5 text-sm w-20"
                  name="minutes_ago"
                  type="number"
                  min={0}
                  placeholder="0"
                  defaultValue={elapsedMinutes ?? ""}
                />
                <span className="text-xs text-gray-500">
                  분 전에 시작한 것으로
                </span>
                <PendingSubmitButton
                  className="rounded border px-3 py-2 text-sm"
                  pendingText="변경중..."
                >
                  시작시간 변경
                </PendingSubmitButton>
              </form>
            ) : null}
          </section>
        ) : null}

        {isEditMode ? (
          <ScoreActions
            addGoalA={addGoalA}
            addGoalB={addGoalB}
            teamAName={match.team_a_name}
            teamBName={match.team_b_name}
          />
        ) : null}

        {isEditMode ? (
          <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700">
              현재 편집 이벤트
            </h2>
            {!activeGoal || !channel ? (
              <p className="text-sm text-gray-500">편집할 이벤트가 없습니다.</p>
            ) : (
              (() => {
                const roster = activeGoal.team_side === "A" ? rosterA : rosterB;
                const hasRoster = roster.length > 0;
                const scorerDefault = activeGoal.scorer_player_id
                  ? `${activeGoal.scorer_player_id}|${activeGoal.scorer_name ?? ""}`
                  : (activeGoal.scorer_name ?? "");
                const assistDefault = activeGoal.assist_player_id
                  ? `${activeGoal.assist_player_id}|${activeGoal.assist_name ?? ""}`
                  : (activeGoal.assist_name ?? "");
                return (
                  <>
                    <div className="text-sm text-gray-700">
                      {activeGoal.team_side}팀 ·{" "}
                      {activeGoal.minute !== null
                        ? `${activeGoal.minute}분`
                        : "시간 미설정"}
                    </div>
                    <form
                      key={activeGoal.id}
                      action={updateGoalEvent.bind(
                        null,
                        matchId,
                        activeGoal.id,
                        channel.slug,
                        channel.edit_session_version,
                      )}
                      className="grid grid-cols-2 md:grid-cols-3 gap-2"
                    >
                      <input
                        className="rounded-lg border border-gray-200 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
                        name="minute"
                        type="number"
                        min={0}
                        placeholder="분"
                        defaultValue={activeGoal.minute ?? ""}
                      />
                      {hasRoster ? (
                        <select
                          className="rounded-lg border border-gray-200 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
                          name="scorer"
                          defaultValue={scorerDefault}
                        >
                          <option value="">득점자 선택</option>
                          {roster.map((p) => (
                            <option key={p.value} value={p.value}>
                              #{p.jerseyNo} {p.playerName}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="rounded-lg border border-gray-200 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
                          list="name-suggestions"
                          name="scorer"
                          placeholder="득점자"
                          defaultValue={activeGoal.scorer_name ?? ""}
                        />
                      )}
                      {hasRoster ? (
                        <select
                          className="rounded-lg border border-gray-200 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
                          name="assist"
                          defaultValue={assistDefault}
                        >
                          <option value="">어시스트 선택</option>
                          {roster.map((p) => (
                            <option key={p.value} value={p.value}>
                              #{p.jerseyNo} {p.playerName}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="rounded-lg border border-gray-200 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
                          list="name-suggestions"
                          name="assist"
                          placeholder="어시"
                          defaultValue={activeGoal.assist_name ?? ""}
                        />
                      )}
                      <div className="md:col-span-3 flex flex-wrap gap-2 justify-end">
                        <button
                          className="rounded-lg border border-gray-200 px-2 py-1 text-xs"
                          type="reset"
                        >
                          편집 취소
                        </button>
                        <PendingSubmitButton
                          className="rounded-lg border border-gray-200 px-2 py-1 text-xs"
                          pendingText="저장중..."
                        >
                          이벤트 저장
                        </PendingSubmitButton>
                      </div>
                    </form>
                    <form
                      action={deleteGoalEvent.bind(
                        null,
                        matchId,
                        activeGoal.id,
                        activeGoal.team_side,
                        channel.slug,
                        channel.edit_session_version,
                      )}
                    >
                      <PendingSubmitButton
                        className="rounded-lg border border-red-200 text-red-700 px-2 py-1 text-xs"
                        pendingText="삭제중..."
                      >
                        이벤트 삭제
                      </PendingSubmitButton>
                    </form>
                  </>
                );
              })()
            )}

            {rosterA.length === 0 &&
            rosterB.length === 0 &&
            suggestedNames.length > 0 ? (
              <div className="space-y-1">
                <div className="text-xs text-gray-500">
                  이 경기에서 자주 쓴 값 추천
                </div>
                <div className="flex flex-wrap gap-1">
                  {suggestedNames.map((name) => (
                    <span
                      key={name}
                      className="text-[11px] rounded-lg border border-gray-200 px-1.5 py-0.5 text-gray-600"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {rosterA.length === 0 && rosterB.length === 0 ? (
              <datalist id="name-suggestions">
                {suggestedNames.map((name) => (
                  <option key={`name-${name}`} value={name} />
                ))}
              </datalist>
            ) : null}
          </section>
        ) : null}
      </section>
    </main>
  );
}
