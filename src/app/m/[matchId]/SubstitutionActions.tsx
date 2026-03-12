'use client'

import { useMemo, useState } from 'react'
import PendingSubmitButton from '@/components/PendingSubmitButton'

type RosterPlayer = { playerId: string; jerseyNo: string; playerName: string; value: string }

function computeDefaultMinute(
  periodState: string,
  firstHalfStartedAt: string | null,
  secondHalfStartedAt: string | null,
  firstHalfEndedAt: string | null,
) {
  const now = Date.now()
  const elapsed = (iso: string | null) => (iso ? Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000)) : 0)
  const firstHalfBaseMinute =
    firstHalfStartedAt && firstHalfEndedAt
      ? Math.max(0, Math.floor((new Date(firstHalfEndedAt).getTime() - new Date(firstHalfStartedAt).getTime()) / 60000))
      : 15

  if (periodState === 'second_half') return firstHalfBaseMinute + elapsed(secondHalfStartedAt)
  if (periodState === 'first_half') return elapsed(firstHalfStartedAt)
  if (periodState === 'halftime') return firstHalfBaseMinute
  return 0
}

export default function SubstitutionActions({
  action,
  teamAName,
  teamBName,
  activeA,
  benchA,
  activeB,
  benchB,
  disabled,
  periodState,
  firstHalfStartedAt,
  secondHalfStartedAt,
  firstHalfEndedAt,
  reservablePeriods,
}: {
  action: (formData: FormData) => void | Promise<void>
  teamAName: string
  teamBName: string
  activeA: RosterPlayer[]
  benchA: RosterPlayer[]
  activeB: RosterPlayer[]
  benchB: RosterPlayer[]
  disabled?: boolean
  periodState: 'pre' | 'first_half' | 'halftime' | 'second_half' | 'ended'
  firstHalfStartedAt: string | null
  secondHalfStartedAt: string | null
  firstHalfEndedAt: string | null
  reservablePeriods: Array<{ sequence: number; label: string }>
}) {
  const [open, setOpen] = useState(false)
  const [teamSide, setTeamSide] = useState<'A' | 'B'>('A')
  const [minute, setMinute] = useState(0)

  const autoReserveMode = periodState === 'pre' || periodState === 'halftime'
  const reserveSequence = reservablePeriods[0]?.sequence ?? 1

  const outRoster = useMemo(() => (teamSide === 'A' ? activeA : activeB), [teamSide, activeA, activeB])
  const inRoster = useMemo(() => (teamSide === 'A' ? benchA : benchB), [teamSide, benchA, benchB])

  return (
    <>
      <button
        type="button"
        className="rounded border px-2 py-1 text-xs disabled:opacity-50"
        disabled={disabled}
        onClick={() => {
          setMinute(computeDefaultMinute(periodState, firstHalfStartedAt, secondHalfStartedAt, firstHalfEndedAt))
          setOpen(true)
        }}
      >
        선수 교체
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">선수 교체</h3>
              <button type="button" className="text-xs underline" onClick={() => setOpen(false)}>닫기</button>
            </div>
            <form action={action} className="space-y-2">
              <input type="hidden" name="team_side" value={teamSide} />
              <input type="hidden" name="reservation_mode" value={autoReserveMode ? 'reserve' : 'now'} />
              <input type="hidden" name="reservation_period_sequence" value={reserveSequence} />
              <div className="text-xs text-gray-600 rounded border bg-gray-50 px-2 py-1.5">
                {autoReserveMode
                  ? `현재는 시작 전 상태라 다음 period(${reservablePeriods[0]?.label ?? '다음 period'}) 교체로 자동 예약됩니다.`
                  : '현재 진행중 period에 즉시 교체로 반영됩니다.'}
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">팀</label>
                <select value={teamSide} onChange={(e) => setTeamSide(e.target.value as 'A' | 'B')} className="w-full rounded border px-2 py-1.5 text-sm">
                  <option value="A">{teamAName}</option>
                  <option value="B">{teamBName}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">분</label>
                <input name="minute" type="number" min={0} max={200} value={minute} onChange={(e) => setMinute(Number(e.target.value || 0))} className="w-full rounded border px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">나가는 선수(출전중)</label>
                <select name="player_out_value" className="w-full rounded border px-2 py-1.5 text-sm" required>
                  <option value="">선수 선택</option>
                  {outRoster.map((p) => <option key={`out-${teamSide}-${p.value}`} value={p.value}>{p.playerName}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">들어가는 선수(벤치)</label>
                <select name="player_in_value" className="w-full rounded border px-2 py-1.5 text-sm" required>
                  <option value="">선수 선택</option>
                  {inRoster.map((p) => <option key={`in-${teamSide}-${p.value}`} value={p.value}>{p.playerName}</option>)}
                </select>
              </div>
              <div className="flex justify-end">
                {outRoster.length === 0 || inRoster.length === 0 || (autoReserveMode && reservablePeriods.length === 0) ? (
                  <button type="button" className="rounded border px-3 py-1.5 text-sm opacity-50" disabled>교체</button>
                ) : (
                  <PendingSubmitButton className="rounded border px-3 py-1.5 text-sm">{autoReserveMode ? '예약 저장' : '교체'}</PendingSubmitButton>
                )}
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  )
}
