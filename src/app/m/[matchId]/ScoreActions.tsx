'use client'

import { useState, useTransition } from 'react'

export default function ScoreActions({
  addGoalA,
  addGoalB,
  teamAName,
  teamBName,
}: {
  addGoalA: () => Promise<void>
  addGoalB: () => Promise<void>
  teamAName: string
  teamBName: string
}) {
  const [pending, startTransition] = useTransition()
  const [pendingSide, setPendingSide] = useState<'A' | 'B' | null>(null)

  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        className="rounded border bg-black text-white px-4 py-3 text-lg font-semibold disabled:opacity-50"
        disabled={pending}
        onClick={() => {
          setPendingSide('A')
          startTransition(async () => {
            await addGoalA()
            setPendingSide(null)
          })
        }}
      >
        {pending && pendingSide === 'A' ? <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />저장중...</span> : `${teamAName} +1`}
      </button>
      <button
        type="button"
        className="rounded border bg-black text-white px-4 py-3 text-lg font-semibold disabled:opacity-50"
        disabled={pending}
        onClick={() => {
          setPendingSide('B')
          startTransition(async () => {
            await addGoalB()
            setPendingSide(null)
          })
        }}
      >
        {pending && pendingSide === 'B' ? <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />저장중...</span> : `${teamBName} +1`}
      </button>
    </div>
  )
}
