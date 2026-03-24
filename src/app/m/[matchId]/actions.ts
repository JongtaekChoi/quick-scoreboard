"use server";

import { createHash } from "crypto";
import { getSupabaseServerClient } from "@/lib/supabase";
import { validateManagerAgainstDb, getAccountInfo } from "@/lib/channelSession";
import { isAdminAuthorized } from "@/lib/adminAuth";
import type { GoalPermission, ChangeActor } from "./types";

type ActionResult = { success: true } | { error: string };

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

  return !(
    match.team_a_name === ownTeam.name || match.team_b_name === ownTeam.name
  );
}

async function canMutateGoals(
  channelSlug: string,
  matchId: string,
  action: "add" | "edit",
): Promise<boolean> {
  const permission = await getChannelPermission(channelSlug);
  if (!permission.canGoalEdit) return false;

  const canEditThis = await canAccountEditThisMatch(channelSlug, matchId);
  if (!canEditThis) return false;

  const supabase = getSupabaseServerClient();
  if (!supabase) return false;

  const { data: match } = await supabase
    .from("matches")
    .select("period_state")
    .eq("id", matchId)
    .maybeSingle<{
      period_state:
        | "pre"
        | "first_half"
        | "halftime"
        | "second_half"
        | "ended";
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

  const canEditThis = await canAccountEditThisMatch(channelSlug, matchId);
  if (!canEditThis) return false;

  const supabase = getSupabaseServerClient();
  if (!supabase) return false;

  const { data: match } = await supabase
    .from("matches")
    .select("period_state")
    .eq("id", matchId)
    .maybeSingle<{
      period_state:
        | "pre"
        | "first_half"
        | "halftime"
        | "second_half"
        | "ended";
    }>();

  if (!match) return false;

  const isAdmin = await isAdminAuthorized();
  if (match.period_state === "ended") return isAdmin;
  return true;
}

export async function addGoalDetailed(
  matchId: string,
  teamSide: "A" | "B",
  channelSlug: string,
  channelVersion: number,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { error: "env_missing" };

  const canMutate = await canMutateGoals(channelSlug, matchId, "add");
  if (!canMutate) return { error: "forbidden" };

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
      period_state:
        | "pre"
        | "first_half"
        | "halftime"
        | "second_half"
        | "ended";
      first_half_started_at: string | null;
      second_half_started_at: string | null;
    }>();

  if (!match) return { error: "not_found" };

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
    return { error: "goal_insert_failed" };
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
    return { error: "goal_recount_failed" };
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
      started_at:
        match.status === "scheduled" ? now.toISOString() : undefined,
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
    return { error: "score_update_failed" };
  }

  await logMatchChange(matchId, channelSlug, "goal_add", {
    teamSide,
    minute,
  });

  return { success: true };
}

export async function applyPeriodAction(
  matchId: string,
  channelSlug: string,
  channelVersion: number,
  action: "start_period" | "end_period" | "resume_previous",
): Promise<ActionResult> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { error: "env_missing" };

  const permission = await getChannelPermission(channelSlug);
  if (!permission.canManageMatch) return { error: "forbidden" };

  const { data: match } = await supabase
    .from("matches")
    .select(
      "id,period_state,status,started_at,first_half_started_at,first_half_ended_at,halftime_started_at,second_half_started_at,second_half_ended_at,period_count",
    )
    .eq("id", matchId)
    .maybeSingle<{
      id: string;
      period_state:
        | "pre"
        | "first_half"
        | "halftime"
        | "second_half"
        | "ended";
      status: "scheduled" | "live" | "ended";
      started_at: string | null;
      first_half_started_at: string | null;
      first_half_ended_at: string | null;
      halftime_started_at: string | null;
      second_half_started_at: string | null;
      second_half_ended_at: string | null;
      period_count: number;
    }>();

  if (!match) return { error: "not_found" };

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
    return { error: "periods_not_ready" };
  }

  const livePeriod = periods.find((p) => p.status === "live") ?? null;
  const nextPending = periods.find((p) => p.status === "pending") ?? null;
  const endedPeriods = periods.filter((p) => p.status === "ended");
  const lastEndedPeriod = endedPeriods[endedPeriods.length - 1] ?? null;

  const now = new Date().toISOString();
  const patch: Record<string, string | null> = {};

  if (action === "start_period") {
    if (livePeriod || !nextPending) {
      return { error: "invalid_period_action" };
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
      return { error: "invalid_period_action" };
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
      return { error: "invalid_period_action" };
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
    return { error: "invalid_period_action" };
  }

  await supabase.from("matches").update(patch).eq("id", matchId);
  await logMatchChange(matchId, channelSlug, "period_action", {
    action,
    patch,
  });

  return { success: true };
}

