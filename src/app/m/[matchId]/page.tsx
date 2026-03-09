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
  period_state: "pre" | "first_half" | "halftime" | "second_half" | "ended";
  first_half_started_at: string | null;
  first_half_ended_at: string | null;
  halftime_started_at: string | null;
  second_half_started_at: string | null;
  second_half_ended_at: string | null;
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
  period: "first_half" | "second_half";
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


type ChangeActor = { loginId: string | null; role: string | null };

async function getChangeActor(channelSlug: string): Promise<ChangeActor> {
  const isAdmin = await isAdminAuthorized();
  if (isAdmin) return { loginId: "admin", role: "admin" };
  const account = await getAccountInfo(channelSlug);
  if (!account) return { loginId: null, role: null };
  return { loginId: account.loginId, role: account.role };
}

async function logMatchChange(
  matchId: string,
  channelSlug: string,
  actionType: string,
  payload: Record<string, unknown>,
) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  const actor = await getChangeActor(channelSlug);
  const { data: matchRow } = await supabase
    .from("matches")
    .select("channel_id")
    .eq("id", matchId)
    .maybeSingle<{ channel_id: string | null }>();

  await supabase.from("match_change_logs").insert({
    match_id: matchId,
    channel_id: matchRow?.channel_id ?? null,
    action_type: actionType,
    actor_login_id: actor.loginId,
    actor_role: actor.role,
    payload,
  });
}

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

  const account = await getAccountInfo(channelSlug);
  if (account?.role === "player") {
    return { canGoalEdit: true, canManageMatch: true };
  }

  const isEditor = await isEditAuthorized(channelSlug, channelVersion);
  if (isEditor) return { canGoalEdit: true, canManageMatch: false };

  return { canGoalEdit: false, canManageMatch: false };
}


async function canAccountEditThisMatch(channelSlug: string, matchId: string): Promise<boolean> {
  const account = await getAccountInfo(channelSlug)
  if (!account) return true
  if (account.role !== 'player' && account.role !== 'manager') return true
  if (!account.teamId) return false

  const supabase = getSupabaseServerClient()
  if (!supabase) return false

  const { data: match } = await supabase
    .from('matches')
    .select('team_a_name,team_b_name')
    .eq('id', matchId)
    .maybeSingle<{ team_a_name: string; team_b_name: string }>()

  if (!match) return false

  const { data: ownTeam } = await supabase
    .from('teams')
    .select('name')
    .eq('id', account.teamId)
    .maybeSingle<{ name: string }>()

  if (!ownTeam) return false

  if (match.team_a_name === ownTeam.name || match.team_b_name === ownTeam.name) {
    return false
  }

  return true
}


