'use client'

import { useMemo, useState } from 'react'
import PendingSubmitButton from '@/components/PendingSubmitButton'

type RosterPlayer = { playerId: string; jerseyNo: string; playerName: string; value: string }

export default function GoalEditForm({
  action,
  roster,
  hasRoster,
  scorerDefault,
  assistDefault,
  minuteDefault,
  scorerNameDefault,
  assistNameDefault,
}: {
  action: (formData: FormData) => void | Promise<void>
  roster: RosterPlayer[]
  hasRoster: boolean
  scorerDefault: string
  assistDefault: string
  minuteDefault: number | null
  scorerNameDefault: string | null
  assistNameDefault: string | null
}) {
  const [scorer, setScorer] = useState(scorerDefault)
  const assistRoster = useMemo(() => roster.filter((p) => p.value !== scorer), [roster, scorer])

  return (
    <form action={action} className="grid grid-cols-2 md:grid-cols-3 gap-2">
      <input
        className="rounded-lg border border-gray-200 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
        name="minute"
        type="number"
        min={0}
        placeholder="분"
        defaultValue={minuteDefault ?? ''}
      />
      {hasRoster ? (
        <select
          className="rounded-lg border border-gray-200 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
          name="scorer"
          value={scorer}
          onChange={(e) => setScorer(e.target.value)}
        >
          <option value="">득점자 선택</option>
          {roster.map((p) => (
            <option key={p.value} value={p.value}>
              #{p.jerseyNo} {p.playerName}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="rounded-lg border border-gray-200 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
          list="name-suggestions"
          name="scorer"
          placeholder="득점자"
          defaultValue={scorerNameDefault ?? ''}
        />
      )}
      {hasRoster ? (
        <select
          className="rounded-lg border border-gray-200 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
          name="assist"
          defaultValue={assistDefault}
        >
          <option value="">어시스트 선택</option>
          {assistRoster.map((p) => (
            <option key={p.value} value={p.value}>
              #{p.jerseyNo} {p.playerName}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="rounded-lg border border-gray-200 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
          list="name-suggestions"
          name="assist"
          placeholder="어시"
          defaultValue={assistNameDefault ?? ''}
        />
      )}
      <div className="md:col-span-3 flex flex-wrap gap-2 justify-end">
        <button className="rounded-lg border border-gray-200 px-2 py-1 text-xs" type="reset">편집 취소</button>
        <PendingSubmitButton className="rounded-lg border border-gray-200 px-2 py-1 text-xs" pendingText="저장중...">
          이벤트 저장
        </PendingSubmitButton>
      </div>
    </form>
  )
}
