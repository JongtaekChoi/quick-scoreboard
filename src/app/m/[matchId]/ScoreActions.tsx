'use client'

import { useTransition } from 'react'

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

  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        className="rounded border bg-black text-white px-4 py-3 text-lg font-semibold disabled:opacity-50"
        disabled={pending}
        onClick={() => startTransition(() => addGoalA())}
      >
        {pending ? <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />저장중...</span> : `${teamAName} +1`}
      </button>
      <button
        type="button"
        className="rounded border bg-black text-white px-4 py-3 text-lg font-semibold disabled:opacity-50"
        disabled={pending}
        onClick={() => startTransition(() => addGoalB())}
      >
        {pending ? <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />저장중...</span> : `${teamBName} +1`}
      </button>
    </div>
  )
}
