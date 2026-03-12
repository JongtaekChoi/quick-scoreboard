'use client'

import { useState } from 'react'
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
}: {
  actionA: (formData: FormData) => void | Promise<void>
  actionB: (formData: FormData) => void | Promise<void>
  teamAName: string
  teamBName: string
  rosterA: RosterPlayer[]
  rosterB: RosterPlayer[]
  defaultMinute: number
}) {
  const [open, setOpen] = useState<'A' | 'B' | null>(null)
  const roster = open === 'A' ? rosterA : rosterB
  const teamName = open === 'A' ? teamAName : teamBName
  const action = open === 'A' ? actionA : actionB

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="rounded border bg-black text-white px-4 py-3 text-lg font-semibold" onClick={() => setOpen('A')}>
          {teamAName} +1
        </button>
        <button type="button" className="rounded border bg-black text-white px-4 py-3 text-lg font-semibold" onClick={() => setOpen('B')}>
          {teamBName} +1
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setOpen(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">득점 입력 · {teamName}</h3>
              <button type="button" className="text-xs underline" onClick={() => setOpen(null)}>닫기</button>
            </div>
            <form action={action} className="space-y-2">
              <div>
                <label className="block text-xs text-gray-600 mb-1">분</label>
                <input name="minute" type="number" min={0} max={200} defaultValue={defaultMinute} className="w-full rounded border px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">득점 선수</label>
                <select name="scorer" className="w-full rounded border px-2 py-1.5 text-sm">
                  <option value="">선수 선택</option>
                  {roster.map((p) => <option key={`s-${p.value}`} value={p.value}>{p.playerName}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">어시스트 선수</label>
                <select name="assist" className="w-full rounded border px-2 py-1.5 text-sm">
                  <option value="">없음</option>
                  {roster.map((p) => <option key={`a-${p.value}`} value={p.value}>{p.playerName}</option>)}
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