async function canMutateGoals(
  channelSlug: string,
  channelVersion: number,
  matchId: string,
  action: "add" | "edit",
): Promise<boolean> {
  const permission = await getChannelPermission(channelSlug, channelVersion);
  if (!permission.canGoalEdit) return false;

  const canEditThisMatch = await canAccountEditThisMatch(channelSlug, matchId);
  if (!canEditThisMatch) return false;

  const supabase = getSupabaseServerClient();
  if (!supabase) return false;

  const { data: match } = await supabase
    .from("matches")
    .select("period_state")
    .eq("id", matchId)
    .maybeSingle<{
      period_state: "pre" | "first_half" | "halftime" | "second_half" | "ended";
    }>();

  if (!match) return false;

  const isAdmin = await isAdminAuthorized();

  if (match.period_state === "pre") return false;
  if (match.period_state === "halftime") return action === "edit";
  if (match.period_state === "ended") return isAdmin;

  return true;
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

  const canMutate = await canMutateGoals(channelSlug, channelVersion, matchId, "add");
  if (!canMutate) return;

  const { data: match } = await supabase
    .from("matches")
    .select("id,status,started_at,period_state,first_half_started_at,second_half_started_at")
    .eq("id", matchId)
    .maybeSingle<{
      id: string;
      status: "scheduled" | "live" | "ended";
      started_at: string | null;
      period_state: "pre" | "first_half" | "halftime" | "second_half" | "ended";
      first_half_started_at: string | null;
      second_half_started_at: string | null;
    }>();

  if (!match) return;

  const now = new Date();
  const elapsedFrom = (iso: string | null) =>
    iso
      ? Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60000))
      : 0;

  const isSecondHalf = match.period_state === "second_half";
  const minute = isSecondHalf
    ? 15 + elapsedFrom(match.second_half_started_at)
    : elapsedFrom(match.first_half_started_at ?? match.started_at);

  const { data: insertedGoal, error: insertError } = await supabase
    .from("goal_events")
    .insert({
      match_id: matchId,
      team_side: teamSide,
      period: isSecondHalf ? "second_half" : "first_half",
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

  await logMatchChange(matchId, channelSlug, "goal_add", { teamSide, minute });


  revalidatePath(`/m/${matchId}`);
  redirect(`/m/${matchId}?mode=edit`);
}

async function applyPeriodAction(
  matchId: string,
  channelSlug: string,
  channelVersion: number,
  action: "start_first" | "end_first" | "start_second" | "end_match" | "resume_previous",
) {
  "use server";

  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  const permission = await getChannelPermission(channelSlug, channelVersion);
  if (!permission.canManageMatch) return;

  const { data: match } = await supabase
    .from("matches")
    .select(
      "id,period_state,status,started_at,first_half_started_at,first_half_ended_at,halftime_started_at,second_half_started_at,second_half_ended_at",
    )
    .eq("id", matchId)
    .maybeSingle<{
      id: string;
      period_state: "pre" | "first_half" | "halftime" | "second_half" | "ended";
      status: "scheduled" | "live" | "ended";
      started_at: string | null;
      first_half_started_at: string | null;
      first_half_ended_at: string | null;
      halftime_started_at: string | null;
      second_half_started_at: string | null;
      second_half_ended_at: string | null;
    }>();

  if (!match) return;

  const now = new Date().toISOString();
  const patch: Record<string, string | null> = {};

  if (action === "start_first" && match.period_state === "pre") {
    patch.period_state = "first_half";
    patch.status = "live";
    patch.started_at = match.started_at ?? now;
    patch.first_half_started_at = match.first_half_started_at ?? now;
    patch.scheduled_start_at = null;
  }

  if (action === "end_first" && match.period_state === "first_half") {
    patch.period_state = "halftime";
    patch.status = "live";
    patch.first_half_ended_at = now;
    patch.halftime_started_at = now;
  }

  if (action === "start_second" && match.period_state === "halftime") {
    patch.period_state = "second_half";
    patch.status = "live";
    patch.second_half_started_at = now;
  }

  if (action === "end_match" && (match.period_state === "second_half" || match.period_state === "first_half" || match.period_state === "halftime")) {
    patch.period_state = "ended";
    patch.status = "ended";
    patch.ended_at = now;
    patch.second_half_ended_at = now;
  }

  if (action === "resume_previous") {
    if (match.period_state === "halftime" && !match.second_half_started_at) {
      patch.period_state = "first_half";
      patch.first_half_ended_at = null;
      patch.halftime_started_at = null;
      patch.status = "live";
    } else if (match.period_state === "second_half") {
      patch.period_state = "halftime";
      patch.second_half_started_at = null;
      patch.status = "live";
    }
  }

  if (Object.keys(patch).length === 0) {
    redirect(`/m/${matchId}?mode=edit&err=invalid_period_action`);
  }

  await supabase.from("matches").update(patch).eq("id", matchId);
  await logMatchChange(matchId, channelSlug, "period_action", { action, patch });

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

  const canMutate = await canMutateGoals(channelSlug, channelVersion, matchId, "edit");
  if (!canMutate) return;

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

  await logMatchChange(matchId, channelSlug, "goal_update", { goalId, minute, scorer: scorer.name, assist: assist.name });

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

  const canMutate = await canMutateGoals(channelSlug, channelVersion, matchId, "edit");
  if (!canMutate) return;

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

  await logMatchChange(matchId, channelSlug, "goal_delete", { goalId, teamSide });

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
      "id,seq,team_a_name,team_b_name,score_a,score_b,status,scheduled_start_at,started_at,channel_id,match_group_id,period_state,first_half_started_at,first_half_ended_at,halftime_started_at,second_half_started_at,second_half_ended_at",
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
      "id,team_side,period,minute,scorer_name,scorer_player_id,assist_name,assist_player_id,created_at",
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
  const canEditThisMatch = channel ? await canAccountEditThisMatch(channel.slug, matchId) : false;
  const canGoalEdit = permission.canGoalEdit && canEditThisMatch;
  const canManageMatch = permission.canManageMatch;
  const accountSession = channel ? await getAccountInfo(channel.slug) : null;
  const isAdminSession = await isAdminAuthorized();
  const isEditMode = canGoalEdit && mode === "edit";
  const canAddGoalNow =
    isEditMode &&
    (match.period_state === "first_half" ||
      match.period_state === "second_half" ||
      (match.period_state === "ended" && isAdminSession));
  const canEditGoalNow =
    isEditMode &&
    (match.period_state === "first_half" ||
      match.period_state === "second_half" ||
      match.period_state === "halftime" ||
      (match.period_state === "ended" && isAdminSession));
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
  const startFirstAction = channel
    ? applyPeriodAction.bind(null, matchId, channel.slug, channel.edit_session_version, "start_first")
    : async () => {};
  const endFirstAction = channel
    ? applyPeriodAction.bind(null, matchId, channel.slug, channel.edit_session_version, "end_first")
    : async () => {};
  const startSecondAction = channel
    ? applyPeriodAction.bind(null, matchId, channel.slug, channel.edit_session_version, "start_second")
    : async () => {};
  const endMatchAction = channel
    ? applyPeriodAction.bind(null, matchId, channel.slug, channel.edit_session_version, "end_match")
    : async () => {};
  const resumePreviousAction = channel
    ? applyPeriodAction.bind(null, matchId, channel.slug, channel.edit_session_version, "resume_previous")
    : async () => {};

  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const activePeriodStart =
    match.period_state === "first_half"
      ? match.first_half_started_at
      : match.period_state === "second_half"
      ? match.second_half_started_at
      : null;
  const elapsedMinutes = activePeriodStart
    ? Math.max(0, Math.floor((now - new Date(activePeriodStart).getTime()) / 60000))
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
            {accountSession?.role === 'player' && !canEditThisMatch ? (
              <span className="text-xs text-amber-700">본인 팀 경기는 점수 입력이 제한됩니다. (팀장/팀원 공통)</span>
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

        {rosterA.length === 0 && rosterB.length === 0 ? (
          <p className="text-xs text-amber-600">엔트리가 확정되지 않았습니다.</p>
        ) : (
          <section className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <details>
              <summary className="text-xs font-semibold text-gray-700 cursor-pointer">엔트리 ({rosterA.length + rosterB.length}명)</summary>
              <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="font-semibold text-gray-600 mb-1">{match.team_a_name}</div>
                  {rosterA.map((p) => (
                    <div key={p.value} className="text-gray-700">#{p.jerseyNo} {p.playerName}</div>
                  ))}
                </div>
                <div>
                  <div className="font-semibold text-gray-600 mb-1">{match.team_b_name}</div>
                  {rosterB.map((p) => (
                    <div key={p.value} className="text-gray-700">#{p.jerseyNo} {p.playerName}</div>
                  ))}
                </div>
              </div>
            </details>
          </section>
        )}

        {isEditMode && canManageMatch ? (
          <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-2 shadow-sm">
            <div className="rounded border bg-gray-50 p-2 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-gray-700">구간 운영</h3>
                <span className="text-[11px] text-gray-500">기본 전/후반 각 15분</span>
              </div>
              <div className="rounded border bg-white p-2 space-y-2">
                <div className="text-[11px] text-gray-500">
                  현재 상태: {match.period_state === "pre" ? "대기" : match.period_state === "first_half" ? "전반 진행" : match.period_state === "halftime" ? "휴식" : match.period_state === "second_half" ? "후반 진행" : "종료"}
                  {elapsedMinutes !== null ? ` · 경과 ${elapsedMinutes}분` : ""}
                </div>
                <div className="flex flex-wrap gap-2">
                  {match.period_state === "pre" ? (
                    <form action={startFirstAction}><PendingSubmitButton className="rounded border px-3 py-2 text-sm" pendingText="처리중...">전반전 시작</PendingSubmitButton></form>
                  ) : null}
                  {match.period_state === "first_half" ? (
                    <form action={endFirstAction}><PendingSubmitButton className="rounded border px-3 py-2 text-sm" pendingText="처리중...">전반전 종료(휴식)</PendingSubmitButton></form>
                  ) : null}
                  {match.period_state === "halftime" ? (
                    <form action={startSecondAction}><PendingSubmitButton className="rounded border px-3 py-2 text-sm" pendingText="처리중...">후반전 시작</PendingSubmitButton></form>
                  ) : null}
                  {match.period_state === "second_half" ? (
                    <form action={endMatchAction}><PendingSubmitButton className="rounded border px-3 py-2 text-sm" pendingText="처리중...">경기 종료</PendingSubmitButton></form>
                  ) : null}
                  {(match.period_state === "halftime" || match.period_state === "second_half") ? (
                    <form action={resumePreviousAction}><PendingSubmitButton className="rounded border px-3 py-2 text-sm" pendingText="처리중...">이전 구간 재개</PendingSubmitButton></form>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        ) : null}

                {isEditMode ? (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            {match.period_state === "pre"
              ? "경기 시작 전에는 스코어 입력/수정이 불가합니다."
              : match.period_state === "halftime"
              ? "휴식 시간에는 기존 기록 수정/삭제만 가능합니다."
              : match.period_state === "ended" && !isAdminSession
              ? "경기 종료 후 기록 수정은 어드민만 가능합니다."
              : ""}
          </section>
        ) : null}

{canAddGoalNow ? (
          <ScoreActions
            addGoalA={addGoalA}
            addGoalB={addGoalB}
            teamAName={match.team_a_name}
            teamBName={match.team_b_name}
          />
        ) : null}

        {canEditGoalNow ? (
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
