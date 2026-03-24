"use client";

import { useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMatchDetail } from "./useMatchDetail";
import {
  useAddGoal,
  useApplyPeriod,
  useUpdateGoal,
  useDeleteGoal,
  useSubmitRating,
  useAddSubstitution,
  useUndoSubstitution,
  useCancelReservedSubstitution,
} from "./useMatchMutations";
import MatchDetailSkeleton from "./MatchDetailSkeleton";
import LiveScoreboard from "./LiveScoreboard";
import GoalAddActions from "./GoalAddActions";
import GoalEditModal from "./GoalEditModal";
import MatchEditHelp from "./MatchEditHelp";
import SubstitutionActions from "./SubstitutionActions";
import ShareButton from "@/components/ShareButton";
import AccountBadge from "@/components/AccountBadge";
import StarRatingInput from "@/components/StarRatingInput";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import TransientToast from "@/components/TransientToast";
import LiveMinuteBadge from "./LiveMinuteBadge";
import UserGNB from "@/components/UserGNB";
import { getPeriodDisplayLabel } from "@/lib/matchPeriods";
import type { MatchPeriodRow, PeriodControlSummary } from "@/lib/matchPeriods";
import type {
  GoalEvent,
  MatchSubstitution,
  RosterPlayer,
  PlayerRatingAgg,
  ReservablePeriod,
  ReservedSubstitutionPlan,
} from "./types";

const ERR_TOAST_MAP: Record<string, string> = {
  forbidden: "권한이 없습니다.",
  participation_player: "선수를 1명 이상 선택해 주세요.",
  participation_minute: "분(minute)은 0~200 사이여야 합니다.",
  participation_invalid: "출전 이벤트 입력값을 확인해 주세요.",
  participation_closed: "경기 종료 후에는 수정할 수 없습니다.",
  participation_same_player:
    "같은 선수를 동시에 OUT/IN으로 선택할 수 없습니다.",
  participation_reserve_period: "예약할 period를 다시 선택해 주세요.",
  participation_reserve_duplicate: "이미 예약된 선수가 포함되어 있습니다.",
  participation_reserve_cancel: "예약 취소에 실패했습니다.",
  undo_expired: "교체 취소 가능 시간이 지났습니다.",
  network_error: "네트워크 오류가 발생했습니다.",
  goal_insert_failed: "골 기록에 실패했습니다.",
  goal_recount_failed: "점수 재계산에 실패했습니다.",
  score_update_failed: "점수 갱신에 실패했습니다.",
  rating_forbidden: "평점 입력 권한이 없습니다.",
  rating_invalid: "유효하지 않은 평점입니다.",
  rating_closed: "경기 종료 상태에서만 평점을 입력할 수 있습니다.",
  rating_same_team: "같은 팀 선수에게는 평점을 남길 수 없습니다.",
};

function calcActiveKeys(
  subs: MatchSubstitution[],
  starterKeys: Set<string>,
) {
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
}

