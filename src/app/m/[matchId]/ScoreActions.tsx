'use client'

import { useTransition } from 'react'

export default function ScoreActions({
  addGoalA,
  addGoalB,
}: {
  addGoalA: () => Promise<void>
  addGoalB: () => Promise<void>
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
        A팀 +1
      </button>
      <button
        type="button"
        className="rounded border bg-black text-white px-4 py-3 text-lg font-semibold disabled:opacity-50"
        disabled={pending}
        onClick={() => startTransition(() => addGoalB())}
      >
        B팀 +1
      </button>
    </div>
  )
}
