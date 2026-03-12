"use client";

import { useState } from "react";
import {
  ReadonlyURLSearchParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

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
  label: string;
  teamA: string;
  teamB: string;
  startMinute: number;
};

type ScoreboardPayload = { match: MatchMini; goals: Goal[] };

const REFRESH_SEC = 10;

function EventLine({
  event,
  type,
  match,
  readonly,
  idx,
  router,
  searchParams,
  pathname,
  onStarterClick,
  activeStarterId,
}: {
  event: Goal | Replacement | StarterLine;
  type: "goal" | "replace" | "starter";
  match: MatchMini;
  readonly: boolean;
  idx: number;
  router: AppRouterInstance;
  searchParams: ReadonlyURLSearchParams;
  pathname: string;
  onStarterClick?: (id: string) => void;
  activeStarterId?: string | null;
}) {
  const g = type == "goal" ? (event as Goal) : null;
  const replacement = type == "replace" ? (event as Replacement) : null;
  const starter = type == "starter" ? (event as StarterLine) : null;
  const who = g
    ? (g.scorer_name ??
      (g.team_side === "A" ? match.team_a_name : match.team_b_name))
    : "";
  const assist = g?.assist_name ?? "";
  const currentGoal = searchParams.get("goal");
  const active = !readonly && (currentGoal ? currentGoal === g?.id : idx === 0);

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
        const qs = new URLSearchParams(searchParams.toString());
        qs.set("goal", g.id);
        router.replace(`${pathname}?${qs.toString()}`, {
          scroll: false,
        });
      }}
      className={`w-full text-left grid grid-cols-[1fr_auto_1fr] items-center text-xs gap-2 rounded-lg px-2 py-1 ${active ? "bg-white ring-1 ring-gray-300" : "hover:bg-white/70"}`}
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
        {g?.minute !== null && g?.minute !== undefined
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [selectedStarterId, setSelectedStarterId] = useState<string | null>(null);

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

  const match = data.match;
  const goals = data.goals;

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
    period_sequence: idx + 1,
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
        replace: 1,
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
          if (a.type !== b.type) return typePriority[a.type] - typePriority[b.type];
          return new Date(b.event.created_at).getTime() - new Date(a.event.created_at).getTime();
        })
        .map(({ type, event }) => ({ type, event }));
    })();

  return (
    <section className="sticky top-0 z-10 rounded-xl border border-gray-200 p-4 space-y-3 bg-white/95 backdrop-blur shadow-sm">
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
          timeEvents.map((event, idx) => {
            return (
              <EventLine
                key={`${event.type}-${event.event.id}`}
                event={event.event}
                type={event.type}
                router={router}
                idx={idx}
                match={match}
                pathname={pathname}
                readonly={readonly}
                searchParams={searchParams}
                onStarterClick={setSelectedStarterId}
                activeStarterId={selectedStarterId}
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
