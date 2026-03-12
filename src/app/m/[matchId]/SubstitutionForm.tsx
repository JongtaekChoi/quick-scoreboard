'use client'

import { useMemo, useState } from 'react'
import PendingSubmitButton from '@/components/PendingSubmitButton'

type RosterPlayer = {
  playerId: string
  jerseyNo: string
  playerName: string
  value: string
}

export default function SubstitutionForm({
  action,
  teamAName,
  teamBName,
  activeA,
  benchA,
  activeB,
  benchB,
  disabled,
}: {
  action: (formData: FormData) => void | Promise<void>
  teamAName: string
  teamBName: string
  activeA: RosterPlayer[]
  benchA: RosterPlayer[]
  activeB: RosterPlayer[]
  benchB: RosterPlayer[]
  disabled?: boolean
}) {
  const [teamSide, setTeamSide] = useState<'A' | 'B'>('A')
  const outRoster = useMemo(() => (teamSide === 'A' ? activeA : activeB), [teamSide, activeA, activeB])
  const inRoster = useMemo(() => (teamSide === 'A' ? benchA : benchB), [teamSide, benchA, benchB])

  return (
    <form action={action} className="rounded border p-3 grid md:grid-cols-5 gap-2 items-end">
      <input type="hidden" name="team_side" value={teamSide} />
      <div>
        <label className="block text-xs text-gray-600 mb-1">팀</label>
        <select
          value={teamSide}
          onChange={(e) => setTeamSide(e.target.value as 'A' | 'B')}
          className="w-full rounded border px-2 py-1.5 text-sm"
          disabled={disabled}
        >
          <option value="A">{teamAName}</option>
          <option value="B">{teamBName}</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">분</label>
        <input type="number" name="minute" min={0} max={200} defaultValue={0} className="w-full rounded border px-2 py-1.5 text-sm" disabled={disabled} />
      </div>
      <div className="md:col-span-3">
        <label className="block text-xs text-gray-600 mb-1">나가는 선수(출전중)</label>
        <select name="player_out_value" className="w-full rounded border px-2 py-1.5 text-sm" required disabled={disabled || outRoster.length === 0}>
          <option value="">선수 선택</option>
          {outRoster.map((p) => <option key={`out-${teamSide}-${p.value}`} value={p.value}>{p.playerName}</option>)}
        </select>
      </div>
      <div className="md:col-span-4">
        <label className="block text-xs text-gray-600 mb-1">들어가는 선수(벤치)</label>
        <select name="player_in_value" className="w-full rounded border px-2 py-1.5 text-sm" required disabled={disabled || inRoster.length === 0}>
          <option value="">선수 선택</option>
          {inRoster.map((p) => <option key={`in-${teamSide}-${p.value}`} value={p.value}>{p.playerName}</option>)}
        </select>
      </div>
      <div>
        {disabled || outRoster.length === 0 || inRoster.length === 0 ? (
          <button type="button" className="rounded border px-2 py-1 text-xs opacity-50" disabled>교체</button>
        ) : (
          <PendingSubmitButton className="rounded border px-2 py-1 text-xs">교체</PendingSubmitButton>
        )}
      </div>
    </form>
  )
}
