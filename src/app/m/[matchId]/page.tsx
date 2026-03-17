import type { Metadata } from "next";
import { createHash } from "crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase";
import { validateManagerAgainstDb, getAccountInfo } from "@/lib/channelSession";
import { isAdminAuthorized } from "@/lib/adminAuth";
import { autoStartDueMatches } from "@/lib/matchSchedule";
import GoalAddActions from "./GoalAddActions";
import GoalEditModal from "./GoalEditModal";
import LiveScoreboard from "./LiveScoreboard";
import ShareButton from "@/components/ShareButton";
import AccountBadge from "@/components/AccountBadge";
import Breadcrumb from "@/components/Breadcrumb";
import StarRatingInput from "@/components/StarRatingInput";
import SubstitutionActions from "./SubstitutionActions";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import LiveMinuteBadge from "./LiveMinuteBadge";
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

type ReservedSubstitutionPlan = {
  id: string;
  team_side: "A" | "B";
  match_period_id: string;
  period_sequence: number;
  player_out_id: string | null;
  player_out_name: string | null;
  player_in_id: string | null;
  player_in_name: string | null;
  planned_minute: number;
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
  const account = await getAccountInfo(channelSlug);
  if (!account) return true;
  if (account.role !== "player" && account.role !== "manager") return true;
  if (!account.teamId) return false;

  const supabase = getSupabaseServerClient();
  if (!supabase) return false;

  const { data: match } = await supabase
    .from("matches")
    .select("team_a_name,team_b_name")
    .eq("id", matchId)
    .maybeSingle<{ team_a_name: string; team_b_name: string }>();

  if (!match) return false;

  const { data: ownTeam } = await supabase
    .from("teams")
    .select("name")
    .eq("id", account.teamId)
    .maybeSingle<{ name: string }>();

  if (!ownTeam) return false;

  if (
    match.team_a_name === ownTeam.name ||
    match.team_b_name === ownTeam.name
  ) {
    return false;
  }

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
      "id,status,started_at,period_state,first_half_started_at,second_half_started_at",
    )
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

  const { data: periods } = await supabase
    .from("match_periods")
    .select("id,sequence,status")
    .eq("match_id", matchId)
    .is("deleted_at", null)
    .order("sequence", { ascending: true })
    .returns<
      { id: string; sequence: number; status: "pending" | "live" | "ended" }[]
    >();

  if (!periods || periods.length === 0) {
    redirect(`/m/${matchId}?mode=edit&err=periods_not_ready`);
  }

  const livePeriod = periods.find((p) => p.status === "live") ?? null;
  const nextPending = periods.find((p) => p.status === "pending") ?? null;
  const endedPeriods = periods.filter((p) => p.status === "ended");
  const lastEndedPeriod = endedPeriods[endedPeriods.length - 1] ?? null;

  const now = new Date().toISOString();
  const patch: Record<string, string | null> = {};

  if (action === "start_period") {
    if (livePeriod || !nextPending) {
      redirect(`/m/${matchId}?mode=edit&err=invalid_period_action`);
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
      redirect(`/m/${matchId}?mode=edit&err=invalid_period_action`);
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
      redirect(`/m/${matchId}?mode=edit&err=invalid_period_action`);
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
    redirect(`/m/${matchId}?mode=edit&err=invalid_period_action`);
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

  await logMatchChange(matchId, channelSlug, "goal_update", {
    goalId,
    minute,
    scorer: scorer.name,
    assist: assist.name,
  });

  revalidatePath(`/m/${matchId}`);
  redirect(`/m/${matchId}?mode=edit&ok=goal_saved&goal=${goalId}`);
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
  redirect(`/m/${matchId}?mode=edit&ok=goal_deleted`);
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
    redirect(`/m/${matchId}?err=rating_forbidden`);
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
    redirect(`/m/${matchId}?err=rating_invalid`);
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
    redirect(`/m/${matchId}?err=rating_closed`);
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
    redirect(`/m/${matchId}?err=rating_forbidden`);
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
    redirect(`/m/${matchId}?err=rating_forbidden`);
  }
  if (targetPlayer.team_id === ownTeam.id) {
    redirect(`/m/${matchId}?err=rating_same_team`);
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
    redirect(`/m/${matchId}?mode=edit&err=forbidden`);
  }

  const { data: stateRow } = await supabase
    .from("matches")
    .select("period_state")
    .eq("id", matchId)
    .maybeSingle<{
      period_state: "pre" | "first_half" | "halftime" | "second_half" | "ended";
    }>();
  if (stateRow?.period_state === "ended") {
    redirect(`/m/${matchId}?mode=edit&err=participation_closed`);
  }

  const teamSide = String(formData.get("team_side") || "").trim() as "A" | "B";
  const minute = Number(formData.get("minute") || 0);
  const reservationMode = String(formData.get("reservation_mode") || "now").trim();
  const reservationPeriodId = String(formData.get("reservation_period_id") || "").trim();
  const playerOutValue = String(formData.get("player_out_value") || "").trim();
  const playerInValue = String(formData.get("player_in_value") || "").trim();

  if (teamSide !== "A" && teamSide !== "B") {
    redirect(`/m/${matchId}?mode=edit&err=participation_invalid`);
  }
  if (!Number.isFinite(minute) || minute < 0 || minute > 200) {
    redirect(`/m/${matchId}?mode=edit&err=participation_minute`);
  }
  if (!playerOutValue || !playerInValue) {
    redirect(`/m/${matchId}?mode=edit&err=participation_player`);
  }

  const [outIdRaw, outDisplayRaw] = playerOutValue.split("|");
  const [inIdRaw, inDisplayRaw] = playerInValue.split("|");
  const outId = outIdRaw?.trim() || null;
  const inId = inIdRaw?.trim() || null;
  const outName = (outDisplayRaw?.trim() || "").replace(/^#\d+\s*/, "");
  const inName = (inDisplayRaw?.trim() || "").replace(/^#\d+\s*/, "");

  if (outId && inId && outId === inId) {
    redirect(`/m/${matchId}?mode=edit&err=participation_same_player`);
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
      redirect(`/m/${matchId}?mode=edit&err=participation_reserve_period`);
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
      redirect(`/m/${matchId}?mode=edit&err=participation_reserve_duplicate`);
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
    redirect(`/m/${matchId}?mode=edit&err=forbidden`);
  }

  const undoIdsRaw = String(formData.get("undo_ids") || "").trim();
  const undoUntil = Number(formData.get("undo_until") || 0);
  if (!undoIdsRaw || !Number.isFinite(undoUntil) || Date.now() > undoUntil) {
    redirect(`/m/${matchId}?mode=edit&err=undo_expired`);
  }

  const rawIds = undoIdsRaw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (rawIds.length === 0) {
    redirect(`/m/${matchId}?mode=edit&err=undo_expired`);
  }

  const subIds = rawIds
    .filter((v) => v.startsWith("sub:"))
    .map((v) => v.slice(4))
    .filter(Boolean);

  if (subIds.length === 0) {
    redirect(`/m/${matchId}?mode=edit&err=undo_expired`);
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
    redirect(`/m/${matchId}?mode=edit&err=forbidden`);
  }

  const reservationId = String(formData.get("reservation_id") || "").trim();
  if (!reservationId) {
    redirect(`/m/${matchId}?mode=edit&err=participation_reserve_cancel`);
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
    redirect(`/m/${matchId}?mode=edit&err=participation_reserve_cancel`);
  }

  const { data: periodRow } = await supabase
    .from("match_periods")
    .select("status")
    .eq("match_id", matchId)
    .eq("sequence", reservation.period_sequence)
    .is("deleted_at", null)
    .maybeSingle<{ status: "pending" | "live" | "ended" }>();

  if (!periodRow || periodRow.status !== "pending") {
    redirect(`/m/${matchId}?mode=edit&err=participation_reserve_cancel`);
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
    goal?: string;
    err?: string;
    mode?: string;
    undo?: string;
    undo_until?: string;
    ok?: string;
  }>;
}) {
  const { matchId } = await params;
  const { goal: goalParam, err, mode, undo, undo_until, ok } = await searchParams;
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
      "id,seq,team_a_name,team_b_name,score_a,score_b,status,scheduled_start_at,started_at,channel_id,match_group_id,period_state,first_half_started_at,first_half_ended_at,halftime_started_at,second_half_started_at,second_half_ended_at,period_count",
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

  const { data: matchPeriods } = await supabase
    .from("match_periods")
    .select("id,sequence,period_code,label,status")
    .eq("match_id", match.id)
    .is("deleted_at", null)
    .order("sequence", { ascending: true })
    .returns<MatchPeriodRow[]>();

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

  const { data: reservedSubPlans } = await supabase
    .from("match_period_substitution_plans")
    .select(
      "id,team_side,match_period_id,period_sequence,player_out_id,player_out_name,player_in_id,player_in_name,planned_minute",
    )
    .eq("match_id", matchId)
    .is("deleted_at", null)
    .is("applied_at", null)
    .returns<ReservedSubstitutionPlan[]>();

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
  const matchUrl = `https://quick-scoreboard.vercel.app/m/${matchId}`;
  const currentPath = `/m/${matchId}`;
  const activeGoalId = goalParam ?? "";
  const activeGoal = activeGoalId
    ? ((goals ?? []).find((g) => g.id === activeGoalId) ?? null)
    : null;
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
  const addSubstitutionAction = channel
    ? addSubstitutionEvent.bind(null, matchId, channel.slug)
    : async () => {};
  const undoSubstitutionAction = channel
    ? undoSubstitutionEvent.bind(null, matchId, channel.slug)
    : async () => {};
  const cancelReservedSubstitutionAction = channel
    ? cancelReservedSubstitution.bind(null, matchId, channel.slug)
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
  const sortedPeriods = [...(matchPeriods ?? [])].sort(
    (a, b) => a.sequence - b.sequence,
  );
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
  const reservablePeriods = sortedPeriods
    .filter((p) => p.status === "pending")
    .map((p) => ({
      id: p.id,
      sequence: p.sequence,
      label: getPeriodDisplayLabel(p.sequence, p),
    }));

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
    <main className="min-h-screen p-4 md:p-6 bg-white page-enter">
      <section className="max-w-3xl mx-auto space-y-4">
        <header className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              <Breadcrumb
                items={[
                  {
                    label: "경기목록",
                    href: channel ? `/c/${channel.slug}` : "/",
                  },
                  ...(group
                    ? [
                        {
                          label:
                            group.title ??
                            `${group.play_date} 그룹 ${group.seq}`,
                        },
                      ]
                    : []),
                ]}
              />
              <span className="text-xs text-gray-500">›</span>
              <span className="font-semibold text-gray-900 text-base">
                {match.seq}경기
              </span>
              <span className="text-xs text-gray-400">({match.status})</span>
            </div>
            <div className="flex items-center gap-2">
              {accountSession ? (
                <AccountBadge
                  loginId={accountSession.loginId}
                  role={accountSession.role}
                  slug={channel!.slug}
                  redirectTo={currentPath}
                />
              ) : null}
              <ShareButton
                url={matchUrl}
                title={`${match.seq}경기 ${match.team_a_name} vs ${match.team_b_name}`}
              />
            </div>
          </div>
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
            {accountSession?.role === "player" && !canEditThisMatch ? (
              <span className="text-xs text-amber-700">
                본인 팀 경기는 점수 입력이 제한됩니다. (팀장/팀원 공통)
              </span>
            ) : null}
          </div>
          {ok === "goal_saved" ? <p className="text-xs text-green-700">이벤트가 저장되었습니다.</p> : null}
          {ok === "goal_deleted" ? <p className="text-xs text-green-700">이벤트가 삭제되었습니다.</p> : null}
          {err ? (
            <p className="text-xs text-red-600">
              저장 중 오류가 발생했습니다: {err}
            </p>
          ) : null}
          {err === "forbidden" ? (
            <p className="text-xs text-red-600">
              권한이 없어 저장할 수 없습니다.
            </p>
          ) : null}
          {err === "participation_player" ? (
            <p className="text-xs text-red-600">
              선수를 1명 이상 선택해 주세요.
            </p>
          ) : null}
          {err === "participation_minute" ? (
            <p className="text-xs text-red-600">
              분(minute)은 0~200 사이여야 합니다.
            </p>
          ) : null}
          {err === "participation_invalid" ? (
            <p className="text-xs text-red-600">
              출전 이벤트 입력값을 확인해 주세요.
            </p>
          ) : null}
          {err === "participation_closed" ? (
            <p className="text-xs text-red-600">
              경기 종료 후에는 선수 교체를 수정할 수 없습니다.
            </p>
          ) : null}
          {err === "participation_same_player" ? (
            <p className="text-xs text-red-600">
              같은 선수를 동시에 OUT/IN으로 선택할 수 없습니다.
            </p>
          ) : null}
          {err === "participation_reserve_period" ? (
            <p className="text-xs text-red-600">
              예약할 period를 다시 선택해 주세요. (시작 전 period만 예약 가능)
            </p>
          ) : null}
          {err === "participation_reserve_duplicate" ? (
            <p className="text-xs text-red-600">
              시작 전에는 이미 교체 예약에 포함된 선수를 다시 예약할 수 없습니다.
            </p>
          ) : null}
          {err === "participation_reserve_cancel" ? (
            <p className="text-xs text-red-600">
              예약 취소에 실패했습니다. 이미 적용되었거나 시작된 period일 수 있습니다.
            </p>
          ) : null}
          {err === "rating_same_team" ? (
            <p className="text-xs text-red-600">
              같은 팀 선수는 평점 대상이 아닙니다.
            </p>
          ) : null}
          {err === "rating_closed" ? (
            <p className="text-xs text-red-600">
              경기 종료 후에만 평점 입력이 가능합니다.
            </p>
          ) : null}
          {err === "undo_expired" ? (
            <p className="text-xs text-red-600">
              교체 취소 가능 시간이 지났습니다.
            </p>
          ) : null}
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
              <GoalAddActions
                actionA={addGoalA}
                actionB={addGoalB}
                teamAName={match.team_a_name}
                teamBName={match.team_b_name}
                rosterA={(() => {
                  const active = rosterA.filter((p) => activeKeysA.has(p.playerId || `name:${p.playerName}`));
                  return active.length > 0 ? active : rosterA;
                })()}
                rosterB={(() => {
                  const active = rosterB.filter((p) => activeKeysB.has(p.playerId || `name:${p.playerName}`));
                  return active.length > 0 ? active : rosterB;
                })()}
                defaultMinute={goalDefaultMinute}
                periodState={match.period_state}
                firstHalfStartedAt={match.first_half_started_at}
                secondHalfStartedAt={match.second_half_started_at}
                firstHalfBaseMinute={firstHalfBaseMinute}
              />
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
                      className="rounded border px-2 py-1"
                      pendingText="처리중..."
                      confirmMessage="경기를 시작하시겠습니까? 시작 후에는 되돌릴 수 없습니다."
                    >
                      {startPeriodLabel ?? periodControlSummary.primaryActionLabel ?? "1P 시작"}
                    </PendingSubmitButton>
                  </form>
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

        {isEditMode ? (
          <section className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <details>
              <summary className="cursor-pointer list-none text-sm font-semibold text-gray-700 flex items-center justify-between">
                <span>선수 운용</span>
                <span className="text-xs text-gray-500">
                  선발 A {startingCountA}명 · B {startingCountB}명 · 이벤트{" "}
                  {(matchSubstitutions ?? []).length}건
                </span>
              </summary>

              <div className="mt-3 space-y-3">
                <div className="rounded border p-3">
                    <SubstitutionActions
                      action={addSubstitutionAction}
                      teamAName={match.team_a_name}
                      teamBName={match.team_b_name}
                      activeA={rosterA.filter((p) =>
                        activeKeysA.has(p.playerId || `name:${p.playerName}`),
                      )}
                      benchA={rosterA.filter(
                        (p) =>
                          !activeKeysA.has(
                            p.playerId || `name:${p.playerName}`,
                          ),
                      )}
                      activeB={rosterB.filter((p) =>
                        activeKeysB.has(p.playerId || `name:${p.playerName}`),
                      )}
                      benchB={rosterB.filter(
                        (p) =>
                          !activeKeysB.has(
                            p.playerId || `name:${p.playerName}`,
                          ),
                      )}
                      disabled={match.period_state === "ended"}
                      periodState={match.period_state}
                      firstHalfStartedAt={match.first_half_started_at}
                      secondHalfStartedAt={match.second_half_started_at}
                      firstHalfEndedAt={match.first_half_ended_at}
                      reservablePeriods={reservablePeriods}
                    />
                  </div>

                <div className="text-xs text-gray-500">교체 이벤트는 상단 스코어보드에서 확인해 주세요.</div>

                {reservablePeriods.length > 0 ? (
                  <div className="rounded border p-2 space-y-1 text-xs">
                    <div className="font-medium text-gray-700">시작 전 교체 예약</div>
                    {(reservedSubPlans ?? []).length === 0 ? (
                      <div className="text-gray-500">예약된 교체가 없습니다.</div>
                    ) : (
                      <ul className="space-y-1">
                        {(reservedSubPlans ?? []).map((plan) => {
                          const periodLabel =
                            sortedPeriods.find(
                              (p) => p.sequence === plan.period_sequence,
                            )?.label ??
                            sortedPeriods.find(
                              (p) => p.sequence === plan.period_sequence,
                            )?.period_code ??
                            `${plan.period_sequence}P`;
                          const outLabel =
                            (plan.player_out_id
                              ? playerLabelById.get(plan.player_out_id)
                              : undefined) ??
                            plan.player_out_name ??
                            "선수";
                          const inLabel =
                            (plan.player_in_id
                              ? playerLabelById.get(plan.player_in_id)
                              : undefined) ??
                            plan.player_in_name ??
                            "선수";
                          return (
                            <li
                              key={`reserved-sub-${plan.id}`}
                              className="flex items-center justify-between gap-2 rounded border px-2 py-1"
                            >
                              <span>
                                [{periodLabel}] {plan.team_side} · {plan.planned_minute}분 · OUT {outLabel} / IN {inLabel}
                              </span>
                              <form action={cancelReservedSubstitutionAction}>
                                <input
                                  type="hidden"
                                  name="reservation_id"
                                  value={plan.id}
                                />
                                <PendingSubmitButton className="rounded border px-2 py-0.5 text-xs">
                                  예약 취소
                                </PendingSubmitButton>
                              </form>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
            </details>
          </section>
        ) : null}

        {canRate ? (
          <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700">
              무기명 평점 입력 (1.0~5.0, 0.5 단위)
            </h2>
            {ratingTargetRoster.length === 0 ? (
              <p className="text-xs text-gray-500">
                평점 대상 선수가 없습니다. (타팀 선수만 가능)
              </p>
            ) : (
              <ul className="space-y-2">
                {ratingTargetRoster.map((p) => {
                  const agg = ratingMap.get(p.playerId);
                  return (
                    <li
                      key={`rate-${p.playerId}`}
                      className="rounded border p-2 flex items-center justify-between gap-2"
                    >
                      <div className="text-sm">
                        #{p.jerseyNo} {p.playerName}
                        {agg ? (
                          <span className="ml-2 text-xs text-gray-500">
                            평균 {agg.avg_rating} ({agg.rating_count})
                          </span>
                        ) : null}
                      </div>
                      <form
                        action={submitRatingAction}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="hidden"
                          name="target_player_id"
                          value={p.playerId}
                        />
                        <StarRatingInput
                          name="rating"
                          defaultValue={3}
                          initialValue={myRatingMap.get(p.playerId) ?? 3}
                          submitLabel="저장"
                        />
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-[11px] text-gray-500">
              입력자 원문 정보는 저장하지 않으며, 동일 계정은 같은 선수에게
              1회만 평점(재입력 시 갱신) 가능합니다.
            </p>
          </section>
        ) : null}

        {canEditGoalNow ? (
          <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-2 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700">이벤트 편집</h2>
            <p className="text-xs text-gray-500">상단 스코어보드에서 골 이벤트를 누르면 편집 모달이 열립니다.</p>
            {rosterA.length === 0 && rosterB.length === 0 && suggestedNames.length > 0 ? (
              <div className="space-y-1">
                <div className="text-xs text-gray-500">이 경기에서 자주 쓴 값 추천</div>
                <div className="flex flex-wrap gap-1">
                  {suggestedNames.map((name) => (
                    <span key={name} className="text-[11px] rounded-lg border border-gray-200 px-1.5 py-0.5 text-gray-600">
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

        {canEditGoalNow && activeGoal && channel ? (
          (() => {
            const roster = activeGoal.team_side === "A" ? rosterA : rosterB;
            const hasRoster = roster.length > 0;
            const findRosterValue = (playerId: string | null, playerName: string | null) => {
              if (playerId) {
                const byId = roster.find((p) => p.playerId === playerId);
                if (byId) return byId.value;
              }
              if (playerName) {
                const byName = roster.find((p) => p.playerName === playerName);
                if (byName) return byName.value;
              }
              return playerName ?? "";
            };
            const scorerDefault = findRosterValue(activeGoal.scorer_player_id, activeGoal.scorer_name);
            const assistDefault = findRosterValue(activeGoal.assist_player_id, activeGoal.assist_name);

            return (
              <GoalEditModal
                teamSide={activeGoal.team_side}
                minute={activeGoal.minute}
                scorerName={activeGoal.scorer_name}
                assistName={activeGoal.assist_name}
                roster={roster}
                hasRoster={hasRoster}
                scorerDefault={scorerDefault}
                assistDefault={assistDefault}
                updateAction={updateGoalEvent.bind(
                  null,
                  matchId,
                  activeGoal.id,
                  channel.slug,
                  channel.edit_session_version,
                )}
                deleteAction={deleteGoalEvent.bind(
                  null,
                  matchId,
                  activeGoal.id,
                  activeGoal.team_side,
                  channel.slug,
                  channel.edit_session_version,
                )}
              />
            );
          })()
        ) : null}
      </section>
    </main>
  );
}