export async function updateGoalEvent(
  matchId: string,
  goalId: string,
  channelSlug: string,
  channelVersion: number,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { error: "env_missing" };

  const canMutate = await canMutateGoals(channelSlug, matchId, "edit");
  if (!canMutate) return { error: "forbidden" };

  const scorerRaw = String(formData.get("scorer") || "").trim();
  const assistRaw = String(formData.get("assist") || "").trim();
  const minuteRaw = String(formData.get("minute") || "").trim();
  const minute =
    minuteRaw === "" ? null : Math.max(0, Number(minuteRaw) || 0);

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
  const scorer = {
    ...scorerParsed,
    name: normalizeStoredName(scorerParsed.name),
  };
  const assist = {
    ...assistParsed,
    name: normalizeStoredName(assistParsed.name),
  };

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

  return { success: true };
}

export async function deleteGoalEvent(
  matchId: string,
  goalId: string,
  teamSide: "A" | "B",
  channelSlug: string,
  channelVersion: number,
): Promise<ActionResult> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { error: "env_missing" };

  const canMutate = await canMutateGoals(channelSlug, matchId, "edit");
  if (!canMutate) return { error: "forbidden" };

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
      teamSide === "A"
        ? Math.max(0, (match.score_a ?? 0) - 1)
        : match.score_a;
    const nextB =
      teamSide === "B"
        ? Math.max(0, (match.score_b ?? 0) - 1)
        : match.score_b;
    await supabase
      .from("matches")
      .update({ score_a: nextA, score_b: nextB })
      .eq("id", matchId);
  }

  await logMatchChange(matchId, channelSlug, "goal_delete", {
    goalId,
    teamSide,
  });

  return { success: true };
}

export async function updateGoalEventFromForm(
  matchId: string,
  channelSlug: string,
  channelVersion: number,
  formData: FormData,
): Promise<ActionResult> {
  const goalId = String(formData.get("goalId") || "").trim();
  if (!goalId) return { error: "missing_goal_id" };
  return updateGoalEvent(matchId, goalId, channelSlug, channelVersion, formData);
}

export async function deleteGoalEventFromForm(
  matchId: string,
  channelSlug: string,
  channelVersion: number,
  formData: FormData,
): Promise<ActionResult> {
  const goalId = String(formData.get("goalId") || "").trim();
  const teamSide = String(formData.get("teamSide") || "") as "A" | "B";
  if (!goalId || (teamSide !== "A" && teamSide !== "B"))
    return { error: "invalid_params" };
  return deleteGoalEvent(matchId, goalId, teamSide, channelSlug, channelVersion);
}

