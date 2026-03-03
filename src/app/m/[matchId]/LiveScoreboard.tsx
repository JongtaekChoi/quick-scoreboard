"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type Goal = {
  id: string;
  team_side: "A" | "B";
  minute: number | null;
  scorer_name: string | null;
  scorer_no: string | null;
  assist_name: string | null;
  assist_no: string | null;
  created_at: string;
};

type MatchMini = {
  id: string;
  team_a_name: string;
  team_b_name: string;
  score_a: number;
  score_b: number;
};

type ScoreboardPayload = { match: MatchMini; goals: Goal[] };

const REFRESH_SEC = 10;

function LiveScoreboardInner({
  matchId,
  initialMatch,
  initialGoals,
  readonly,
  matchStatus,
}: {
  matchId: string;
  initialMatch: MatchMini;
  initialGoals: Goal[];
  readonly: boolean;
  matchStatus: "scheduled" | "live" | "ended";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [autoUpdate, setAutoUpdate] = useState(false);

  useEffect(() => {
    queryClient.setQueryData(["scoreboard", matchId], {
      match: initialMatch,
      goals: initialGoals,
    });
  }, [queryClient, matchId, initialMatch, initialGoals]);

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
      scorer_no: null,
      assist_name: null,
      assist_no: null,
      created_at: new Date(0).toISOString(),
    });
  }
  for (let i = 0; i < missingB; i++) {
    displayGoals.push({
      id: `missing-b-${i}`,
      team_side: "B",
      minute: null,
      scorer_name: "(기록없음)",
      scorer_no: null,
      assist_name: null,
      assist_no: null,
      created_at: new Date(0).toISOString(),
    });
  }

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
        {displayGoals.length === 0 ? (
          <p className="text-xs text-gray-500">득점 이벤트 없음</p>
        ) : (
          displayGoals.map((g, idx) => {
            const who =
              g.scorer_name ??
              g.scorer_no ??
              (g.team_side === "A" ? match.team_a_name : match.team_b_name);
            const assist = g.assist_name ?? g.assist_no ?? "";
            const currentGoal = searchParams.get("goal");
            const active =
              !readonly && (currentGoal ? currentGoal === g.id : idx === 0);
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => {
                  if (readonly) return;
                  const qs = new URLSearchParams(searchParams.toString());
                  qs.set("goal", g.id);
                  router.replace(`${pathname}?${qs.toString()}`, {
                    scroll: false,
                  });
                }}
                className={`w-full text-left grid grid-cols-[1fr_auto_1fr] items-center text-xs gap-2 rounded-lg px-2 py-1 ${active ? "bg-white ring-1 ring-gray-300" : "hover:bg-white/70"}`}
              >
                <div className="text-right truncate">
                  {g.team_side === "A" ? (
                    <>
                      <span>{who}</span>
                      {assist ? (
                        <span className="text-gray-400"> ({assist})</span>
                      ) : null}
                    </>
                  ) : (
                    ""
                  )}
                </div>

                <div className="text-gray-500 tabular-nums">
                  {g.minute !== null ? `${g.minute}’` : ""}
                </div>

                <div className="truncate">
                  {g.team_side === "B" ? (
                    <>
                      <span>{who}</span>
                      {assist ? (
                        <span className="text-gray-400"> ({assist})</span>
                      ) : null}
                    </>
                  ) : (
                    ""
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

export default function LiveScoreboard(props: {
  matchId: string;
  initialMatch: MatchMini;
  initialGoals: Goal[];
  readonly: boolean;
  matchStatus: "scheduled" | "live" | "ended";
}) {
  return <LiveScoreboardInner {...props} />;
}
