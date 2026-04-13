"use client";

import { useEffect, useState, useTransition } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";

type Goal = {
  id: string;
  team_side: "A" | "B";
  period_sequence?: number | null;
  minute: number | null;
  scorer_name: string | null;
  assist_name: string | null;
  created_at: string;
};

type SubstitutionEvent = {
  id: string;
  period_sequence: number;
  minute: number;
  team_side: "A" | "B";
  player_out_label: string;
  player_in_label: string;
  created_at: string;
};

type Replacement = {
  id: string;
  period_sequence: number;
  minute: number;
  team_side: "A" | "B";
  text: string;
  created_at: string;
};

type StarterLine = {
  id: string;
  text: string;
  created_at: string;
  minute: number;
  period_sequence: number;
};

type MatchMini = {
  id: string;
  team_a_name: string;
  team_b_name: string;
  score_a: number;
  score_b: number;
};

type PeriodStarterSummary = {
  id: string;
  period_sequence: number;
  label: string;
  teamA: string;
  teamB: string;
  startMinute: number;
};

type ScoreboardPayload = { match: MatchMini; goals: Goal[] };

type OptimisticGoal = {
  id: string;
  team_side: "A" | "B";
  period_sequence?: number | null;
  minute: number | null;
  scorer_name: string | null;
  assist_name: string | null;
  created_at: string;
};

const REFRESH_SEC = 10;

function EventLine({
  event,
  type,
  match,
  readonly,
  onStarterClick,
  activeStarterId,
  selectingGoalId,
  onSelectGoal,
}: {
  event: Goal | Replacement | StarterLine;
  type: "goal" | "replace" | "starter";
  match: MatchMini;
  readonly: boolean;
  onStarterClick?: (id: string) => void;
  activeStarterId?: string | null;
  selectingGoalId?: string | null;
  onSelectGoal?: (id: string) => void;
}) {
  const g = type == "goal" ? (event as Goal) : null;
  const replacement = type == "replace" ? (event as Replacement) : null;
  const starter = type == "starter" ? (event as StarterLine) : null;
  const who = g
    ? (g.scorer_name ??
      (g.team_side === "A" ? match.team_a_name : match.team_b_name))
    : "";
  const assist = g?.assist_name ?? "";
  const active = !readonly && !!g?.id && selectingGoalId === g.id;
  const isSelecting = active;

  if (type === "starter") {
    return (
      <button
        type="button"
        onClick={() => starter && onStarterClick?.(starter.id)}
        className={`w-full text-center text-[11px] text-gray-500 rounded-lg px-2 py-1 ${activeStarterId === starter?.id ? "bg-white ring-1 ring-gray-300" : "bg-transparent"}`}
      >
        ── {starter?.text} ──
      </button>
    );
  }

  const side = (event as Goal | Replacement).team_side;

  return (
    <button
      key={event.id}
      type="button"
      onClick={() => {
        if (readonly || g == null) return;
        onSelectGoal?.(g.id);
        window.dispatchEvent(new CustomEvent('qsb:goal-select', { detail: { id: g.id } }));
      }}
      className={`w-full text-left grid grid-cols-[1fr_auto_1fr] items-center text-xs gap-2 rounded-lg px-2 py-1 ${active ? "bg-white ring-1 ring-gray-300" : "hover:bg-white/70"} ${isSelecting ? "opacity-70" : ""}`}
    >
      <div className="text-right truncate">
        {side === "A" ? (
          g ? (
            <>
              <span>{who}</span>
              {assist ? (
                <span className="text-gray-400"> ({assist})</span>
              ) : null}
            </>
          ) : (
            <span> {replacement?.text}</span>
          )
        ) : (
          ""
        )}
      </div>

      <div className="text-gray-500 tabular-nums">
        {isSelecting
          ? "선택중..."
          : g?.minute !== null && g?.minute !== undefined
            ? `${g.minute}’`
            : replacement?.minute !== null && replacement?.minute !== undefined
              ? `${replacement.minute}’`
              : ""}
      </div>

      <div className="truncate">
        {side === "B" ? (
          g ? (
            <>
              <span>{who}</span>
              {assist ? (
                <span className="text-gray-400"> ({assist})</span>
              ) : null}
            </>
          ) : (
            <span> {replacement?.text}</span>
          )
        ) : (
          ""
        )}
      </div>
    </button>
  );
}