export async function submitAnonymousRating(
  matchId: string,
  channelSlug: string,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { error: "env_missing" };

  const account = await getAccountInfo(channelSlug);
  if (
    !account ||
    (account.role !== "player" && account.role !== "manager") ||
    !account.teamId
  ) {
    return { error: "rating_forbidden" };
  }

  const targetPlayerId = String(
    formData.get("target_player_id") || "",
  ).trim();
  const ratingRaw = Number(formData.get("rating") || 0);
  const rating = Number(ratingRaw.toFixed(1));
  const isHalfStep =
    Number.isFinite(rating) && Number((rating * 10) % 5) === 0;
  if (
    !targetPlayerId ||
    !Number.isFinite(rating) ||
    rating < 1 ||
    rating > 5 ||
    !isHalfStep
  ) {
    return { error: "rating_invalid" };
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
    return { error: "rating_closed" };
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
    return { error: "rating_forbidden" };
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
    return { error: "rating_forbidden" };
  }
  if (targetPlayer.team_id === ownTeam.id) {
    return { error: "rating_same_team" };
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

  return { success: true };
}

export async function addSubstitutionEvent(
  matchId: string,
  channelSlug: string,
  formData: FormData,
): Promise<ActionResult & { undoIds?: string }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { error: "env_missing" };

  const canMutate = await canMutateParticipation(channelSlug, matchId);
  if (!canMutate) {
    return { error: "forbidden" };
  }

  const { data: stateRow } = await supabase
    .from("matches")
    .select("period_state")
    .eq("id", matchId)
    .maybeSingle<{
      period_state:
        | "pre"
        | "first_half"
        | "halftime"
        | "second_half"
        | "ended";
    }>();
  if (stateRow?.period_state === "ended") {
    return { error: "participation_closed" };
  }

  const teamSide = String(formData.get("team_side") || "").trim() as
    | "A"
    | "B";
  const minute = Number(formData.get("minute") || 0);
  const reservationMode = String(
    formData.get("reservation_mode") || "now",
  ).trim();
  const reservationPeriodId = String(
    formData.get("reservation_period_id") || "",
  ).trim();
  const playerOutValue = String(
    formData.get("player_out_value") || "",
  ).trim();
  const playerInValue = String(formData.get("player_in_value") || "").trim();

  if (teamSide !== "A" && teamSide !== "B") {
    return { error: "participation_invalid" };
  }
  if (!Number.isFinite(minute) || minute < 0 || minute > 200) {
    return { error: "participation_minute" };
  }
  if (!playerOutValue || !playerInValue) {
    return { error: "participation_player" };
  }

  const [outIdRaw, outDisplayRaw] = playerOutValue.split("|");
  const [inIdRaw, inDisplayRaw] = playerInValue.split("|");
  const outId = outIdRaw?.trim() || null;
  const inId = inIdRaw?.trim() || null;
  const outName = (outDisplayRaw?.trim() || "").replace(/^#\d+\s*/, "");
  const inName = (inDisplayRaw?.trim() || "").replace(/^#\d+\s*/, "");

  if (outId && inId && outId === inId) {
    return { error: "participation_same_player" };
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
      return { error: "participation_reserve_period" };
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
      const reservedIds = new Set(
        [row.player_out_id, row.player_in_id].filter(Boolean),
      );
      return (
        (outId ? reservedIds.has(outId) : false) ||
        (inId ? reservedIds.has(inId) : false)
      );
    });

    if (hasDuplicate) {
      return { error: "participation_reserve_duplicate" };
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

    await logMatchChange(
      matchId,
      channelSlug,
      "participation_substitution_reserve",
      {
        teamSide,
        period_sequence: targetSequence,
        minute,
        outId,
        outName,
        inId,
        inName,
      },
    );

    return { success: true };
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
      period_sequence:
        livePeriodForSub?.sequence ??
        (stateRow?.period_state === "second_half" ? 2 : 1),
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

  await logMatchChange(
    matchId,
    channelSlug,
    "participation_substitution_add",
    {
      teamSide,
      minute,
      outId,
      outName,
      inId,
      inName,
    },
  );

  const undoIds = insertedSub?.id ? `sub:${insertedSub.id}` : "";
  return { success: true, undoIds };
}

export async function undoSubstitutionEvent(
  matchId: string,
  channelSlug: string,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { error: "env_missing" };

  const canMutate = await canMutateParticipation(channelSlug, matchId);
  if (!canMutate) {
    return { error: "forbidden" };
  }

  const undoIdsRaw = String(formData.get("undo_ids") || "").trim();
  const undoUntil = Number(formData.get("undo_until") || 0);
  if (!undoIdsRaw || !Number.isFinite(undoUntil) || Date.now() > undoUntil) {
    return { error: "undo_expired" };
  }

  const rawIds = undoIdsRaw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (rawIds.length === 0) {
    return { error: "undo_expired" };
  }

  const subIds = rawIds
    .filter((v) => v.startsWith("sub:"))
    .map((v) => v.slice(4))
    .filter(Boolean);

  if (subIds.length === 0) {
    return { error: "undo_expired" };
  }

  await supabase
    .from("match_substitutions")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", subIds)
    .eq("match_id", matchId)
    .is("deleted_at", null);

  await logMatchChange(
    matchId,
    channelSlug,
    "participation_substitution_undo",
    { subIds },
  );

  return { success: true };
}

export async function cancelReservedSubstitution(
  matchId: string,
  channelSlug: string,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { error: "env_missing" };

  const canMutate = await canMutateParticipation(channelSlug, matchId);
  if (!canMutate) {
    return { error: "forbidden" };
  }

  const reservationId = String(
    formData.get("reservation_id") || "",
  ).trim();
  if (!reservationId) {
    return { error: "participation_reserve_cancel" };
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
    return { error: "participation_reserve_cancel" };
  }

  const { data: periodRow } = await supabase
    .from("match_periods")
    .select("status")
    .eq("match_id", matchId)
    .eq("sequence", reservation.period_sequence)
    .is("deleted_at", null)
    .maybeSingle<{ status: "pending" | "live" | "ended" }>();

  if (!periodRow || periodRow.status !== "pending") {
    return { error: "participation_reserve_cancel" };
  }

  await supabase
    .from("match_period_substitution_plans")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", reservationId)
    .eq("match_id", matchId)
    .is("deleted_at", null)
    .is("applied_at", null);

  await logMatchChange(
    matchId,
    channelSlug,
    "participation_substitution_reserve_cancel",
    { reservationId },
  );

  return { success: true };
}
