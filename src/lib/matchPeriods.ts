export type LegacyPeriodState =
  | "pre"
  | "first_half"
  | "halftime"
  | "second_half"
  | "ended";

export type MatchPeriodRow = {
  id: string;
  sequence: number;
  period_code: string | null;
  label: string | null;
  status: "pending" | "live" | "ended";
};

export type PeriodControlSummary = {
  statusLabel: string;
  primaryActionLabel: string | null;
};

export function getPeriodDisplayLabel(
  sequence: number,
  period?: Pick<MatchPeriodRow, "label" | "period_code">,
): string {
  if (period?.label?.trim()) return period.label.trim();
  if (period?.period_code?.trim()) return period.period_code.trim();
  return `${sequence}P`;
}

function pickSequenceForLegacyState(
  periodCount: number,
  state: LegacyPeriodState,
): number | null {
  const normalizedCount = Math.max(1, periodCount || 2);
  if (state === "pre") return 1;
  if (state === "first_half") return 1;
  if (state === "halftime") return Math.min(2, normalizedCount);
  if (state === "second_half") return Math.min(2, normalizedCount);
  return null;
}

export function summarizeLegacyPeriodControl(options: {
  periodCount: number;
  periodState: LegacyPeriodState;
  periods?: MatchPeriodRow[];
}): PeriodControlSummary {
  const normalizedCount = Math.max(1, options.periodCount || 2);
  const sortedPeriods = [...(options.periods ?? [])].sort(
    (a, b) => a.sequence - b.sequence,
  );
  const seq = pickSequenceForLegacyState(normalizedCount, options.periodState);

  if (options.periodState === "ended") {
    return { statusLabel: "경기 종료", primaryActionLabel: null };
  }

  if (seq === null) {
    return { statusLabel: "경기 상태 확인 필요", primaryActionLabel: null };
  }

  const currentPeriod = sortedPeriods.find((p) => p.sequence === seq);
  const currentLabel = getPeriodDisplayLabel(seq, currentPeriod);

  if (options.periodState === "pre") {
    return {
      statusLabel: "대기",
      primaryActionLabel: `${currentLabel} 시작`,
    };
  }

  if (options.periodState === "first_half") {
    return {
      statusLabel: `${currentLabel} 진행`,
      primaryActionLabel: `${currentLabel} 종료`,
    };
  }

  if (options.periodState === "halftime") {
    const nextPeriod = sortedPeriods.find((p) => p.sequence === seq);
    return {
      statusLabel: "휴식",
      primaryActionLabel: `${getPeriodDisplayLabel(seq, nextPeriod)} 시작`,
    };
  }

  if (options.periodState === "second_half") {
    if (normalizedCount > 2) {
      const nextSequence = Math.min(3, normalizedCount);
      const nextPeriod = sortedPeriods.find((p) => p.sequence === nextSequence);
      return {
        statusLabel: `${currentLabel} 진행`,
        primaryActionLabel: `${getPeriodDisplayLabel(nextSequence, nextPeriod)} 시작(예정)`,
      };
    }

    return {
      statusLabel: `${currentLabel} 진행`,
      primaryActionLabel: "경기 종료",
    };
  }

  return { statusLabel: "경기 상태 확인 필요", primaryActionLabel: null };
}
