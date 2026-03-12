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
import LiveScoreboard from "./LiveScoreboard";
import ShareButton from "@/components/ShareButton";
import AccountBadge from "@/components/AccountBadge";
import Breadcrumb from "@/components/Breadcrumb";
import StarRatingInput from "@/components/StarRatingInput";
import SubstitutionActions from "./SubstitutionActions";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import { summarizeLegacyPeriodControl, type MatchPeriodRow } from "@/lib/matchPeriods";

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
  minute: number | null;
  scorer_name: string | null;
  scorer_player_id: string | null;
  assist_name: string | null;
  assist_player_id: string | null;
  created_at: string;
};

type ParticipationEvent = {
  id: string;
  team_side: "A" | "B";
  player_id: string | null;
  player_name: string | null;
  event_type: "in" | "out";
  minute: number;
  is_starter: boolean;
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
  action:
    | "start_first"
    | "end_first"
    | "start_second"
    | "end_match"
    | "resume_previous",
) {
  "use server";

  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  const permission = await getChannelPermission(channelSlug);
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

  if (
    action === "end_match" &&
    (match.period_state === "second_half" ||
      match.period_state === "first_half" ||
      match.period_state === "halftime")
  ) {
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
  redirect(`/m/${matchId}?mode=edit`);
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
  if (stateRow?.period_state === "pre" || stateRow?.period_state === "ended") {
    redirect(`/m/${matchId}?mode=edit&err=participation_closed`);
  }

  const teamSide = String(formData.get("team_side") || "").trim() as "A" | "B";
  const minute = Number(formData.get("minute") || 0);
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

  const { data: inserted } = await supabase
    .from("match_participation_events")
    .insert([
      {
        match_id: matchId,
        team_side: teamSide,
        player_id: outId || null,
        player_name: outName || null,
        event_type: "out",
        minute,
        is_starter: false,
      },
      {
        match_id: matchId,
        team_side: teamSide,
        player_id: inId || null,
        player_name: inName || null,
        event_type: "in",
        minute,
        is_starter: false,
      },
    ])
    .select("id");

  await logMatchChange(matchId, channelSlug, "participation_substitution_add", {
    teamSide,
    minute,
    outId,
    outName,
    inId,
    inName,
  });

  revalidatePath(`/m/${matchId}`);
  const undoIds = `${inserted?.[0]?.id ?? ""},${inserted?.[1]?.id ?? ""}`;
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

  const ids = undoIdsRaw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    redirect(`/m/${matchId}?mode=edit&err=undo_expired`);
  }

  await supabase
    .from("match_participation_events")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", ids)
    .eq("match_id", matchId)
    .is("deleted_at", null);

  await logMatchChange(
    matchId,
    channelSlug,
    "participation_substitution_undo",
    { ids },
  );

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
    undo?: string;
    undo_until?: string;
  }>;
}) {
  const { matchId } = await params;
  const { goal: goalParam, err, mode, undo, undo_until } = await searchParams;
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
      "id,team_side,period,minute,scorer_name,scorer_player_id,assist_name,assist_player_id,created_at",
    )
    .eq("match_id", matchId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .returns<GoalEvent[]>();

  const { data: participationEvents } = await supabase
    .from("match_participation_events")
    .select(
      "id,team_side,player_id,player_name,event_type,minute,is_starter,created_at",
    )
    .eq("match_id", matchId)
    .is("deleted_at", null)
    .order("minute", { ascending: false })
    .order("created_at", { ascending: false })
    .returns<ParticipationEvent[]>();

  const starterEventsA = (participationEvents ?? []).filter(
    (e) => e.team_side === "A" && e.is_starter,
  );
  const starterEventsB = (participationEvents ?? []).filter(
    (e) => e.team_side === "B" && e.is_starter,
  );
  const startingCountA = new Set(
    starterEventsA.map((e) => e.player_id || `name:${e.player_name ?? ""}`),
  ).size;
  const startingCountB = new Set(
    starterEventsB.map((e) => e.player_id || `name:${e.player_name ?? ""}`),
  ).size;
  const starterKeySetA = new Set(
    starterEventsA.map((e) => e.player_id || `name:${e.player_name ?? ""}`),
  );
  const starterKeySetB = new Set(
    starterEventsB.map((e) => e.player_id || `name:${e.player_name ?? ""}`),
  );
  const isLivePeriod =
    match.period_state === "first_half" ||
    match.period_state === "halftime" ||
    match.period_state === "second_half" ||
    match.period_state === "ended";

  const sideEventsA = (participationEvents ?? []).filter(
    (e) => e.team_side === "A",
  );
  const sideEventsB = (participationEvents ?? []).filter(
    (e) => e.team_side === "B",
  );
  const calcActiveKeys = (events: ParticipationEvent[]) => {
    const bal = new Map<string, number>();
    for (const e of events) {
      const key = e.player_id || `name:${e.player_name ?? ""}`;
      bal.set(key, (bal.get(key) ?? 0) + (e.event_type === "in" ? 1 : -1));
    }
    return new Set(
      Array.from(bal.entries())
        .filter(([, v]) => v > 0)
        .map(([k]) => k),
    );
  };
  const activeKeysA = calcActiveKeys(sideEventsA);
  const activeKeysB = calcActiveKeys(sideEventsB);

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
  const startFirstAction = channel
    ? applyPeriodAction.bind(
        null,
        matchId,
        channel.slug,
        channel.edit_session_version,
        "start_first",
      )
    : async () => {};
  const endFirstAction = channel
    ? applyPeriodAction.bind(
        null,
        matchId,
        channel.slug,
        channel.edit_session_version,
        "end_first",
      )
    : async () => {};
  const startSecondAction = channel
    ? applyPeriodAction.bind(
        null,
        matchId,
        channel.slug,
        channel.edit_session_version,
        "start_second",
      )
    : async () => {};
  const endMatchAction = channel
    ? applyPeriodAction.bind(
        null,
        matchId,
        channel.slug,
        channel.edit_session_version,
        "end_match",
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
              <span>최근 교체를 취소할 수 있어.</span>
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
            minute: g.minute,
            scorer_name: g.scorer_name,
            assist_name: g.assist_name,
            created_at: g.created_at,
          }))}
          participationEvents={(participationEvents ?? [])
            .filter((e) => !e.is_starter)
            .map((e) => ({
              id: e.id,
              minute: e.minute,
              team_side: e.team_side,
              event_type: e.event_type,
              player_label:
                (e.player_id ? playerLabelById.get(e.player_id) : undefined) ??
                e.player_name ??
                "선수",
              created_at: e.created_at,
            }))}
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
              />
            ) : null}

            {canManageMatch ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-gray-500">
                  현재:{" "}
                  {periodControlSummary.statusLabel}
                  {elapsedMinutes !== null ? ` · ${elapsedMinutes}분` : ""}
                </span>
                {match.period_state === "pre" ? (
                  <form action={startFirstAction}>
                    <PendingSubmitButton
                      className="rounded border px-2 py-1"
                      pendingText="처리중..."
                      confirmMessage="경기를 시작하시겠습니까? 시작 후에는 되돌릴 수 없습니다."
                    >
                      {periodControlSummary.primaryActionLabel ?? "1P 시작"}
                    </PendingSubmitButton>
                  </form>
                ) : null}
                {match.period_state === "first_half" ? (
                  <form action={endFirstAction}>
                    <PendingSubmitButton
                      className="rounded border px-2 py-1"
                      pendingText="처리중..."
                    >
                      {periodControlSummary.primaryActionLabel ?? "1P 종료"}
                    </PendingSubmitButton>
                  </form>
                ) : null}
                {match.period_state === "halftime" ? (
                  <form action={startSecondAction}>
                    <PendingSubmitButton
                      className="rounded border px-2 py-1"
                      pendingText="처리중..."
                    >
                      {periodControlSummary.primaryActionLabel ?? "2P 시작"}
                    </PendingSubmitButton>
                  </form>
                ) : null}
                {match.period_state === "second_half" ? (
                  <form action={endMatchAction}>
                    <PendingSubmitButton
                      className="rounded border px-2 py-1"
                      pendingText="처리중..."
                      confirmMessage="경기를 종료하시겠습니까? 종료 후에는 되돌릴 수 없습니다."
                    >
                      경기 종료
                    </PendingSubmitButton>
                  </form>
                ) : null}
                {match.period_state === "halftime" ||
                match.period_state === "second_half" ? (
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
                    const isStarting = starterKeySetA.has(p.playerId);
                    return (
                      <div
                        key={p.value}
                        className={
                          onPitch
                            ? "text-green-700 font-medium"
                            : "text-gray-700"
                        }
                      >
                        #{p.jerseyNo} {p.playerName}{" "}
                        {isStarting ? "(선발)" : ""}
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
                    const isStarting = starterKeySetB.has(p.playerId);
                    return (
                      <div
                        key={p.value}
                        className={
                          onPitch
                            ? "text-green-700 font-medium"
                            : "text-gray-700"
                        }
                      >
                        #{p.jerseyNo} {p.playerName}{" "}
                        {isStarting ? "(선발)" : ""}
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
                  {(participationEvents ?? []).length}건
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
                      disabled={match.period_state === "pre" || match.period_state === "ended"}
                      periodState={match.period_state}
                      firstHalfStartedAt={match.first_half_started_at}
                      secondHalfStartedAt={match.second_half_started_at}
                      firstHalfEndedAt={match.first_half_ended_at}
                    />
                  </div>

                <div className="text-xs text-gray-500">교체 이벤트는 상단 스코어보드에서 확인해줘.</div>
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
                const findRosterValue = (
                  playerId: string | null,
                  playerName: string | null,
                ) => {
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
                const scorerDefault = findRosterValue(
                  activeGoal.scorer_player_id,
                  activeGoal.scorer_name,
                );
                const assistDefault = findRosterValue(
                  activeGoal.assist_player_id,
                  activeGoal.assist_name,
                );
                return (
                  <>
                    <div className="flex items-center justify-between gap-2 text-sm text-gray-700">
                      <span>
                        {activeGoal.team_side}팀 ·{" "}
                        {activeGoal.minute !== null
                          ? `${activeGoal.minute}분`
                          : "시간 미설정"}
                      </span>
                      <Link
                        href={`/m/${matchId}?mode=edit`}
                        className="text-xs underline text-gray-500"
                      >
                        선택 해제
                      </Link>
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
