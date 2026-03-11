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
  rosterA,
  rosterB,
}: {
  action: (formData: FormData) => void | Promise<void>
  teamAName: string
  teamBName: string
  rosterA: RosterPlayer[]
  rosterB: RosterPlayer[]
}) {
  const [teamSide, setTeamSide] = useState<'A' | 'B'>('A')
  const roster = useMemo(() => (teamSide === 'A' ? rosterA : rosterB), [teamSide, rosterA, rosterB])

  return (
    <form action={action} className="rounded border p-3 grid md:grid-cols-5 gap-2 items-end">
      <input type="hidden" name="team_side" value={teamSide} />
      <div>
        <label className="block text-xs text-gray-600 mb-1">팀</label>
        <select
          value={teamSide}
          onChange={(e) => setTeamSide(e.target.value as 'A' | 'B')}
          className="w-full rounded border px-2 py-1.5 text-sm"
        >
          <option value="A">{teamAName}</option>
          <option value="B">{teamBName}</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">분</label>
        <input type="number" name="minute" min={0} max={200} defaultValue={0} className="w-full rounded border px-2 py-1.5 text-sm" />
      </div>
      <div className="md:col-span-3">
        <label className="block text-xs text-gray-600 mb-1">나가는 선수</label>
        <select name="player_out_value" className="w-full rounded border px-2 py-1.5 text-sm" required>
          <option value="">선수 선택</option>
          {roster.map((p) => (
            <option key={`out-${teamSide}-${p.value}`} value={p.value}>{p.playerName}</option>
          ))}
        </select>
      </div>
      <div className="md:col-span-4">
        <label className="block text-xs text-gray-600 mb-1">들어가는 선수</label>
        <select name="player_in_value" className="w-full rounded border px-2 py-1.5 text-sm" required>
          <option value="">선수 선택</option>
          {roster.map((p) => (
            <option key={`in-${teamSide}-${p.value}`} value={p.value}>{p.playerName}</option>
          ))}
        </select>
      </div>
      <div>
        <PendingSubmitButton className="rounded border px-2 py-1 text-xs">교체</PendingSubmitButton>
      </div>
    </form>
  )
}