function LiveScoreboardInner({
  matchId,
  initialMatch,
  initialGoals,
  readonly,
  matchStatus,
  substitutionEvents,
  periodStarters,
}: {
  matchId: string;
  initialMatch: MatchMini;
  initialGoals: Goal[];
  readonly: boolean;
  matchStatus: "scheduled" | "live" | "ended";
  substitutionEvents?: SubstitutionEvent[];
  periodStarters?: PeriodStarterSummary[];
}) {
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [selectedStarterId, setSelectedStarterId] = useState<string | null>(null);
  const [selectingGoalId, setSelectingGoalId] = useState<string | null>(null);
  const [optimisticGoals, setOptimisticGoals] = useState<OptimisticGoal[]>([]);
  const [, startTransition] = useTransition();

  const { data, refetch, isFetching } = useQuery({
    queryKey: ["scoreboard", matchId],
    queryFn: async () => {
      const res = await fetch(`/api/matches/${matchId}/scoreboard`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("failed_to_fetch_scoreboard");
      return (await res.json()) as ScoreboardPayload;
    },
    initialData: { match: initialMatch, goals: initialGoals },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval:
      readonly && autoUpdate && matchStatus !== "ended"
        ? REFRESH_SEC * 1000
        : false,
  });

  useEffect(() => {
    const onOptimistic = (evt: Event) => {
      const custom = evt as CustomEvent<{ teamSide?: "A" | "B"; minute?: number; scorerName?: string | null; assistName?: string | null }>;
      const side = custom.detail?.teamSide;
      if (side !== "A" && side !== "B") return;
      const nowIso = new Date().toISOString();
      setOptimisticGoals((prev) => [
        {
          id: `optimistic-${nowIso}-${Math.random().toString(36).slice(2, 7)}`,
          team_side: side,
          minute: Number.isFinite(custom.detail.minute) ? Number(custom.detail.minute) : null,
          period_sequence: Number.isFinite(custom.detail.minute) && Number(custom.detail.minute) >= 15 ? 2 : 1,
          scorer_name: custom.detail.scorerName ?? null,
          assist_name: custom.detail.assistName ?? null,
          created_at: nowIso,
        },
        ...prev,
      ]);
      window.setTimeout(() => {
        void refetch();
      }, 250);
      window.setTimeout(() => {
        setOptimisticGoals([]);
        void refetch();
      }, 1800);
    };

    window.addEventListener("qsb:goal-optimistic", onOptimistic as EventListener);
    return () => window.removeEventListener("qsb:goal-optimistic", onOptimistic as EventListener);
  }, [refetch]);

  const optimisticCountA = optimisticGoals.filter((g) => g.team_side === "A").length;
  const optimisticCountB = optimisticGoals.filter((g) => g.team_side === "B").length;
  const goals = [...optimisticGoals, ...data.goals];
  const match = {
    ...data.match,
    score_a: data.match.score_a + optimisticCountA,
    score_b: data.match.score_b + optimisticCountB,
  };

  const countA = goals.filter((g) => g.team_side === "A").length;
  const countB = goals.filter((g) => g.team_side === "B").length;
  const missingA = Math.max(0, match.score_a - countA);
  const missingB = Math.max(0, match.score_b - countB);

  const displayGoals: Goal[] = [...goals];
  for (let i = 0; i < missingA; i++) {
    displayGoals.push({
      id: `missing-a-${i}`,
      team_side: "A",
      minute: null,
      scorer_name: "(기록없음)",
      assist_name: null,
      created_at: new Date(0).toISOString(),
    });
  }
  for (let i = 0; i < missingB; i++) {
    displayGoals.push({
      id: `missing-b-${i}`,
      team_side: "B",
      minute: null,
      scorer_name: "(기록없음)",
      assist_name: null,
      created_at: new Date(0).toISOString(),
    });
  }

  const groupedParticipation: Replacement[] = (substitutionEvents ?? []).map((sub) => ({
    id: sub.id,
    period_sequence: sub.period_sequence,
    minute: sub.minute,
    team_side: sub.team_side,
    text: `IN ${sub.player_in_label} OUT ${sub.player_out_label}`,
    created_at: sub.created_at,
  }));

  const starterEntries = (periodStarters ?? []).map((p, idx) => ({
    id: `starter-${p.id}-${idx}`,
    text: `${p.label} START`,
    created_at: new Date(0).toISOString(),
    minute: p.startMinute,
    period_sequence: p.period_sequence,
    label: p.label,
    teamA: p.teamA,
    teamB: p.teamB,
  }));

  const starterLines: StarterLine[] = starterEntries.map(({ id, text, created_at, minute, period_sequence }) => ({
    id,
    text,
    created_at,
    minute,
    period_sequence,
  }));

  const selectedStarter = starterEntries.find((p) => p.id === selectedStarterId) ?? null;

  const timeEvents: { type: "goal" | "replace" | "starter"; event: Goal | Replacement | StarterLine }[] =
    (() => {
      const typePriority: Record<"starter" | "goal" | "replace", number> = {
        goal: 0,
        replace: 0,
        starter: 2,
      };
      const withMeta = [
        ...goals.map((goal) => ({ type: "goal" as const, event: goal, period_sequence: goal.period_sequence ?? (goal.minute != null && goal.minute >= 15 ? 2 : 1), minute: goal.minute ?? -1 })),
        ...groupedParticipation.map((replacement) => ({ type: "replace" as const, event: replacement, period_sequence: replacement.period_sequence, minute: replacement.minute })),
        ...starterLines.map((starter) => ({ type: "starter" as const, event: starter, period_sequence: starter.period_sequence, minute: starter.minute })),
      ];

      return withMeta
        .sort((a, b) => {
          if (a.period_sequence !== b.period_sequence) return b.period_sequence - a.period_sequence;
          if (a.minute !== b.minute) return b.minute - a.minute;
          if (a.type !== b.type && (a.type === "starter" || b.type === "starter")) {
            return typePriority[a.type] - typePriority[b.type];
          }
          return new Date(b.event.created_at).getTime() - new Date(a.event.created_at).getTime();
        })
        .map(({ type, event }) => ({ type, event }));
    })();

  return (
    <section className="rounded-xl border border-gray-200 p-4 space-y-3 bg-white shadow-sm md:sticky md:top-2 md:z-10 md:bg-white/95 md:backdrop-blur">
      {readonly ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-gray-600">자동 업데이트</span>
            <input
              type="checkbox"
              checked={autoUpdate}
              onChange={(e) => setAutoUpdate(e.target.checked)}
            />
          </label>
          <button
            className="rounded border px-2 py-1 text-xs"
            type="button"
            onClick={() => void refetch()}
          >
            {autoUpdate ? `${REFRESH_SEC}초 간격` : ""}{" "}
            {isFetching ? "갱신 중..." : "↻ 새로고침"}
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3">
        <div className="text-right space-y-1">
          <div className="text-lg font-semibold">{match.team_a_name}</div>
        </div>
        <div className="text-3xl font-bold tabular-nums">
          {match.score_a} : {match.score_b}
        </div>
        <div className="space-y-1">
          <div className="text-lg font-semibold">{match.team_b_name}</div>
        </div>
      </div>

      {missingA > 0 || missingB > 0 ? (
        <p className="text-[11px] text-amber-700">
          이벤트 기록 누락 감지: A {missingA} / B {missingB} (점수 기준 임시행
          표시)
        </p>
      ) : null}

      <div className="rounded-lg border border-gray-200 p-2 space-y-1 bg-gray-50/40">
        {timeEvents.length === 0 ? (
          <p className="text-xs text-gray-500">이벤트 없음</p>
        ) : (
          timeEvents.map((event) => {
            return (
              <EventLine
                key={`${event.type}-${event.event.id}`}
                event={event.event}
                type={event.type}
                match={match}
                readonly={readonly}
                onStarterClick={setSelectedStarterId}
                activeStarterId={selectedStarterId}
                selectingGoalId={selectingGoalId}
                onSelectGoal={(id) => {
                  startTransition(() => setSelectingGoalId(id));
                  window.setTimeout(() => setSelectingGoalId((prev) => (prev === id ? null : prev)), 1200);
                }}
              />
            );
          })
        )}
      </div>

      {selectedStarter ? (
        <div className="rounded-lg border border-gray-200 p-2 space-y-1 bg-gray-50/40 text-xs">
          <div className="font-semibold text-gray-700">{selectedStarter.label} 선발 명단</div>
          <div className="text-gray-600">A: {selectedStarter.teamA || "없음"}</div>
          <div className="text-gray-600">B: {selectedStarter.teamB || "없음"}</div>
        </div>
      ) : null}
    </section>
  );
}

export default function LiveScoreboard(props: {
  matchId: string;
  initialMatch: MatchMini;
  initialGoals: Goal[];
  readonly: boolean;
  matchStatus: "scheduled" | "live" | "ended";
  substitutionEvents?: SubstitutionEvent[];
  periodStarters?: PeriodStarterSummary[];
}) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <LiveScoreboardInner {...props} />
    </QueryClientProvider>
  );
}
