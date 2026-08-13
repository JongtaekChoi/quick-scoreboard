export const LOCAL_MATCH_SCHEMA_VERSION = 1 as const;

export type TeamSide = "A" | "B";

type MatchEventBase = {
  id: string;
  sequence: number;
  occurredAt: string;
  periodSequence: number | null;
};

export type PeriodStartedEvent = MatchEventBase & {
  type: "period_started";
  payload: {
    label?: string;
  };
};

export type PeriodEndedEvent = MatchEventBase & {
  type: "period_ended";
  payload: Record<string, never>;
};

export type GoalAddedEvent = MatchEventBase & {
  type: "goal_added";
  payload: {
    teamSide: TeamSide;
    minute: number | null;
    scorerPlayerId: string | null;
    scorerName: string | null;
    assistPlayerId: string | null;
    assistName: string | null;
  };
};

export type GoalRemovedEvent = MatchEventBase & {
  type: "goal_removed";
  payload: {
    goalEventId: string;
  };
};

export type GoalUpdatedEvent = MatchEventBase & {
  type: "goal_updated";
  payload: {
    goalEventId: string;
    minute?: number | null;
    scorerPlayerId?: string | null;
    scorerName?: string | null;
    assistPlayerId?: string | null;
    assistName?: string | null;
  };
};

export type SubstitutionAddedEvent = MatchEventBase & {
  type: "substitution_added";
  payload: {
    teamSide: TeamSide;
    minute: number;
    playerOutId: string | null;
    playerOutName: string | null;
    playerInId: string | null;
    playerInName: string | null;
  };
};

export type LocalMatchEvent =
  | PeriodStartedEvent
  | PeriodEndedEvent
  | GoalAddedEvent
  | GoalRemovedEvent
  | GoalUpdatedEvent
  | SubstitutionAddedEvent;

export type LocalMatchSessionStatus =
  | "recording"
  | "pending_sync"
  | "synced";

export type LocalMatchSession = {
  schemaVersion: typeof LOCAL_MATCH_SCHEMA_VERSION;
  sessionId: string;
  matchId: string;
  baseRevision: string | null;
  deviceId: string;
  status: LocalMatchSessionStatus;
  startedAt: string;
  endedAt: string | null;
  updatedAt: string;
  events: LocalMatchEvent[];
};

export type RecordedGoal = GoalAddedEvent["payload"] & {
  id: string;
  occurredAt: string;
  periodSequence: number | null;
};

export type MatchRecordingState = {
  scoreA: number;
  scoreB: number;
  goals: RecordedGoal[];
  livePeriodSequence: number | null;
};

const EMPTY_RECORDING_STATE: MatchRecordingState = {
  scoreA: 0,
  scoreB: 0,
  goals: [],
  livePeriodSequence: null,
};

function applyEvent(
  state: MatchRecordingState,
  event: LocalMatchEvent,
): MatchRecordingState {
  switch (event.type) {
    case "period_started":
      return {
        ...state,
        livePeriodSequence: event.periodSequence,
      };

    case "period_ended":
      return {
        ...state,
        livePeriodSequence: null,
      };

    case "goal_added": {
      if (state.goals.some((goal) => goal.id === event.id)) return state;

      const goal: RecordedGoal = {
        id: event.id,
        occurredAt: event.occurredAt,
        periodSequence: event.periodSequence,
        ...event.payload,
      };

      return {
        ...state,
        scoreA: state.scoreA + (goal.teamSide === "A" ? 1 : 0),
        scoreB: state.scoreB + (goal.teamSide === "B" ? 1 : 0),
        goals: [...state.goals, goal],
      };
    }

    case "goal_removed": {
      const goal = state.goals.find(
        (candidate) => candidate.id === event.payload.goalEventId,
      );
      if (!goal) return state;

      return {
        ...state,
        scoreA: Math.max(0, state.scoreA - (goal.teamSide === "A" ? 1 : 0)),
        scoreB: Math.max(0, state.scoreB - (goal.teamSide === "B" ? 1 : 0)),
        goals: state.goals.filter(
          (candidate) => candidate.id !== event.payload.goalEventId,
        ),
      };
    }

    case "goal_updated":
      return {
        ...state,
        goals: state.goals.map((goal) =>
          goal.id === event.payload.goalEventId
            ? {
                ...goal,
                ...(event.payload.minute !== undefined
                  ? { minute: event.payload.minute }
                  : {}),
                ...(event.payload.scorerPlayerId !== undefined
                  ? { scorerPlayerId: event.payload.scorerPlayerId }
                  : {}),
                ...(event.payload.scorerName !== undefined
                  ? { scorerName: event.payload.scorerName }
                  : {}),
                ...(event.payload.assistPlayerId !== undefined
                  ? { assistPlayerId: event.payload.assistPlayerId }
                  : {}),
                ...(event.payload.assistName !== undefined
                  ? { assistName: event.payload.assistName }
                  : {}),
              }
            : goal,
        ),
      };

    case "substitution_added":
      return state;
  }
}

export function deriveMatchRecordingState(
  events: readonly LocalMatchEvent[],
): MatchRecordingState {
  const orderedEvents = [...events].sort((a, b) => {
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
    return a.occurredAt.localeCompare(b.occurredAt);
  });

  return orderedEvents.reduce(applyEvent, EMPTY_RECORDING_STATE);
}

export function appendMatchEvent(
  session: LocalMatchSession,
  event: LocalMatchEvent,
): LocalMatchSession {
  if (session.status === "synced") {
    throw new Error("cannot_append_to_synced_session");
  }

  if (session.events.some((candidate) => candidate.id === event.id)) {
    return session;
  }

  return {
    ...session,
    updatedAt: event.occurredAt,
    events: [...session.events, event],
  };
}

export function createLocalMatchSession(input: {
  sessionId: string;
  matchId: string;
  deviceId: string;
  baseRevision?: string | null;
  now?: string;
}): LocalMatchSession {
  const now = input.now ?? new Date().toISOString();

  return {
    schemaVersion: LOCAL_MATCH_SCHEMA_VERSION,
    sessionId: input.sessionId,
    matchId: input.matchId,
    baseRevision: input.baseRevision ?? null,
    deviceId: input.deviceId,
    status: "recording",
    startedAt: now,
    endedAt: null,
    updatedAt: now,
    events: [],
  };
}
