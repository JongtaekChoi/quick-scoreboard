import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { validateManagerAgainstDb, getAccountInfo } from "@/lib/channelSession";
import { isAdminAuthorized } from "@/lib/adminAuth";
import { autoStartDueMatches } from "@/lib/matchSchedule";
import { summarizeLegacyPeriodControl } from "@/lib/matchPeriods";
import type { MatchPeriodRow } from "@/lib/matchPeriods";
import type {
  Match,
  Channel,
  MatchGroup,
  GoalEvent,
  MatchSubstitution,
  MatchPeriodLineup,
  ReservedSubstitutionPlan,
  Alias,
  RosterPlayer,
  MatchPermissions,
  MatchDetailPayload,
  PlayerRatingAgg,
} from "@/app/m/[matchId]/types";

async function getChannelPermission(
  channelSlug: string,
): Promise<{ canGoalEdit: boolean; canManageMatch: boolean }> {
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

const DETAIL_TTL_SECONDS = 5;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ matchId: string }> },
) {
  const { matchId } = await params;
  const supabase = getSupabaseServerClient();
  if (!supabase)
    return NextResponse.json({ error: "env_missing" }, { status: 500 });

  await autoStartDueMatches(supabase, matchId);

  const { data: match } = await supabase
    .from("matches")
    .select(
      "id,seq,team_a_name,team_b_name,score_a,score_b,status,scheduled_start_at,started_at,channel_id,match_group_id,period_state,first_half_started_at,first_half_ended_at,halftime_started_at,second_half_started_at,second_half_ended_at,period_count",
    )
    .eq("id", matchId)
    .maybeSingle<Match>();

  if (!match)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: matchPeriods } = await supabase
    .from("match_periods")
    .select("id,sequence,period_code,label,status")
    .eq("match_id", match.id)
    .is("deleted_at", null)
    .order("sequence", { ascending: true })
    .returns<MatchPeriodRow[]>();

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

  let rosterA: RosterPlayer[] = [];
  let rosterB: RosterPlayer[] = [];
  let teamAId: string | null = null;
  let teamBId: string | null = null;

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

    teamAId = teamARow?.id ?? null;
    teamBId = teamBRow?.id ?? null;

    const buildRoster = (tId: string | null): RosterPlayer[] => {
      if (!tId) return [];
      const players: RosterPlayer[] = [];
      for (const e of entries ?? []) {
        if (e.team_id === tId && e.team_players) {
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
        if (g.team_id === tId) {
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

  const [
    { data: goals },
    { data: matchSubstitutions },
    { data: periodLineups },
    { data: reservedSubPlans },
    { data: aliases },
    { data: ratingAggRows },
  ] = await Promise.all([
    supabase
      .from("goal_events")
      .select(
        "id,team_side,period,period_sequence,match_period_id,minute,scorer_name,scorer_player_id,assist_name,assist_player_id,created_at",
      )
      .eq("match_id", matchId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .returns<GoalEvent[]>(),
    supabase
      .from("match_substitutions")
      .select(
        "id,period_sequence,match_period_id,minute,team_side,player_out_id,player_out_name,player_in_id,player_in_name,created_at",
      )
      .eq("match_id", matchId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .returns<MatchSubstitution[]>(),
    supabase
      .from("match_period_lineups")
      .select("match_period_id,team_side,player_id,player_name")
      .eq("match_id", matchId)
      .is("deleted_at", null)
      .returns<MatchPeriodLineup[]>(),
    supabase
      .from("match_period_substitution_plans")
      .select(
        "id,team_side,match_period_id,period_sequence,player_out_id,player_out_name,player_in_id,player_in_name,planned_minute",
      )
      .eq("match_id", matchId)
      .is("deleted_at", null)
      .is("applied_at", null)
      .returns<ReservedSubstitutionPlan[]>(),
    supabase
      .from("match_player_aliases")
      .select("jersey_no,player_name")
      .eq("match_id", matchId)
      .order("last_used_at", { ascending: false })
      .limit(50)
      .returns<Alias[]>(),
    supabase
      .from("player_ratings")
      .select("target_player_id,rating")
      .eq("match_id", matchId)
      .returns<{ target_player_id: string; rating: number }[]>(),
  ]);

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

  let myRatings: { target_player_id: string; rating: number }[] = [];
  const ratingAccount = channel ? await getAccountInfo(channel.slug) : null;
  if (ratingAccount && channel) {
    const fingerprintSalt =
      process.env.SESSION_SECRET || "qsb-rating-fallback-salt";
    const raterFingerprint = createHash("sha256")
      .update(`${fingerprintSalt}|${channel.slug}|${ratingAccount.loginId}`)
      .digest("hex");

    const { data: myRatingRows } = await supabase
      .from("player_ratings")
      .select("target_player_id,rating")
      .eq("match_id", matchId)
      .eq("rater_fingerprint", raterFingerprint)
      .returns<{ target_player_id: string; rating: number }[]>();

    myRatings = myRatingRows ?? [];
  }

  const permission = channel
    ? await getChannelPermission(channel.slug)
    : { canGoalEdit: false, canManageMatch: false };
  const editThisMatch = channel
    ? await canAccountEditThisMatch(channel.slug, matchId)
    : false;
  const accountSession = channel ? await getAccountInfo(channel.slug) : null;
  const isAdmin = await isAdminAuthorized();

  const permissions: MatchPermissions = {
    canGoalEdit: permission.canGoalEdit && editThisMatch,
    canManageMatch: permission.canManageMatch,
    canEditThisMatch: editThisMatch,
    isAdmin,
    isLoggedIn: !!accountSession,
    accountLoginId: accountSession?.loginId ?? null,
    accountRole: accountSession?.role ?? null,
    accountTeamId: accountSession?.teamId ?? null,
  };

  const periodControlSummary = summarizeLegacyPeriodControl({
    periodCount: match.period_count,
    periodState: match.period_state,
    periods: matchPeriods ?? [],
  });

  const body: MatchDetailPayload = {
    match,
    channel,
    group,
    goals: goals ?? [],
    matchPeriods: matchPeriods ?? [],
    matchSubstitutions: matchSubstitutions ?? [],
    periodLineups: periodLineups ?? [],
    reservedSubPlans: reservedSubPlans ?? [],
    aliases: aliases ?? [],
    rosterA,
    rosterB,
    teamAId,
    teamBId,
    ratingAggs: Array.from(ratingMap.values()),
    myRatings,
    permissions,
    periodControlSummary,
  };

  const etag = `W/"${createHash("sha1").update(JSON.stringify(body)).digest("hex")}"`;

  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": `public, max-age=0, s-maxage=${DETAIL_TTL_SECONDS}, stale-while-revalidate=5`,
      },
    });
  }

  return NextResponse.json(body, {
    headers: {
      ETag: etag,
      "Cache-Control": `public, max-age=0, s-maxage=${DETAIL_TTL_SECONDS}, stale-while-revalidate=5`,
    },
  });
}
