import type { Metadata } from "next";
import { createHash } from "crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase";
import { validateManagerAgainstDb, getAccountInfo } from "@/lib/channelSession";
import { isAdminAuthorized } from "@/lib/adminAuth";
import { autoStartDueMatches } from "@/lib/matchSchedule";
import GoalAddActions from "./GoalAddActions";
import GoalEditModal from "./GoalEditModal";
import LiveScoreboard from "./LiveScoreboard";
import MatchEditHelp from "./MatchEditHelp";
import ShareButton from "@/components/ShareButton";
import AccountBadge from "@/components/AccountBadge";
import StarRatingInput from "@/components/StarRatingInput";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import TransientToast from "@/components/TransientToast";
import LiveMinuteBadge from "./LiveMinuteBadge";
import UserGNB from "@/components/UserGNB";
import LoginModal from "@/app/c/[slug]/LoginModal";
import {
  getPeriodDisplayLabel,
  summarizeLegacyPeriodControl,
  type MatchPeriodRow,
} from "@/lib/matchPeriods";

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
  period_count: number;
};

type Channel = { id: string; slug: string; name: string; edit_session_version: number };
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
  period_sequence: number | null;
  match_period_id: string | null;
  minute: number | null;
  scorer_name: string | null;
  scorer_player_id: string | null;
  assist_name: string | null;
  assist_player_id: string | null;
  created_at: string;
};

type MatchPeriodLineup = {
  match_period_id: string;
  team_side: "A" | "B";
  player_id: string | null;
  player_name: string | null;
};

type MatchSubstitution = {
  id: string;
  period_sequence: number;
  match_period_id: string | null;
  minute: number;
  team_side: "A" | "B";
  player_out_id: string | null;
  player_out_name: string | null;
  player_in_id: string | null;
  player_in_name: string | null;
  created_at: string;
};

type Alias = { jersey_no: string | null; player_name: string | null };

type PlayerRatingAgg = {
  target_player_id: string;
  avg_rating: number;
  rating_count: number;
};

type RosterPlayer = {
  playerId: string;
  jerseyNo: string;
  playerName: string;
  value: string;
};

type GoalPermission = { canGoalEdit: boolean; canManageMatch: boolean };

type ChangeActor = { loginId: string | null; role: string | null };

type MatchFeedbackRow = {
  id: string;
  author_login_id: string | null;
  author_role: string | null;
  content: string;
  created_at: string;
};

const MATCH_FEEDBACK_COOKIE = "qsb_match_feedback";
const URL_REGEX = /(https?:\/\/[^\s]+)/g;

async function setMatchFeedback(code: string) {
  const store = await cookies();
  store.set(MATCH_FEEDBACK_COOKIE, code, {
    path: "/",
    maxAge: 10,
    sameSite: "lax",
  });
}

async function getChangeActor(channelSlug: string): Promise<ChangeActor> {
  const isAdmin = await isAdminAuthorized();
  if (isAdmin) return { loginId: "admin", role: "admin" };
  const account = await getAccountInfo(channelSlug);
  if (!account) return { loginId: null, role: null };
  return { loginId: account.loginId, role: account.role };
}

async function submitMatchFeedback(
  matchId: string,
  channelSlug: string,
  formData: FormData,
) {
  "use server";
  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  const actor = await getChangeActor(channelSlug);
  if (!actor.loginId) {
    await setMatchFeedback("goal_forbidden");
    return;
  }

  const content = String(formData.get("content") ?? "").trim();

  if (!content || content.length > 300) {
    await setMatchFeedback("goal_invalid");
    return;
  }

  const { data: match } = await supabase
    .from("matches")
    .select("channel_id")
    .eq("id", matchId)
    .maybeSingle<{ channel_id: string }>();

  if (!match?.channel_id) return;

  await supabase.from("match_feedbacks").insert({
    match_id: matchId,
    channel_id: match.channel_id,
    author_login_id: actor.loginId,
    author_role: actor.role,
    content,
  });

  revalidatePath(`/m/${matchId}`);
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

  return { canGoalEdit: false, canManageMatch: false };
}

async function canAccountEditThisMatch(
  channelSlug: string,
  matchId: string,
): Promise<boolean> {
  void channelSlug;
  void matchId;
  return true;
}