export default function MatchDetailClient({
  matchId,
}: {
  matchId: string;
}) {
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode");
  const undoParam = searchParams.get("undo");
  const undoUntilParam = searchParams.get("undo_until");

  const { data, isLoading, error } = useMatchDetail(matchId);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [undoIds, setUndoIds] = useState<string | null>(undoParam);
  const [undoUntil, setUndoUntil] = useState<string | null>(undoUntilParam);

  const showError = useCallback(
    (code: string) => setToastMessage(ERR_TOAST_MAP[code] ?? code),
    [],
  );
  const clearToast = useCallback(() => setToastMessage(null), []);

  if (isLoading) return <MatchDetailSkeleton />;

  if (error || !data) {
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

  return (
    <MatchDetailInner
      matchId={matchId}
      data={data}
      mode={mode}
      undoIds={undoIds}
      undoUntil={undoUntil}
      setUndoIds={setUndoIds}
      setUndoUntil={setUndoUntil}
      toastMessage={toastMessage}
      showError={showError}
      clearToast={clearToast}
    />
  );
}

function MatchDetailInner({
  matchId,
  data,
  mode,
  undoIds,
  undoUntil,
  setUndoIds,
  setUndoUntil,
  toastMessage,
  showError,
  clearToast,
}: {
  matchId: string;
  data: NonNullable<ReturnType<typeof useMatchDetail>["data"]>;
  mode: string | null;
  undoIds: string | null;
  undoUntil: string | null;
  setUndoIds: (v: string | null) => void;
  setUndoUntil: (v: string | null) => void;
  toastMessage: string | null;
  showError: (code: string) => void;
  clearToast: () => void;
}) {
  const {
    match,
    channel,
    group,
    goals,
    matchPeriods,
    matchSubstitutions,
    periodLineups,
    reservedSubPlans,
    rosterA,
    rosterB,
    teamAId,
    teamBId,
    ratingAggs,
    myRatings,
    permissions,
    periodControlSummary,
    aliases,
  } = data;

  const {
    canGoalEdit,
    canManageMatch,
    canEditThisMatch,
    isAdmin: isAdminSession,
    isLoggedIn,
    accountLoginId,
    accountRole,
    accountTeamId,
  } = permissions;

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
    isLoggedIn &&
    (accountRole === "player" || accountRole === "manager") &&
    match.status === "ended";

  const ratingTargetRoster =
    accountTeamId && accountTeamId === teamAId
      ? rosterB
      : accountTeamId && accountTeamId === teamBId
        ? rosterA
        : [];

  const playerLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of rosterA)
      m.set(p.playerId, `#${p.jerseyNo} ${p.playerName}`);
    for (const p of rosterB)
      m.set(p.playerId, `#${p.jerseyNo} ${p.playerName}`);
    return m;
  }, [rosterA, rosterB]);

  const sortedPeriods = useMemo(
    () => [...matchPeriods].sort((a, b) => a.sequence - b.sequence),
    [matchPeriods],
  );

  const periodSequenceById = useMemo(
    () => new Map(sortedPeriods.map((p) => [p.id, p.sequence] as const)),
    [sortedPeriods],
  );

  const livePeriod = sortedPeriods.find((p) => p.status === "live") ?? null;
  const nextPendingPeriod =
    sortedPeriods.find((p) => p.status === "pending") ?? null;
  const hasPendingAfterLive = livePeriod
    ? sortedPeriods.some(
        (p) => p.sequence > livePeriod.sequence && p.status === "pending",
      )
    : false;
  const canStartPeriod =
    !!nextPendingPeriod && !livePeriod && match.status !== "ended";
  const canEndPeriod = !!livePeriod;
  const canResumePrevious =
    !livePeriod &&
    sortedPeriods.some((p) => p.status === "ended") &&
    match.status !== "ended";

  const startPeriodLabel = nextPendingPeriod
    ? `${getPeriodDisplayLabel(nextPendingPeriod.sequence, nextPendingPeriod)} 시작`
    : null;
  const endPeriodLabel = livePeriod
    ? hasPendingAfterLive
      ? `${getPeriodDisplayLabel(livePeriod.sequence, livePeriod)} 종료`
      : "경기 종료"
    : null;

  const reservablePeriods: ReservablePeriod[] = sortedPeriods
    .filter((p) => p.status === "pending")
    .map((p) => ({
      id: p.id,
      sequence: p.sequence,
      label: getPeriodDisplayLabel(p.sequence, p),
    }));

  // Lineup computations
  const sortedPeriodsForLineups = sortedPeriods;
  const livePeriodForLineups =
    sortedPeriodsForLineups.find((p) => p.status === "live") ?? null;
  const effectivePeriodId =
    livePeriodForLineups?.id ??
    sortedPeriodsForLineups.find((p) => p.status === "ended")?.id ??
    sortedPeriodsForLineups[0]?.id ??
    null;

  const lineupRowsA = periodLineups.filter(
    (row) => row.match_period_id === effectivePeriodId && row.team_side === "A",
  );
  const lineupRowsB = periodLineups.filter(
    (row) => row.match_period_id === effectivePeriodId && row.team_side === "B",
  );

  const starterKeySetA = new Set(
    lineupRowsA.map(
      (row) => row.player_id || `name:${row.player_name ?? ""}`,
    ),
  );
  const starterKeySetB = new Set(
    lineupRowsB.map(
      (row) => row.player_id || `name:${row.player_name ?? ""}`,
    ),
  );

  const startingCountA = starterKeySetA.size;
  const startingCountB = starterKeySetB.size;
  const isLivePeriod =
    match.period_state === "first_half" ||
    match.period_state === "halftime" ||
    match.period_state === "second_half" ||
    match.period_state === "ended";

  const subsA = matchSubstitutions.filter((e) => e.team_side === "A");
  const subsB = matchSubstitutions.filter((e) => e.team_side === "B");
  const activeKeysA = calcActiveKeys(subsA, starterKeySetA);
  const activeKeysB = calcActiveKeys(subsB, starterKeySetB);

  // Time computations
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

  // Rating maps
  const ratingMap = useMemo(() => {
    const m = new Map<string, PlayerRatingAgg>();
    for (const r of ratingAggs) m.set(r.target_player_id, r);
    return m;
  }, [ratingAggs]);

  const myRatingMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of myRatings) m.set(r.target_player_id, Number(r.rating));
    return m;
  }, [myRatings]);

  const suggestedNames = useMemo(
    () =>
      Array.from(
        new Set([
          ...(aliases ?? []).map((a) => a.player_name).filter(Boolean),
          ...goals.flatMap((g) => [g.scorer_name, g.assist_name]).filter(Boolean),
        ] as string[]),
      ).slice(0, 20),
    [aliases, goals],
  );

  // Period starters for LiveScoreboard
  const periodStarters = useMemo(() => {
    return sortedPeriods
      .filter((p) => p.status !== "pending")
      .map((p) => {
        const rowsA = periodLineups.filter(
          (row) => row.match_period_id === p.id && row.team_side === "A",
        );
        const rowsB = periodLineups.filter(
          (row) => row.match_period_id === p.id && row.team_side === "B",
        );
        if (rowsA.length === 0 && rowsB.length === 0) return null;

        const toLabel = (row: {
          player_id: string | null;
          player_name: string | null;
        }) =>
          (row.player_id
            ? playerLabelById.get(row.player_id)
            : undefined) ??
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
      .filter(Boolean) as {
      id: string;
      period_sequence: number;
      label: string;
      startMinute: number;
      teamA: string;
      teamB: string;
    }[];
  }, [sortedPeriods, periodLineups, playerLabelById, firstHalfBaseMinute]);

  const matchUrl = `https://quick-scoreboard.vercel.app/m/${matchId}`;
  const currentPath = `/m/${matchId}`;
  const undoAvailable =
    !!undoIds && !!undoUntil && Date.now() < Number(undoUntil);

  // Mutation hooks (only create when we have a channel)
  const mutationCallbacks = useMemo(
    () => ({
      onSuccess: () => clearToast(),
      onError: (msg: string) => showError(msg),
    }),
    [showError, clearToast],
  );

  return (
    <main className="min-h-screen p-4 md:p-6 bg-white page-enter">
      <section className="max-w-3xl mx-auto space-y-4">
        {toastMessage ? (
          <TransientToast message={toastMessage} tone="error" />
        ) : null}
        <UserGNB
          slug={channel?.slug}
          channelName={channel?.name ?? "경기"}
          current="matches"
          subtitle={`${match.seq}경기 · ${match.status}`}
          isLoggedIn={isLoggedIn}
          currentPath={currentPath}
          rightActions={
            <>
              {isLoggedIn && accountLoginId && accountRole && channel ? (
                <AccountBadge
                  loginId={accountLoginId}
                  role={accountRole}
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
          }
        />

        {canGoalEdit ||
        isEditMode ||
        (accountRole === "player" && !canEditThisMatch) ||
        group ||
        undoAvailable ? (
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
              {accountRole === "player" && !canEditThisMatch ? (
                <span className="text-xs text-amber-700">
                  본인 팀 경기는 점수 입력이 제한됩니다. (팀장/팀원 공통)
                </span>
              ) : null}
              {group ? (
                <span className="text-xs text-gray-500">
                  {group.title ??
                    `${group.play_date} 그룹 ${group.seq}`}
                </span>
              ) : null}
            </div>
            {undoAvailable && channel ? (
              <UndoSubstitutionBar
                matchId={matchId}
                channelSlug={channel.slug}
                undoIds={undoIds!}
                undoUntil={undoUntil!}
                onSuccess={() => {
                  setUndoIds(null);
                  setUndoUntil(null);
                }}
                onError={showError}
              />
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
          initialGoals={goals.map((g) => ({
            id: g.id,
            team_side: g.team_side,
            period_sequence: g.match_period_id
              ? (periodSequenceById.get(g.match_period_id) ??
                g.period_sequence)
              : g.period_sequence,
            minute: g.minute,
            scorer_name: g.scorer_name,
            assist_name: g.assist_name,
            created_at: g.created_at,
          }))}
          substitutionEvents={matchSubstitutions.map((s) => ({
            id: s.id,
            period_sequence: s.match_period_id
              ? (periodSequenceById.get(s.match_period_id) ??
                s.period_sequence)
              : s.period_sequence,
            minute: s.minute,
            team_side: s.team_side,
            player_out_label:
              (s.player_out_id
                ? playerLabelById.get(s.player_out_id)
                : undefined) ??
              s.player_out_name ??
              "선수",
            player_in_label:
              (s.player_in_id
                ? playerLabelById.get(s.player_in_id)
                : undefined) ??
              s.player_in_name ??
              "선수",
            created_at: s.created_at,
          }))}
          periodStarters={periodStarters}
        />

        {isEditMode && channel ? (
          <EditModeActions
            matchId={matchId}
            match={match}
            channel={channel}
            canAddGoalNow={canAddGoalNow}
            canManageMatch={canManageMatch}
            canStartPeriod={canStartPeriod}
            canEndPeriod={canEndPeriod}
            canResumePrevious={canResumePrevious}
            startPeriodLabel={startPeriodLabel}
            endPeriodLabel={endPeriodLabel}
            periodControlSummary={periodControlSummary}
            firstHalfBaseMinute={firstHalfBaseMinute}
            goalDefaultMinute={goalDefaultMinute}
            rosterA={rosterA}
            rosterB={rosterB}
            activeKeysA={activeKeysA}
            activeKeysB={activeKeysB}
            startingCountA={startingCountA}
            startingCountB={startingCountB}
            matchSubstitutions={matchSubstitutions}
            reservedSubPlans={reservedSubPlans}
            reservablePeriods={reservablePeriods}
            sortedPeriods={sortedPeriods}
            playerLabelById={playerLabelById}
            onSubSuccess={(ids) => {
              if (ids) {
                setUndoIds(ids);
                setUndoUntil(String(Date.now() + 30_000));
              }
            }}
            callbacks={mutationCallbacks}
          />
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
                    const key =
                      p.playerId || `name:${p.playerName}`;
                    const onPitch =
                      isLivePeriod && activeKeysA.has(key);
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
                    const key =
                      p.playerId || `name:${p.playerName}`;
                    const onPitch =
                      isLivePeriod && activeKeysB.has(key);
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

        {canRate && channel ? (
          <RatingSection
            matchId={matchId}
            channelSlug={channel.slug}
            ratingTargetRoster={ratingTargetRoster}
            ratingMap={ratingMap}
            myRatingMap={myRatingMap}
            callbacks={mutationCallbacks}
          />
        ) : null}

        {rosterA.length === 0 && rosterB.length === 0 ? (
          <datalist id="name-suggestions">
            {suggestedNames.map((name) => (
              <option key={`name-${name}`} value={name} />
            ))}
          </datalist>
        ) : null}

        {canEditGoalNow && channel ? (
          <GoalEditSection
            matchId={matchId}
            channelSlug={channel.slug}
            channelVersion={channel.edit_session_version}
            goals={goals}
            rosterA={rosterA}
            rosterB={rosterB}
            callbacks={mutationCallbacks}
          />
        ) : null}
      </section>
    </main>
  );
}

// --- Sub-components to hold mutation hooks ---

function UndoSubstitutionBar({
  matchId,
  channelSlug,
  undoIds,
  undoUntil,
  onSuccess,
  onError,
}: {
  matchId: string;
  channelSlug: string;
  undoIds: string;
  undoUntil: string;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const mutation = useUndoSubstitution(matchId, channelSlug, {
    onSuccess,
    onError,
  });

  return (
    <form
      action={(formData: FormData) => mutation.mutate(formData)}
      className="inline-flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800"
    >
      <input type="hidden" name="undo_ids" value={undoIds} />
      <input type="hidden" name="undo_until" value={undoUntil} />
      <span>최근 교체를 취소할 수 있습니다.</span>
      <PendingSubmitButton className="rounded border px-2 py-0.5 text-xs">
        교체 취소
      </PendingSubmitButton>
    </form>
  );
}

function EditModeActions({
  matchId,
  match,
  channel,
  canAddGoalNow,
  canManageMatch,
  canStartPeriod,
  canEndPeriod,
  canResumePrevious,
  startPeriodLabel,
  endPeriodLabel,
  periodControlSummary,
  firstHalfBaseMinute,
  goalDefaultMinute,
  rosterA,
  rosterB,
  activeKeysA,
  activeKeysB,
  startingCountA,
  startingCountB,
  matchSubstitutions,
  reservedSubPlans,
  reservablePeriods,
  sortedPeriods,
  playerLabelById,
  onSubSuccess,
  callbacks,
}: {
  matchId: string;
  match: { team_a_name: string; team_b_name: string; period_state: string; first_half_started_at: string | null; second_half_started_at: string | null; first_half_ended_at: string | null };
  channel: { slug: string; edit_session_version: number };
  canAddGoalNow: boolean;
  canManageMatch: boolean;
  canStartPeriod: boolean;
  canEndPeriod: boolean;
  canResumePrevious: boolean;
  startPeriodLabel: string | null;
  endPeriodLabel: string | null;
  periodControlSummary: { statusLabel: string; primaryActionLabel: string | null };
  firstHalfBaseMinute: number;
  goalDefaultMinute: number;
  rosterA: RosterPlayer[];
  rosterB: RosterPlayer[];
  activeKeysA: Set<string>;
  activeKeysB: Set<string>;
  startingCountA: number;
  startingCountB: number;
  matchSubstitutions: MatchSubstitution[];
  reservedSubPlans: ReservedSubstitutionPlan[];
  reservablePeriods: ReservablePeriod[];
  sortedPeriods: MatchPeriodRow[];
  playerLabelById: Map<string, string>;
  onSubSuccess: (undoIds?: string) => void;
  callbacks: { onSuccess?: () => void; onError?: (msg: string) => void };
}) {
  const addGoalA = useAddGoal(matchId, "A", channel.slug, channel.edit_session_version, callbacks);
  const addGoalB = useAddGoal(matchId, "B", channel.slug, channel.edit_session_version, callbacks);
  const startPeriod = useApplyPeriod(matchId, channel.slug, channel.edit_session_version, "start_period", callbacks);
  const endPeriod = useApplyPeriod(matchId, channel.slug, channel.edit_session_version, "end_period", callbacks);
  const resumePrevious = useApplyPeriod(matchId, channel.slug, channel.edit_session_version, "resume_previous", callbacks);
  const addSub = useAddSubstitution(matchId, channel.slug, {
    onSuccess: onSubSuccess,
    onError: callbacks.onError,
  });
  const cancelReserved = useCancelReservedSubstitution(matchId, channel.slug, callbacks);

  return (
    <div className="space-y-2">
      {canAddGoalNow ? (
        <>
          <GoalAddActions
            actionA={(formData: FormData) => addGoalA.mutate(formData)}
            actionB={(formData: FormData) => addGoalB.mutate(formData)}
            teamAName={match.team_a_name}
            teamBName={match.team_b_name}
            rosterA={(() => {
              const active = rosterA.filter((p) =>
                activeKeysA.has(p.playerId || `name:${p.playerName}`),
              );
              return active.length > 0 ? active : rosterA;
            })()}
            rosterB={(() => {
              const active = rosterB.filter((p) =>
                activeKeysB.has(p.playerId || `name:${p.playerName}`),
              );
              return active.length > 0 ? active : rosterB;
            })()}
            defaultMinute={goalDefaultMinute}
            periodState={match.period_state as "pre" | "first_half" | "halftime" | "second_half" | "ended"}
            firstHalfStartedAt={match.first_half_started_at}
            secondHalfStartedAt={match.second_half_started_at}
            firstHalfBaseMinute={firstHalfBaseMinute}
          />
          <p className="text-[11px] text-gray-500">
            득점자/어시스트를 모르면 비워두고 저장한 뒤 나중에 수정할 수
            있습니다.
          </p>
        </>
      ) : null}

      {canManageMatch ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-500">
            현재: {periodControlSummary.statusLabel}
            <LiveMinuteBadge
              periodState={match.period_state as "pre" | "first_half" | "halftime" | "second_half" | "ended"}
              firstHalfStartedAt={match.first_half_started_at}
              secondHalfStartedAt={match.second_half_started_at}
              firstHalfBaseMinute={firstHalfBaseMinute}
            />
          </span>
          {canStartPeriod ? (
            <button
              type="button"
              className="rounded border border-emerald-300 bg-emerald-50 text-emerald-800 px-2 py-1"
              disabled={startPeriod.isPending}
              onClick={() => {
                if (!confirm("경기를 시작하시겠습니까? 시작 후에는 되돌릴 수 없습니다.")) return;
                startPeriod.mutate();
              }}
            >
              {startPeriod.isPending
                ? "처리중..."
                : (startPeriodLabel ??
                  periodControlSummary.primaryActionLabel ??
                  "1P 시작")}
            </button>
          ) : null}
          {canEndPeriod ? (
            <button
              type="button"
              className="rounded border px-2 py-1"
              disabled={endPeriod.isPending}
              onClick={() => {
                if (!confirm("경기를 종료하시겠습니까? 종료 후에는 되돌릴 수 없습니다.")) return;
                endPeriod.mutate();
              }}
            >
              {endPeriod.isPending
                ? "처리중..."
                : (endPeriodLabel ?? "현재 period 종료")}
            </button>
          ) : null}
          {canResumePrevious ? (
            <button
              type="button"
              className="rounded border px-2 py-1"
              disabled={resumePrevious.isPending}
              onClick={() => resumePrevious.mutate()}
            >
              {resumePrevious.isPending
                ? "처리중..."
                : "이전 구간 재개"}
            </button>
          ) : null}
        </div>
      ) : null}

      {isEditModeSubstitutionSection({
        matchId,
        match,
        channel,
        addSub,
        cancelReserved,
        rosterA,
        rosterB,
        activeKeysA,
        activeKeysB,
        startingCountA,
        startingCountB,
        matchSubstitutions,
        reservedSubPlans,
        reservablePeriods,
        sortedPeriods,
        playerLabelById,
      })}
    </div>
  );
}

function isEditModeSubstitutionSection({
  matchId,
  match,
  channel,
  addSub,
  cancelReserved,
  rosterA,
  rosterB,
  activeKeysA,
  activeKeysB,
  startingCountA,
  startingCountB,
  matchSubstitutions,
  reservedSubPlans,
  reservablePeriods,
  sortedPeriods,
  playerLabelById,
}: {
  matchId: string;
  match: { team_a_name: string; team_b_name: string; period_state: string; first_half_started_at: string | null; second_half_started_at: string | null; first_half_ended_at: string | null };
  channel: { slug: string };
  addSub: ReturnType<typeof useAddSubstitution>;
  cancelReserved: ReturnType<typeof useCancelReservedSubstitution>;
  rosterA: RosterPlayer[];
  rosterB: RosterPlayer[];
  activeKeysA: Set<string>;
  activeKeysB: Set<string>;
  startingCountA: number;
  startingCountB: number;
  matchSubstitutions: MatchSubstitution[];
  reservedSubPlans: ReservedSubstitutionPlan[];
  reservablePeriods: ReservablePeriod[];
  sortedPeriods: MatchPeriodRow[];
  playerLabelById: Map<string, string>;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <details>
        <summary className="cursor-pointer list-none text-sm font-semibold text-gray-700 flex items-center justify-between">
          <span>선수 운용</span>
          <span className="text-xs text-gray-500">
            선발 A {startingCountA}명 · B {startingCountB}명 · 이벤트{" "}
            {matchSubstitutions.length}건
          </span>
        </summary>

        <div className="mt-3 space-y-3">
          <div className="rounded border p-3">
            <SubstitutionActions
              action={(formData: FormData) => addSub.mutate(formData)}
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
              periodState={match.period_state as "pre" | "first_half" | "halftime" | "second_half" | "ended"}
              firstHalfStartedAt={match.first_half_started_at}
              secondHalfStartedAt={match.second_half_started_at}
              firstHalfEndedAt={match.first_half_ended_at}
              reservablePeriods={reservablePeriods}
            />
          </div>

          <div className="text-xs text-gray-500">
            교체 이벤트는 상단 스코어보드에서 확인해 주세요.
          </div>

          {reservablePeriods.length > 0 ? (
            <div className="rounded border p-2 space-y-1 text-xs">
              <div className="font-medium text-gray-700">
                시작 전 교체 예약
              </div>
              {reservedSubPlans.length === 0 ? (
                <div className="text-gray-500">
                  예약된 교체가 없습니다.
                </div>
              ) : (
                <ul className="space-y-1">
                  {reservedSubPlans.map((plan) => {
                    const periodLabel =
                      sortedPeriods.find(
                        (p) =>
                          p.sequence === plan.period_sequence,
                      )?.label ??
                      sortedPeriods.find(
                        (p) =>
                          p.sequence === plan.period_sequence,
                      )?.period_code ??
                      `${plan.period_sequence}P`;
                    const outLabel =
                      (plan.player_out_id
                        ? playerLabelById.get(
                            plan.player_out_id,
                          )
                        : undefined) ??
                      plan.player_out_name ??
                      "선수";
                    const inLabel =
                      (plan.player_in_id
                        ? playerLabelById.get(
                            plan.player_in_id,
                          )
                        : undefined) ??
                      plan.player_in_name ??
                      "선수";
                    return (
                      <li
                        key={`reserved-sub-${plan.id}`}
                        className="flex items-center justify-between gap-2 rounded border px-2 py-1"
                      >
                        <span>
                          [{periodLabel}] {plan.team_side} ·{" "}
                          {plan.planned_minute}분 · OUT{" "}
                          {outLabel} / IN {inLabel}
                        </span>
                        <form
                          action={(formData: FormData) =>
                            cancelReserved.mutate(formData)
                          }
                        >
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
  );
}

function RatingSection({
  matchId,
  channelSlug,
  ratingTargetRoster,
  ratingMap,
  myRatingMap,
  callbacks,
}: {
  matchId: string;
  channelSlug: string;
  ratingTargetRoster: RosterPlayer[];
  ratingMap: Map<string, PlayerRatingAgg>;
  myRatingMap: Map<string, number>;
  callbacks: { onSuccess?: () => void; onError?: (msg: string) => void };
}) {
  const submitRating = useSubmitRating(matchId, channelSlug, callbacks);

  return (
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
                  action={(formData: FormData) =>
                    submitRating.mutate(formData)
                  }
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
  );
}

function GoalEditSection({
  matchId,
  channelSlug,
  channelVersion,
  goals,
  rosterA,
  rosterB,
  callbacks,
}: {
  matchId: string;
  channelSlug: string;
  channelVersion: number;
  goals: GoalEvent[];
  rosterA: RosterPlayer[];
  rosterB: RosterPlayer[];
  callbacks: { onSuccess?: () => void; onError?: (msg: string) => void };
}) {
  const updateGoal = useUpdateGoal(matchId, channelSlug, channelVersion, callbacks);
  const deleteGoal = useDeleteGoal(matchId, channelSlug, channelVersion, callbacks);

  return (
    <GoalEditModal
      goals={goals.map((g) => ({
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
      updateAction={(formData: FormData) => updateGoal.mutate(formData)}
      deleteAction={(formData: FormData) => deleteGoal.mutate(formData)}
    />
  );
}
