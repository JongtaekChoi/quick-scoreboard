'use client'

import { useMemo, useState } from 'react'
import PendingSubmitButton from '@/components/PendingSubmitButton'

type RosterPlayer = { playerId: string; jerseyNo: string; playerName: string; value: string }

export default function GoalAddActions({
  actionA,
  actionB,
  teamAName,
  teamBName,
  rosterA,
  rosterB,
  defaultMinute,
  periodState,
  firstHalfStartedAt,
  secondHalfStartedAt,
  firstHalfBaseMinute,
}: {
  actionA: (formData: FormData) => void | Promise<void>
  actionB: (formData: FormData) => void | Promise<void>
  teamAName: string
  teamBName: string
  rosterA: RosterPlayer[]
  rosterB: RosterPlayer[]
  defaultMinute: number
  periodState: 'pre' | 'first_half' | 'halftime' | 'second_half' | 'ended'
  firstHalfStartedAt: string | null
  secondHalfStartedAt: string | null
  firstHalfBaseMinute: number
}) {
  const [open, setOpen] = useState<'A' | 'B' | null>(null)
  const [scorer, setScorer] = useState('')
  const [minuteValue, setMinuteValue] = useState<number>(defaultMinute)
  const roster = open === 'A' ? rosterA : rosterB
  const teamName = open === 'A' ? teamAName : teamBName
  const action = open === 'A' ? actionA : actionB
  const assistRoster = useMemo(() => roster.filter((p) => p.value !== scorer), [roster, scorer])

  function currentMinuteValue() {
    const now = Date.now()
    if (periodState === 'first_half' && firstHalfStartedAt) {
      return Math.max(0, Math.floor((now - new Date(firstHalfStartedAt).getTime()) / 60000))
    }
    if (periodState === 'second_half' && secondHalfStartedAt) {
      const secondHalfElapsed = Math.max(0, Math.floor((now - new Date(secondHalfStartedAt).getTime()) / 60000))
      return firstHalfBaseMinute + secondHalfElapsed
    }
    return defaultMinute
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="rounded border bg-black text-white px-4 py-3 text-lg font-semibold" onClick={() => { setScorer(''); setMinuteValue(currentMinuteValue()); setOpen('A') }}>
          {teamAName} +1
        </button>
        <button type="button" className="rounded border bg-black text-white px-4 py-3 text-lg font-semibold" onClick={() => { setScorer(''); setMinuteValue(currentMinuteValue()); setOpen('B') }}>
          {teamBName} +1
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => { setOpen(null); setScorer('') }}>
          <div className="w-full max-w-md rounded-xl bg-white p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">득점 입력 · {teamName}</h3>
              <button type="button" className="text-xs underline" onClick={() => { setOpen(null); setScorer('') }}>닫기</button>
            </div>
            <form action={action} className="space-y-2">
              <div>
                <label className="block text-xs text-gray-600 mb-1">분</label>
                <input name="minute" type="number" min={0} max={200} value={minuteValue} onChange={(e) => setMinuteValue(Math.max(0, Number(e.target.value) || 0))} className="w-full rounded border px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">득점 선수</label>
                <select name="scorer" value={scorer} onChange={(e) => setScorer(e.target.value)} className="w-full rounded border px-2 py-1.5 text-sm">
                  <option value="">선수 선택</option>
                  {roster.map((p) => <option key={`s-${p.value}`} value={p.value}>{p.playerName}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">어시스트 선수</label>
                <select name="assist" className="w-full rounded border px-2 py-1.5 text-sm">
                  <option value="">없음</option>
                  {assistRoster.map((p) => <option key={`a-${p.value}`} value={p.value}>{p.playerName}</option>)}
                </select>
              </div>
              <div className="flex justify-end">
                <PendingSubmitButton className="rounded border px-3 py-1.5 text-sm">확인</PendingSubmitButton>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  )
}