async function canMutateGoals(
  channelSlug: string,
  channelVersion: number,
  matchId: string,
  action: "add" | "edit",
): Promise<boolean> {
  const permission = await getChannelPermission(channelSlug);
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

async function canMutateParticipation(
  channelSlug: string,
  matchId: string,
): Promise<boolean> {
  const permission = await getChannelPermission(channelSlug);
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

  if (match.period_state === "ended") return isAdmin;
  return true;
}

async function addGoalDetailed(
  matchId: string,
  teamSide: "A" | "B",
  channelSlug: string,
  channelVersion: number,
  formData: FormData,
) {
  "use server";

  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  const canMutate = await canMutateGoals(
    channelSlug,
    channelVersion,
    matchId,
    "add",
  );
  if (!canMutate) return;

  const { data: match } = await supabase
    .from("matches")
    .select(
      "id,status,started_at,period_state,first_half_started_at,second_half_started_at,score_a,score_b",
    )
    .eq("id", matchId)
    .maybeSingle<{
      id: string;
      status: "scheduled" | "live" | "ended";
      started_at: string | null;
      period_state: "pre" | "first_half" | "halftime" | "second_half" | "ended";
      first_half_started_at: string | null;
      second_half_started_at: string | null;
      score_a: number;
      score_b: number;
    }>();

  if (!match) return;

  const { data: livePeriod } = await supabase
    .from("match_periods")
    .select("id,sequence")
    .eq("match_id", matchId)
    .eq("status", "live")
    .is("deleted_at", null)
    .maybeSingle<{ id: string; sequence: number }>();

  const now = new Date();
  const elapsedFrom = (iso: string | null) =>
    iso
      ? Math.max(
          0,
          Math.floor((now.getTime() - new Date(iso).getTime()) / 60000),
        )
      : 0;

  const isSecondHalf = match.period_state === "second_half";
  const defaultMinute = isSecondHalf
    ? 15 + elapsedFrom(match.second_half_started_at)
    : elapsedFrom(match.first_half_started_at ?? match.started_at);
  const minuteInput = Number(formData.get("minute") || defaultMinute);
  const minute = Number.isFinite(minuteInput)
    ? Math.max(0, Math.min(200, minuteInput))
    : defaultMinute;

  const scorerRaw = String(formData.get("scorer") || "").trim();
  const assistRaw = String(formData.get("assist") || "").trim();
  const [scorerIdRaw, scorerNameRaw] = scorerRaw.split("|");
  const [assistIdRaw, assistNameRaw] = assistRaw.split("|");
  const scorer_player_id = scorerIdRaw?.trim() || null;
  const assist_player_id = assistIdRaw?.trim() || null;
  const scorer_name =
    (scorerNameRaw?.trim() || scorerRaw || "").replace(/^#\d+\s*/, "") || null;
  const assist_name =
    (assistNameRaw?.trim() || assistRaw || "").replace(/^#\d+\s*/, "") || null;

  const { data: insertedGoal, error: insertError } = await supabase
    .from("goal_events")
    .insert({
      match_id: matchId,
      team_side: teamSide,
      period: isSecondHalf ? "second_half" : "first_half",
      period_sequence: livePeriod?.sequence ?? (isSecondHalf ? 2 : 1),
      match_period_id: livePeriod?.id ?? null,
      minute,
      scorer_player_id,
      scorer_name,
      assist_player_id,
      assist_name,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (insertError || !insertedGoal?.id) {
    console.error("[addGoal] goal_events insert failed", {
      matchId,
      teamSide,
      error: insertError?.message,
    });
    await setMatchFeedback("goal_insert_failed");
    return;
  }

  const nextScoreA = match.score_a + (teamSide === "A" ? 1 : 0);
  const nextScoreB = match.score_b + (teamSide === "B" ? 1 : 0);

  const { error: updateError } = await supabase
    .from("matches")
    .update({
      score_a: nextScoreA,
      score_b: nextScoreB,
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
    await setMatchFeedback("score_update_failed");
    return;
  }

  await logMatchChange(matchId, channelSlug, "goal_add", { teamSide, minute });

  revalidatePath(`/m/${matchId}`);
}

async function applyPeriodAction(
  matchId: string,
  channelSlug: string,
  channelVersion: number,
  action: "start_period" | "end_period" | "resume_previous",
) {
  "use server";

  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  const permission = await getChannelPermission(channelSlug);
  if (!permission.canManageMatch) return;

  const { data: match } = await supabase
    .from("matches")
    .select(
      "id,period_state,status,started_at,first_half_started_at,first_half_ended_at,halftime_started_at,second_half_started_at,second_half_ended_at,period_count",
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
      period_count: number;
    }>();

  if (!match) return;

  const { data: periodsRaw } = await supabase
    .from("match_periods")
    .select("id,sequence,status")
    .eq("match_id", matchId)
    .is("deleted_at", null)
    .order("sequence", { ascending: true })
    .returns<
      { id: string; sequence: number; status: "pending" | "live" | "ended" | null }[]
    >();

  if (!periodsRaw || periodsRaw.length === 0) {
    await setMatchFeedback("periods_not_ready");
    return;
  }

  const nullStatusIds = periodsRaw.filter((p) => !p.status).map((p) => p.id);
  if (nullStatusIds.length > 0) {
    await supabase
      .from("match_periods")
      .update({ status: "pending" })
      .in("id", nullStatusIds);
  }

  const periods = periodsRaw.map((p) => ({
    ...p,
    status: (p.status ?? "pending") as "pending" | "live" | "ended",
  }));

  const livePeriod = periods.find((p) => p.status === "live") ?? null;
  const nextPending = periods.find((p) => p.status === "pending") ?? null;
  const endedPeriods = periods.filter((p) => p.status === "ended");
  const lastEndedPeriod = endedPeriods[endedPeriods.length - 1] ?? null;

  const now = new Date().toISOString();
  const patch: Record<string, string | null> = {};

  if (action === "start_period") {
    if (livePeriod || !nextPending) {
      await setMatchFeedback("invalid_period_action");
    return;
    }

    await supabase
      .from("match_periods")
      .update({ status: "live", started_at: now })
      .eq("id", nextPending.id);

    const { data: reservedSubs } = await supabase
      .from("match_period_substitution_plans")
      .select(
        "id,team_side,player_out_id,player_out_name,player_in_id,player_in_name,planned_minute",
      )
      .eq("match_id", matchId)
       .eq("match_period_id", nextPending.id)
      .is("deleted_at", null)
      .is("applied_at", null)
      .returns<
        {
          id: string;
          team_side: "A" | "B";
          player_out_id: string | null;
          player_out_name: string | null;
          player_in_id: string | null;
          player_in_name: string | null;
          planned_minute: number;
        }[]
      >();

    if ((reservedSubs ?? []).length > 0) {
      await supabase.from("match_substitutions").insert(
        (reservedSubs ?? []).map((sub) => ({
          match_id: matchId,
          period_sequence: nextPending.sequence,
          match_period_id: nextPending.id,
          minute: Number.isFinite(sub.planned_minute)
            ? Math.max(0, Math.min(200, sub.planned_minute))
            : 0,
          team_side: sub.team_side,
          player_out_id: sub.player_out_id,
          player_out_name: sub.player_out_name,
          player_in_id: sub.player_in_id,
          player_in_name: sub.player_in_name,
        })),
      );
      await supabase
        .from("match_period_substitution_plans")
        .update({ applied_at: now })
        .in(
          "id",
          (reservedSubs ?? []).map((s) => s.id),
        );
    }

    patch.status = "live";
    patch.started_at = match.started_at ?? now;
    patch.scheduled_start_at = null;

    if (nextPending.sequence <= 1) {
      patch.period_state = "first_half";
      patch.first_half_started_at = match.first_half_started_at ?? now;
    } else {
      patch.period_state = "second_half";
      patch.second_half_started_at = match.second_half_started_at ?? now;
    }
  }

  if (action === "end_period") {
    if (!livePeriod) {
      await setMatchFeedback("invalid_period_action");
    return;
    }

    await supabase
      .from("match_periods")
      .update({ status: "ended", ended_at: now })
      .eq("id", livePeriod.id);

    const hasMorePeriods = periods.some(
      (p) => p.sequence > livePeriod.sequence && p.status === "pending",
    );

    if (hasMorePeriods) {
      patch.status = "live";
      patch.period_state = "halftime";
      if (livePeriod.sequence <= 1) {
        patch.first_half_ended_at = now;
      }
      patch.halftime_started_at = now;
    } else {
      patch.period_state = "ended";
      patch.status = "ended";
      patch.ended_at = now;
      patch.second_half_ended_at = now;
    }
  }

  if (action === "resume_previous") {
    if (livePeriod || !lastEndedPeriod) {
      await setMatchFeedback("invalid_period_action");
    return;
    }

    await supabase
      .from("match_periods")
      .update({ status: "live", ended_at: null })
      .eq("id", lastEndedPeriod.id);

    patch.status = "live";
    if (lastEndedPeriod.sequence <= 1) {
      patch.period_state = "first_half";
      patch.first_half_ended_at = null;
      patch.halftime_started_at = null;
    } else {
      patch.period_state = "second_half";
      patch.ended_at = null;
      patch.second_half_ended_at = null;
    }
  }

  if (Object.keys(patch).length === 0) {
    await setMatchFeedback("invalid_period_action");
    return;
  }

  await supabase.from("matches").update(patch).eq("id", matchId);
  await logMatchChange(matchId, channelSlug, "period_action", {
    action,
    patch,
  });

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

  const canMutate = await canMutateGoals(
    channelSlug,
    channelVersion,
    matchId,
    "edit",
  );
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
  const normalizeStoredName = (name: string | null) =>
    name ? name.replace(/^#\S+\s+/, "").trim() || null : null;

  const scorerParsed = parsePlayerValue(scorerRaw);
  const assistParsed = parsePlayerValue(assistRaw);
  const scorer = { ...scorerParsed, name: normalizeStoredName(scorerParsed.name) };
  const assist = { ...assistParsed, name: normalizeStoredName(assistParsed.name) };

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

  await logMatchChange(matchId, channelSlug, "goal_update", {
    goalId,
    minute,
    scorer: scorer.name,
    assist: assist.name,
  });

  revalidatePath(`/m/${matchId}`);
  return;
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

  const canMutate = await canMutateGoals(
    channelSlug,
    channelVersion,
    matchId,
    "edit",
  );
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

  await logMatchChange(matchId, channelSlug, "goal_delete", {
    goalId,
    teamSide,
  });

  revalidatePath(`/m/${matchId}`);
  return;
}

async function updateGoalEventFromForm(
  matchId: string,
  channelSlug: string,
  channelVersion: number,
  formData: FormData,
) {
  "use server";
  const goalId = String(formData.get("goalId") || "").trim();
  if (!goalId) return;
  await updateGoalEvent(matchId, goalId, channelSlug, channelVersion, formData);
}

async function deleteGoalEventFromForm(
  matchId: string,
  channelSlug: string,
  channelVersion: number,
  formData: FormData,
) {
  "use server";
  const goalId = String(formData.get("goalId") || "").trim();
  const teamSide = String(formData.get("teamSide") || "") as "A" | "B";
  if (!goalId || (teamSide !== "A" && teamSide !== "B")) return;
  await deleteGoalEvent(matchId, goalId, teamSide, channelSlug, channelVersion);
}

async function submitAnonymousRating(
  matchId: string,
  channelSlug: string,
  formData: FormData,
) {
  "use server";

  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  const account = await getAccountInfo(channelSlug);
  if (
    !account ||
    (account.role !== "player" && account.role !== "manager") ||
    !account.teamId
  ) {
    await setMatchFeedback("rating_forbidden");
    return;
  }

  const targetPlayerId = String(formData.get("target_player_id") || "").trim();
  const ratingRaw = Number(formData.get("rating") || 0);
  const rating = Number(ratingRaw.toFixed(1));
  const isHalfStep = Number.isFinite(rating) && Number((rating * 10) % 5) === 0;
  if (
    !targetPlayerId ||
    !Number.isFinite(rating) ||
    rating < 1 ||
    rating > 5 ||
    !isHalfStep
  ) {
    await setMatchFeedback("rating_invalid");
    return;
  }

  const { data: match } = await supabase
    .from("matches")
    .select("id,channel_id,team_a_name,team_b_name,status")
    .eq("id", matchId)
    .maybeSingle<{
      id: string;
      channel_id: string;
      team_a_name: string;
      team_b_name: string;
      status: "scheduled" | "live" | "ended";
    }>();

  if (!match || match.status !== "ended") {
    await setMatchFeedback("rating_closed");
    return;
  }

  const [{ data: ownTeam }, { data: targetPlayer }] = await Promise.all([
    supabase
      .from("teams")
      .select("id,name")
      .eq("id", account.teamId)
      .maybeSingle<{ id: string; name: string }>(),
    supabase
      .from("team_players")
      .select("id,channel_id,team_id")
      .eq("id", targetPlayerId)
      .maybeSingle<{ id: string; channel_id: string; team_id: string }>(),
  ]);

  if (
    !ownTeam ||
    !targetPlayer ||
    targetPlayer.channel_id !== match.channel_id
  ) {
    await setMatchFeedback("rating_forbidden");
    return;
  }

  const { data: teamRows } = await supabase
    .from("channel_teams_view")
    .select("id,name")
    .eq("channel_id", match.channel_id)
    .in("name", [match.team_a_name, match.team_b_name])
    .returns<{ id: string; name: string }[]>();

  const matchTeamIds = new Set((teamRows ?? []).map((t) => t.id));
  if (
    !matchTeamIds.has(ownTeam.id) ||
    !matchTeamIds.has(targetPlayer.team_id)
  ) {
    await setMatchFeedback("rating_forbidden");
    return;
  }
  if (targetPlayer.team_id === ownTeam.id) {
    await setMatchFeedback("rating_same_team");
    return;
  }

  const fingerprintSalt =
    process.env.SESSION_SECRET || "qsb-rating-fallback-salt";
  const raterFingerprint = createHash("sha256")
    .update(`${fingerprintSalt}|${channelSlug}|${account.loginId}`)
    .digest("hex");

  await supabase.from("player_ratings").upsert(
    {
      channel_id: match.channel_id,
      match_id: match.id,
      target_player_id: targetPlayer.id,
      target_team_id: targetPlayer.team_id,
      rater_team_id: ownTeam.id,
      rater_fingerprint: raterFingerprint,
      rating,
    },
    { onConflict: "match_id,target_player_id,rater_fingerprint" },
  );

  await logMatchChange(matchId, channelSlug, "player_rating", {
    target_player_id: targetPlayer.id,
    target_team_id: targetPlayer.team_id,
    rating,
  });

  revalidatePath(`/m/${matchId}`);
  redirect(`/m/${matchId}`);
}

async function addSubstitutionEvent(
  matchId: string,
  channelSlug: string,
  formData: FormData,
) {
  "use server";

  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  const canMutate = await canMutateParticipation(channelSlug, matchId);
  if (!canMutate) {
    await setMatchFeedback("forbidden");
    return;
  }

  const { data: stateRow } = await supabase
    .from("matches")
    .select("period_state")
    .eq("id", matchId)
    .maybeSingle<{
      period_state: "pre" | "first_half" | "halftime" | "second_half" | "ended";
    }>();
  if (stateRow?.period_state === "ended") {
    await setMatchFeedback("participation_closed");
    return;
  }

  const teamSide = String(formData.get("team_side") || "").trim() as "A" | "B";
  const minute = Number(formData.get("minute") || 0);
  const reservationMode = String(formData.get("reservation_mode") || "now").trim();
  const reservationPeriodId = String(formData.get("reservation_period_id") || "").trim();
  const playerOutValue = String(formData.get("player_out_value") || "").trim();
  const playerInValue = String(formData.get("player_in_value") || "").trim();

  if (teamSide !== "A" && teamSide !== "B") {
    await setMatchFeedback("participation_invalid");
    return;
  }
  if (!Number.isFinite(minute) || minute < 0 || minute > 200) {
    await setMatchFeedback("participation_minute");
    return;
  }
  if (!playerOutValue || !playerInValue) {
    await setMatchFeedback("participation_player");
    return;
  }

  const [outIdRaw, outDisplayRaw] = playerOutValue.split("|");
  const [inIdRaw, inDisplayRaw] = playerInValue.split("|");
  const outId = outIdRaw?.trim() || null;
  const inId = inIdRaw?.trim() || null;
  const outName = (outDisplayRaw?.trim() || "").replace(/^#\d+\s*/, "");
  const inName = (inDisplayRaw?.trim() || "").replace(/^#\d+\s*/, "");

  if (outId && inId && outId === inId) {
    await setMatchFeedback("participation_same_player");
    return;
  }

  const shouldReserve =
    stateRow?.period_state === "pre" ||
    stateRow?.period_state === "halftime" ||
    reservationMode === "reserve";

  if (shouldReserve) {
    const { data: pendingPeriods } = await supabase
      .from("match_periods")
      .select("id,status,sequence")
      .eq("match_id", matchId)
      .is("deleted_at", null)
      .eq("status", "pending")
      .order("sequence", { ascending: true })
      .returns<
        {
          id: string;
          status: "pending" | "live" | "ended";
          sequence: number;
        }[]
      >();

    const targetPeriod =
      (pendingPeriods ?? []).find((p) => p.id === reservationPeriodId) ??
      (pendingPeriods ?? [])[0] ??
      null;

    if (!targetPeriod || targetPeriod.status !== "pending") {
      await setMatchFeedback("participation_reserve_period");
    return;
    }

    const targetSequence = targetPeriod.sequence;

    const { data: existingReserved } = await supabase
      .from("match_period_substitution_plans")
      .select("id,player_out_id,player_in_id")
      .eq("match_id", matchId)
      .eq("team_side", teamSide)
       .eq("match_period_id", targetPeriod.id)
      .is("deleted_at", null)
      .is("applied_at", null)
      .returns<
        {
          id: string;
          player_out_id: string | null;
          player_in_id: string | null;
        }[]
      >();

    const hasDuplicate = (existingReserved ?? []).some((row) => {
      const reservedIds = new Set([row.player_out_id, row.player_in_id].filter(Boolean));
      return (
        (outId ? reservedIds.has(outId) : false) ||
        (inId ? reservedIds.has(inId) : false)
      );
    });

    if (hasDuplicate) {
      await setMatchFeedback("participation_reserve_duplicate");
    return;
    }

    await supabase.from("match_period_substitution_plans").insert({
      match_id: matchId,
      team_side: teamSide,
      period_sequence: targetSequence,
      match_period_id: targetPeriod.id,
      player_out_id: outId || null,
      player_out_name: outName || null,
      player_in_id: inId || null,
      player_in_name: inName || null,
      planned_minute: minute,
    });

    await logMatchChange(matchId, channelSlug, "participation_substitution_reserve", {
      teamSide,
      period_sequence: targetSequence,
      minute,
      outId,
      outName,
      inId,
      inName,
    });

    revalidatePath(`/m/${matchId}`);
    redirect(`/m/${matchId}?mode=edit`);
  }

  const { data: livePeriodForSub } = await supabase
    .from("match_periods")
    .select("id,sequence")
    .eq("match_id", matchId)
    .eq("status", "live")
    .is("deleted_at", null)
    .maybeSingle<{ id: string; sequence: number }>();

  const { data: insertedSub } = await supabase
    .from("match_substitutions")
    .insert({
      match_id: matchId,
      period_sequence: livePeriodForSub?.sequence ?? (stateRow?.period_state === "second_half" ? 2 : 1),
      match_period_id: livePeriodForSub?.id ?? null,
      minute,
      team_side: teamSide,
      player_out_id: outId || null,
      player_out_name: outName || null,
      player_in_id: inId || null,
      player_in_name: inName || null,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  await logMatchChange(matchId, channelSlug, "participation_substitution_add", {
    teamSide,
    minute,
    outId,
    outName,
    inId,
    inName,
  });

  revalidatePath(`/m/${matchId}`);
  const undoIds = insertedSub?.id ? `sub:${insertedSub.id}` : "";
  const undoUntil = Date.now() + 30_000;
  redirect(
    `/m/${matchId}?mode=edit&undo=${encodeURIComponent(undoIds)}&undo_until=${undoUntil}`,
  );
}

async function undoSubstitutionEvent(
  matchId: string,
  channelSlug: string,
  formData: FormData,
) {
  "use server";

  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  const canMutate = await canMutateParticipation(channelSlug, matchId);
  if (!canMutate) {
    await setMatchFeedback("forbidden");
    return;
  }

  const undoIdsRaw = String(formData.get("undo_ids") || "").trim();
  const undoUntil = Number(formData.get("undo_until") || 0);
  if (!undoIdsRaw || !Number.isFinite(undoUntil) || Date.now() > undoUntil) {
    await setMatchFeedback("undo_expired");
    return;
  }

  const rawIds = undoIdsRaw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (rawIds.length === 0) {
    await setMatchFeedback("undo_expired");
    return;
  }

  const subIds = rawIds
    .filter((v) => v.startsWith("sub:"))
    .map((v) => v.slice(4))
    .filter(Boolean);

  if (subIds.length === 0) {
    await setMatchFeedback("undo_expired");
    return;
  }

  if (subIds.length > 0) {
    await supabase
      .from("match_substitutions")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", subIds)
      .eq("match_id", matchId)
      .is("deleted_at", null);
  }

  await logMatchChange(
    matchId,
    channelSlug,
    "participation_substitution_undo",
    { subIds },
  );

  revalidatePath(`/m/${matchId}`);
  redirect(`/m/${matchId}?mode=edit`);
}

async function cancelReservedSubstitution(
  matchId: string,
  channelSlug: string,
  formData: FormData,
) {
  "use server";

  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  const canMutate = await canMutateParticipation(channelSlug, matchId);
  if (!canMutate) {
    await setMatchFeedback("forbidden");
    return;
  }

  const reservationId = String(formData.get("reservation_id") || "").trim();
  if (!reservationId) {
    await setMatchFeedback("participation_reserve_cancel");
    return;
  }

  const { data: reservation } = await supabase
    .from("match_period_substitution_plans")
    .select("id,match_period_id,period_sequence,applied_at")
    .eq("id", reservationId)
    .eq("match_id", matchId)
    .is("deleted_at", null)
    .maybeSingle<{
      id: string;
      match_period_id: string | null;
      period_sequence: number;
      applied_at: string | null;
    }>();

  if (!reservation || reservation.applied_at) {
    await setMatchFeedback("participation_reserve_cancel");
    return;
  }

  const { data: periodRow } = await supabase
    .from("match_periods")
    .select("status")
    .eq("match_id", matchId)
    .eq("sequence", reservation.period_sequence)
    .is("deleted_at", null)
    .maybeSingle<{ status: "pending" | "live" | "ended" }>();

  if (!periodRow || periodRow.status !== "pending") {
    await setMatchFeedback("participation_reserve_cancel");
    return;
  }

  await supabase
    .from("match_period_substitution_plans")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", reservationId)
    .eq("match_id", matchId)
    .is("deleted_at", null)
    .is("applied_at", null);

  await logMatchChange(matchId, channelSlug, "participation_substitution_reserve_cancel", {
    reservationId,
  });

  revalidatePath(`/m/${matchId}`);
  redirect(`/m/${matchId}?mode=edit`);
}

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

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
    err?: string;
    mode?: string;
    undo?: string;
    undo_until?: string;
  }>;
}) {
  const { matchId } = await params;
  const { err, mode, undo, undo_until } = await searchParams;
  const store = await cookies();
  const feedbackCode = err ?? store.get(MATCH_FEEDBACK_COOKIE)?.value ?? null;
  const errToastMap: Record<string, string> = {
    forbidden: '권한이 없습니다.',
    participation_player: '선수를 1명 이상 선택해 주세요.',
    participation_minute: '분(minute)은 0~200 사이여야 합니다.',
    participation_invalid: '출전 이벤트 입력값을 확인해 주세요.',
    participation_closed: '경기 종료 후에는 수정할 수 없습니다.',
    participation_same_player: '같은 선수를 동시에 OUT/IN으로 선택할 수 없습니다.',
    participation_reserve_period: '예약할 period를 다시 선택해 주세요.',
    participation_reserve_duplicate: '이미 예약된 선수가 포함되어 있습니다.',
    participation_reserve_cancel: '예약 취소에 실패했습니다.',
    undo_expired: '교체 취소 가능 시간이 지났습니다.',
  }
  const errToastMessage = feedbackCode ? errToastMap[feedbackCode] : null
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return (
      <main className="min-h-screen bg-gray-50 px-4 pb-24 pt-0 md:px-6 md:pb-24 md:pt-0 page-enter">
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
      "id,seq,team_a_name,team_b_name,score_a,score_b,status,scheduled_start_at,started_at,channel_id,match_group_id,period_state,first_half_started_at,first_half_ended_at,halftime_started_at,second_half_started_at,second_half_ended_at,period_count",
    )
    .eq("id", matchId)
    .maybeSingle<Match>();

  if (!match) {
    return (
      <main className="min-h-screen bg-gray-50 px-4 pb-24 pt-0 md:px-6 md:pb-24 md:pt-0 page-enter">
        <section className="max-w-3xl mx-auto space-y-3">
          <h1 className="text-2xl font-semibold">경기를 찾을 수 없음</h1>
          <p className="text-sm text-gray-600">
            유효한 경기 링크인지 확인해 주세요.
          </p>
        </section>
      </main>
    );
  }

  const { data: matchPeriodsRaw } = await supabase
    .from("match_periods")
    .select("id,sequence,period_code,label,status")
    .eq("match_id", match.id)
    .is("deleted_at", null)
    .order("sequence", { ascending: true })
    .returns<MatchPeriodRow[]>();

  let matchPeriods = matchPeriodsRaw ?? [];
  const expectedPeriodCount = Math.max(1, match.period_count || 1);
  const existingSeq = new Set(matchPeriods.map((p) => p.sequence));
  const missingSeq = Array.from({ length: expectedPeriodCount }, (_, i) => i + 1).filter((seq) => !existingSeq.has(seq));

  if (missingSeq.length > 0) {
    await supabase.from("match_periods").insert(
      missingSeq.map((seq) => ({
        match_id: match.id,
        sequence: seq,
        period_code: seq <= 4 ? `Q${seq}` : `P${seq}`,
        label: `${seq}P`,
        status: "pending",
      })),
    );

    const { data: hydratedPeriods } = await supabase
      .from("match_periods")
      .select("id,sequence,period_code,label,status")
      .eq("match_id", match.id)
      .is("deleted_at", null)
      .order("sequence", { ascending: true })
      .returns<MatchPeriodRow[]>();
    matchPeriods = hydratedPeriods ?? matchPeriods;
  }

  const { data: channel } = await supabase
    .from("channels")
    .select("id,slug,name,edit_session_version")
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
  let teamAId: string | undefined;
  let teamBId: string | undefined;

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

    teamAId = teamARow?.id;
    teamBId = teamBRow?.id;

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

  const playerLabelById = new Map<string, string>([
    ...rosterA.map((p) => [p.playerId, `#${p.jerseyNo} ${p.playerName}`] as const),
    ...rosterB.map((p) => [p.playerId, `#${p.jerseyNo} ${p.playerName}`] as const),
  ]);

  const { data: goals } = await supabase
    .from("goal_events")
    .select(
      "id,team_side,period,period_sequence,match_period_id,minute,scorer_name,scorer_player_id,assist_name,assist_player_id,created_at",
    )
    .eq("match_id", matchId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .returns<GoalEvent[]>();

  const { data: feedbacks } = await supabase
    .from("match_feedbacks")
    .select("id,author_login_id,author_role,content,created_at")
    .eq("match_id", matchId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<MatchFeedbackRow[]>();

  const { data: matchSubstitutions } = await supabase
    .from("match_substitutions")
    .select(
      "id,period_sequence,match_period_id,minute,team_side,player_out_id,player_out_name,player_in_id,player_in_name,created_at",
    )
    .eq("match_id", matchId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .returns<MatchSubstitution[]>();


  const { data: periodLineups } = await supabase
    .from("match_period_lineups")
    .select("match_period_id,team_side,player_id,player_name")
    .eq("match_id", matchId)
    .is("deleted_at", null)
    .returns<MatchPeriodLineup[]>();

  const sortedPeriodsForLineups = [...(matchPeriods ?? [])].sort(
    (a, b) => a.sequence - b.sequence,
  );
  const livePeriodForLineups =
    sortedPeriodsForLineups.find((p) => p.status === "live") ?? null;
  const effectivePeriodId =
    livePeriodForLineups?.id ??
    sortedPeriodsForLineups.find((p) => p.status === "ended")?.id ??
    sortedPeriodsForLineups[0]?.id ??
    null;

  const lineupRowsA = (periodLineups ?? []).filter(
    (row) => row.match_period_id === effectivePeriodId && row.team_side === "A",
  );
  const lineupRowsB = (periodLineups ?? []).filter(
    (row) => row.match_period_id === effectivePeriodId && row.team_side === "B",
  );

  const starterKeySetA = new Set(
    lineupRowsA.map((row) => row.player_id || `name:${row.player_name ?? ""}`),
  );
  const starterKeySetB = new Set(
    lineupRowsB.map((row) => row.player_id || `name:${row.player_name ?? ""}`),
  );

  const startingCountA = starterKeySetA.size;
  const startingCountB = starterKeySetB.size;
  const isLivePeriod =
    match.period_state === "first_half" ||
    match.period_state === "halftime" ||
    match.period_state === "second_half" ||
    match.period_state === "ended";

  const subsA = (matchSubstitutions ?? []).filter((e) => e.team_side === "A");
  const subsB = (matchSubstitutions ?? []).filter((e) => e.team_side === "B");
  const calcActiveKeys = (
    subs: MatchSubstitution[],
    starterKeys: Set<string>,
  ) => {
    const bal = new Map<string, number>(
      Array.from(starterKeys).map((k) => [k, 1]),
    );
    for (const e of subs) {
      const outKey = e.player_out_id || `name:${e.player_out_name ?? ""}`;
      const inKey = e.player_in_id || `name:${e.player_in_name ?? ""}`;
      bal.set(outKey, (bal.get(outKey) ?? 0) - 1);
      bal.set(inKey, (bal.get(inKey) ?? 0) + 1);
    }
    return new Set(
      Array.from(bal.entries())
        .filter(([, v]) => v > 0)
        .map(([k]) => k),
    );
  };
  const activeKeysA = calcActiveKeys(subsA, starterKeySetA);
  const activeKeysB = calcActiveKeys(subsB, starterKeySetB);

  const { data: aliases } = await supabase
    .from("match_player_aliases")
    .select("jersey_no,player_name")
    .eq("match_id", matchId)
    .order("last_used_at", { ascending: false })
    .limit(50)
    .returns<Alias[]>();

  const { data: ratingAggRows } = await supabase
    .from("player_ratings")
    .select("target_player_id,rating")
    .eq("match_id", matchId)
    .returns<{ target_player_id: string; rating: number }[]>();

  const ratingMap = new Map<string, PlayerRatingAgg>();
  for (const row of ratingAggRows ?? []) {
    const prev = ratingMap.get(row.target_player_id) ?? {
      target_player_id: row.target_player_id,
      avg_rating: 0,
      rating_count: 0,
    };
    const total = prev.avg_rating * prev.rating_count + row.rating;
    const count = prev.rating_count + 1;
    ratingMap.set(row.target_player_id, {
      target_player_id: row.target_player_id,
      avg_rating: Number((total / count).toFixed(2)),
      rating_count: count,
    });
  }

  const myRatingMap = new Map<string, number>();
  const ratingAccount = channel ? await getAccountInfo(channel.slug) : null;
  if (ratingAccount && channel) {
    const fingerprintSalt =
      process.env.SESSION_SECRET || "qsb-rating-fallback-salt";
    const raterFingerprint = createHash("sha256")
      .update(`${fingerprintSalt}|${channel.slug}|${ratingAccount.loginId}`)
      .digest("hex");

    const { data: myRatings } = await supabase
      .from("player_ratings")
      .select("target_player_id,rating")
      .eq("match_id", matchId)
      .eq("rater_fingerprint", raterFingerprint)
      .returns<{ target_player_id: string; rating: number }[]>();

    for (const r of myRatings ?? []) {
      myRatingMap.set(r.target_player_id, Number(r.rating));
    }
  }

  const permission = channel
    ? await getChannelPermission(channel.slug)
    : { canGoalEdit: false, canManageMatch: false };
  const canEditThisMatch = channel
    ? await canAccountEditThisMatch(channel.slug, matchId)
    : false;
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
  const canRate =
    !!accountSession &&
    (accountSession.role === "player" || accountSession.role === "manager") &&
    match.status === "ended";
  const ratingTargetRoster =
    accountSession?.teamId && accountSession.teamId === teamAId
      ? rosterB
      : accountSession?.teamId && accountSession.teamId === teamBId
        ? rosterA
        : [];
  const submitRatingAction = channel
    ? submitAnonymousRating.bind(null, matchId, channel.slug)
    : async () => {};
  const submitFeedbackAction = channel
    ? submitMatchFeedback.bind(null, matchId, channel.slug)
    : async () => {};
  const matchUrl = `https://quick-scoreboard.vercel.app/m/${matchId}`;
  const currentPath = `/m/${matchId}`;
  const undoAvailable = !!undo && !!undo_until;

  const suggestedNames = Array.from(
    new Set([
      ...(aliases ?? []).map((a) => a.player_name).filter(Boolean),
      ...(goals ?? [])
        .flatMap((g) => [g.scorer_name, g.assist_name])
        .filter(Boolean),
    ] as string[]),
  ).slice(0, 20);

  const addGoalA = channel
    ? addGoalDetailed.bind(
        null,
        matchId,
        "A",
        channel.slug,
        channel.edit_session_version,
      )
    : async () => {};
  const addGoalB = channel
    ? addGoalDetailed.bind(
        null,
        matchId,
        "B",
        channel.slug,
        channel.edit_session_version,
      )
    : async () => {};
  const undoSubstitutionAction = channel
    ? undoSubstitutionEvent.bind(null, matchId, channel.slug)
    : async () => {};
  const startPeriodAction = channel
    ? applyPeriodAction.bind(
        null,
        matchId,
        channel.slug,
        channel.edit_session_version,
        "start_period",
      )
    : async () => {};
  const endPeriodAction = channel
    ? applyPeriodAction.bind(
        null,
        matchId,
        channel.slug,
        channel.edit_session_version,
        "end_period",
      )
    : async () => {};
  const resumePreviousAction = channel
    ? applyPeriodAction.bind(
        null,
        matchId,
        channel.slug,
        channel.edit_session_version,
        "resume_previous",
      )
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
    ? Math.max(
        0,
        Math.floor((now - new Date(activePeriodStart).getTime()) / 60000),
      )
    : null;
  const firstHalfBaseMinute =
    match.first_half_started_at && match.first_half_ended_at
      ? Math.max(
          0,
          Math.floor(
            (new Date(match.first_half_ended_at).getTime() -
              new Date(match.first_half_started_at).getTime()) /
              60000,
          ),
        )
      : 15;
  const goalDefaultMinute =
    match.period_state === "second_half"
      ? firstHalfBaseMinute + (elapsedMinutes ?? 0)
      : (elapsedMinutes ?? 0);

  const periodControlSummary = summarizeLegacyPeriodControl({
    periodCount: match.period_count,
    periodState: match.period_state,
    periods: matchPeriods ?? [],
  });
  const sortedPeriods = [...(matchPeriods ?? [])]
    .map((p) => ({ ...p, status: (p.status ?? "pending") as "pending" | "live" | "ended" }))
    .sort((a, b) => a.sequence - b.sequence);
  const livePeriod = sortedPeriods.find((p) => p.status === "live") ?? null;
  const nextPendingPeriod =
    sortedPeriods.find((p) => p.status === "pending") ?? null;
  const hasPendingAfterLive = livePeriod
    ? sortedPeriods.some(
        (p) => p.sequence > livePeriod.sequence && p.status === "pending",
      )
    : false;
  const canStartPeriod = !!nextPendingPeriod && !livePeriod && match.status !== "ended";
  const canEndPeriod = !!livePeriod;
  const canResumePrevious =
    !livePeriod && sortedPeriods.some((p) => p.status === "ended") && match.status !== "ended";
  const startPeriodLabel = nextPendingPeriod
    ? `${getPeriodDisplayLabel(nextPendingPeriod.sequence, nextPendingPeriod)} 시작`
    : null;
  const endPeriodLabel = livePeriod
    ? hasPendingAfterLive
      ? `${getPeriodDisplayLabel(livePeriod.sequence, livePeriod)} 종료`
      : "경기 종료"
    : null;
  const periodSequenceById = new Map((sortedPeriods ?? []).map((p) => [p.id, p.sequence] as const));
  const periodStarters = sortedPeriods
    .filter((p) => p.status !== "pending")
    .map((p) => {
      const rowsA = (periodLineups ?? []).filter(
        (row) => row.match_period_id === p.id && row.team_side === "A",
      );
      const rowsB = (periodLineups ?? []).filter(
        (row) => row.match_period_id === p.id && row.team_side === "B",
      );
      if (rowsA.length === 0 && rowsB.length === 0) return null;

      const toLabel = (row: { player_id: string | null; player_name: string | null }) =>
        (row.player_id ? playerLabelById.get(row.player_id) : undefined) ??
        row.player_name ??
        "선수";

      return {
        id: p.id,
        period_sequence: p.sequence,
        label: getPeriodDisplayLabel(p.sequence, p),
        startMinute: Math.max(0, (p.sequence - 1) * firstHalfBaseMinute),
        teamA: rowsA.map(toLabel).join(", "),
        teamB: rowsB.map(toLabel).join(", "),
      };
    })
    .filter(Boolean) as { id: string; period_sequence: number; label: string; startMinute: number; teamA: string; teamB: string }[];

  return (
    <main className="min-h-screen bg-gray-50 px-4 pb-24 pt-0 md:px-6 md:pb-24 md:pt-0 page-enter">
      <section className="max-w-3xl mx-auto space-y-4">
        {errToastMessage ? <TransientToast message={errToastMessage} tone="error" /> : null}
        <UserGNB
          slug={channel?.slug}
          channelName={channel?.name ?? "경기"}
          current="matches"
          subtitle={`${match.seq}경기 · ${match.status}`}
          isLoggedIn={!!accountSession}
          rightActions={(
            <>
              {!accountSession && channel ? (
                <LoginModal
                  slug={channel.slug}
                  redirectTo={currentPath}
                  triggerClassName="rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white"
                />
              ) : null}
              {accountSession && channel ? (
                <AccountBadge
                  loginId={accountSession.loginId}
                  role={accountSession.role}
                  slug={channel.slug}
                  redirectTo={currentPath}
                  accountHref={`/c/${encodeURIComponent(channel.slug)}/account?next=${encodeURIComponent(currentPath)}`}
                />
              ) : null}
              <ShareButton
                url={matchUrl}
                title={`${match.seq}경기 ${match.team_a_name} vs ${match.team_b_name}`}
              />
            </>
          )}
        />

        {(canGoalEdit || isEditMode || (accountSession?.role === "player" && !canEditThisMatch) || group || undoAvailable) ? (
          <div className="rounded border bg-white px-3 py-2 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {canGoalEdit && !isEditMode ? (
                <Link
                  href={`/m/${matchId}?mode=edit`}
                  className="rounded border border-blue-300 bg-blue-50 px-2 py-0.5 text-blue-700"
                >
                  편집모드로 전환
                </Link>
              ) : null}
              {isEditMode ? (
                <Link
                  href={`/m/${matchId}`}
                  className="rounded border border-gray-300 bg-gray-50 px-2 py-0.5 text-gray-700"
                >
                  보기모드로 돌아가기
                </Link>
              ) : null}
              {group ? (
                <span className="text-xs text-gray-500">
                  {group.title ?? `${group.play_date} 그룹 ${group.seq}`}
                </span>
              ) : null}
            </div>
            {undoAvailable ? (
              <form
                action={undoSubstitutionAction}
                className="inline-flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800"
              >
                <input type="hidden" name="undo_ids" value={undo ?? ""} />
                <input type="hidden" name="undo_until" value={undo_until ?? ""} />
                <span>최근 교체를 취소할 수 있습니다.</span>
                <PendingSubmitButton className="rounded border px-2 py-0.5 text-xs">
                  교체 취소
                </PendingSubmitButton>
              </form>
            ) : null}
          </div>
        ) : null}

        <MatchEditHelp
          isEditMode={isEditMode}
          canStartPeriod={canStartPeriod}
          startPeriodLabel={startPeriodLabel}
        />

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
            period_sequence: g.match_period_id ? periodSequenceById.get(g.match_period_id) ?? g.period_sequence : g.period_sequence,
            minute: g.minute,
            scorer_name: g.scorer_name,
            assist_name: g.assist_name,
            created_at: g.created_at,
          }))}
          substitutionEvents={(matchSubstitutions ?? []).map((s) => ({
            id: s.id,
            period_sequence: s.match_period_id ? periodSequenceById.get(s.match_period_id) ?? s.period_sequence : s.period_sequence,
            minute: s.minute,
            team_side: s.team_side,
            player_out_label:
              (s.player_out_id ? playerLabelById.get(s.player_out_id) : undefined) ??
              s.player_out_name ??
              "선수",
            player_in_label:
              (s.player_in_id ? playerLabelById.get(s.player_in_id) : undefined) ??
              s.player_in_name ??
              "선수",
            created_at: s.created_at,
          }))}
          periodStarters={periodStarters}
        />

        {isEditMode ? (
          <div className="space-y-2">
            {canAddGoalNow ? (
              <>
                <GoalAddActions
                  actionA={addGoalA}
                  actionB={addGoalB}
                  teamAName={match.team_a_name}
                  teamBName={match.team_b_name}
                  rosterA={rosterA}
                  rosterB={rosterB}
                  defaultMinute={goalDefaultMinute}
                  periodState={match.period_state}
                  firstHalfStartedAt={match.first_half_started_at}
                  secondHalfStartedAt={match.second_half_started_at}
                  firstHalfBaseMinute={firstHalfBaseMinute}
                />
                <p className="text-[11px] text-gray-500">득점자/어시스트를 모르면 비워두고 저장한 뒤 나중에 수정할 수 있습니다.</p>
              </>
            ) : null}

            {canManageMatch ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-gray-500">
                  현재:{" "}
                  {periodControlSummary.statusLabel}
                  <LiveMinuteBadge
                    periodState={match.period_state}
                    firstHalfStartedAt={match.first_half_started_at}
                    secondHalfStartedAt={match.second_half_started_at}
                    firstHalfBaseMinute={firstHalfBaseMinute}
                  />
                </span>
                {canStartPeriod ? (
                  <form action={startPeriodAction}>
                    <PendingSubmitButton
                      className="rounded border border-emerald-300 bg-emerald-50 text-emerald-800 px-2 py-1"
                      pendingText="처리중..."
                      confirmMessage="경기를 시작하시겠습니까? 시작 후에는 되돌릴 수 없습니다."
                    >
                      {startPeriodLabel ?? periodControlSummary.primaryActionLabel ?? "1P 시작"}
                    </PendingSubmitButton>
                  </form>
                ) : null}
                {!canStartPeriod && !canEndPeriod && match.status === "scheduled" ? (
                  <span className="text-[11px] text-amber-700">시작 가능한 구간이 없습니다. 경기구간수를 저장해 주세요.</span>
                ) : null}
                {canEndPeriod ? (
                  <form action={endPeriodAction}>
                    <PendingSubmitButton
                      className="rounded border px-2 py-1"
                      pendingText="처리중..."
                      confirmMessage="경기를 종료하시겠습니까? 종료 후에는 되돌릴 수 없습니다."
                    >
                      {endPeriodLabel ?? "현재 period 종료"}
                    </PendingSubmitButton>
                  </form>
                ) : null}
                {canResumePrevious ? (
                  <form action={resumePreviousAction}>
                    <PendingSubmitButton
                      className="rounded border px-2 py-1"
                      pendingText="처리중..."
                    >
                      이전 구간 재개
                    </PendingSubmitButton>
                  </form>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {rosterA.length === 0 && rosterB.length === 0 ? (
          <p className="text-xs text-amber-600">
            엔트리가 확정되지 않았습니다.
          </p>
        ) : (
          <section className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <details>
              <summary className="text-xs font-semibold text-gray-700 cursor-pointer">
                전체 엔트리 ({rosterA.length + rosterB.length}명)
              </summary>
              <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="font-semibold text-gray-600 mb-1">
                    {match.team_a_name}
                  </div>
                  {rosterA.map((p) => {
                    const key = p.playerId || `name:${p.playerName}`;
                    const onPitch = isLivePeriod && activeKeysA.has(key);
                    return (
                      <div
                        key={p.value}
                        className={
                          onPitch
                            ? "text-green-700 font-medium"
                            : "text-gray-700"
                        }
                      >
                        #{p.jerseyNo} {p.playerName}
                      </div>
                    );
                  })}
                </div>
                <div>
                  <div className="font-semibold text-gray-600 mb-1">
                    {match.team_b_name}
                  </div>
                  {rosterB.map((p) => {
                    const key = p.playerId || `name:${p.playerName}`;
                    const onPitch = isLivePeriod && activeKeysB.has(key);
                    return (
                      <div
                        key={p.value}
                        className={
                          onPitch
                            ? "text-green-700 font-medium"
                            : "text-gray-700"
                        }
                      >
                        #{p.jerseyNo} {p.playerName}
                      </div>
                    );
                  })}
                </div>
              </div>
            </details>
          </section>
        )}

        <section className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900">댓글</h3>
          </div>

          {(feedbacks ?? []).length === 0 ? (
            <p className="text-sm text-gray-500">아직 등록된 댓글이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {(feedbacks ?? []).map((fb) => (
                <li key={fb.id} className="py-2">
                  <div className="text-xs text-gray-500">{fb.author_login_id ?? '익명'}{fb.author_role ? ` (${fb.author_role})` : ''} · {new Date(fb.created_at).toLocaleString('ko-KR')}</div>
                  <div className="mt-1 text-sm text-gray-900 whitespace-pre-wrap break-words">
                    {fb.content.split(URL_REGEX).map((part, idx) =>
                      /^https?:\/\//i.test(part) ? (
                        <a key={`${fb.id}-link-${idx}`} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline break-all">
                          {part}
                        </a>
                      ) : (
                        <span key={`${fb.id}-txt-${idx}`}>{part}</span>
                      ),
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {accountSession || isAdminSession ? (
            <details>
              <summary className="cursor-pointer list-none inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700">
                댓글 입력하기
              </summary>
              <form action={submitFeedbackAction} className="mt-2 space-y-2">
                <textarea
                  name="content"
                  required
                  maxLength={300}
                  placeholder="경기에 대한 코멘트나 링크를 남겨주세요 (최대 300자)"
                  className="w-full rounded border border-gray-200 px-2 py-1.5 text-base"
                  rows={3}
                />
                <PendingSubmitButton className="rounded border px-2 py-1 text-xs" pendingText="등록중...">댓글 등록</PendingSubmitButton>
              </form>
            </details>
          ) : (
            <p className="text-xs text-gray-500">댓글 작성은 로그인 후 가능합니다.</p>
          )}
        </section>

        {canEditGoalNow && channel ? (
          <GoalEditModal
            goals={(goals ?? []).map((g) => ({
              id: g.id,
              team_side: g.team_side,
              minute: g.minute,
              scorer_player_id: g.scorer_player_id,
              scorer_name: g.scorer_name,
              assist_player_id: g.assist_player_id,
              assist_name: g.assist_name,
            }))}
            rosterA={rosterA}
            rosterB={rosterB}
            updateAction={updateGoalEventFromForm.bind(
              null,
              matchId,
              channel.slug,
              channel.edit_session_version,
            )}
            deleteAction={deleteGoalEventFromForm.bind(
              null,
              matchId,
              channel.slug,
              channel.edit_session_version,
            )}
          />
        ) : null}
      </section>
    </main>
  );
}
