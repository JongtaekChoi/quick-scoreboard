import type { MatchPeriodRow, PeriodControlSummary } from "@/lib/matchPeriods";

export type Match = {
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

export type Channel = {
  id: string;
  slug: string;
  name: string;
  edit_session_version: number;
};

export type MatchGroup = {
  id: string;
  play_date: string;
  venue: string | null;
  title: string | null;
  seq: number;
};

export type GoalEvent = {
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

export type MatchPeriodLineup = {
  match_period_id: string;
  team_side: "A" | "B";
  player_id: string | null;
  player_name: string | null;
};

export type ReservedSubstitutionPlan = {
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

export type MatchSubstitution = {
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

export type Alias = { jersey_no: string | null; player_name: string | null };

export type PlayerRatingAgg = {
  target_player_id: string;
  avg_rating: number;
  rating_count: number;
};

export type RosterPlayer = {
  playerId: string;
  jerseyNo: string;
  playerName: string;
  value: string;
};

export type GoalPermission = { canGoalEdit: boolean; canManageMatch: boolean };

export type ChangeActor = { loginId: string | null; role: string | null };

export type MatchPermissions = {
  canGoalEdit: boolean;
  canManageMatch: boolean;
  canEditThisMatch: boolean;
  isAdmin: boolean;
  isLoggedIn: boolean;
  accountLoginId: string | null;
  accountRole: string | null;
  accountTeamId: string | null;
};

export type PeriodStarterSummary = {
  id: string;
  period_sequence: number;
  label: string;
  startMinute: number;
  teamA: string;
  teamB: string;
};

export type SubstitutionEventDisplay = {
  id: string;
  period_sequence: number;
  minute: number;
  team_side: "A" | "B";
  player_out_label: string;
  player_in_label: string;
  created_at: string;
};

export type ReservablePeriod = {
  id: string;
  sequence: number;
  label: string;
};

export type MatchDetailPayload = {
  match: Match;
  channel: Channel | null;
  group: MatchGroup | null;
  goals: GoalEvent[];
  matchPeriods: MatchPeriodRow[];
  matchSubstitutions: MatchSubstitution[];
  periodLineups: MatchPeriodLineup[];
  reservedSubPlans: ReservedSubstitutionPlan[];
  aliases: Alias[];
  rosterA: RosterPlayer[];
  rosterB: RosterPlayer[];
  teamAId: string | null;
  teamBId: string | null;
  ratingAggs: PlayerRatingAgg[];
  myRatings: { target_player_id: string; rating: number }[];
  permissions: MatchPermissions;
  periodControlSummary: PeriodControlSummary;
};
