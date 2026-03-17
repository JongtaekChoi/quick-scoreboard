'use client'

import { useEffect, useMemo, useState } from 'react'
import PendingSubmitButton from '@/components/PendingSubmitButton'
import GoalEditForm from './GoalEditForm'

type RosterPlayer = { playerId: string; jerseyNo: string; playerName: string; value: string }
type GoalItem = {
  id: string
  team_side: 'A' | 'B'
  minute: number | null
  scorer_player_id: string | null
  scorer_name: string | null
  assist_player_id: string | null
  assist_name: string | null
}

export default function GoalEditModal({
  goals,
  rosterA,
  rosterB,
  updateAction,
  deleteAction,
}: {
  goals: GoalItem[]
  rosterA: RosterPlayer[]
  rosterB: RosterPlayer[]
  updateAction: (formData: FormData) => void | Promise<void>
  deleteAction: (formData: FormData) => void | Promise<void>
}) {
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<{ id?: string }>
      const id = custom.detail?.id
      if (id) setSelectedGoalId(id)
    }
    window.addEventListener('qsb:goal-select', handler as EventListener)
    return () => window.removeEventListener('qsb:goal-select', handler as EventListener)
  }, [])

  const activeGoal = useMemo(
    () => (selectedGoalId ? goals.find((g) => g.id === selectedGoalId) ?? null : null),
    [goals, selectedGoalId],
  )

  const roster = activeGoal?.team_side === 'A' ? rosterA : rosterB
  const hasRoster = (roster?.length ?? 0) > 0

  const findRosterValue = (playerId: string | null, playerName: string | null) => {
    if (!roster) return playerName ?? ''
    if (playerId) {
      const byId = roster.find((p) => p.playerId === playerId)
      if (byId) return byId.value
    }
    if (playerName) {
      const byName = roster.find((p) => p.playerName === playerName)
      if (byName) return byName.value
    }
    return playerName ?? ''
  }

  if (!activeGoal) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setSelectedGoalId(null)}>
      <div className="w-full max-w-xl rounded-xl bg-white p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 text-sm text-gray-700">
          <span>
            골 이벤트 편집 · {activeGoal.team_side}팀 · {activeGoal.minute !== null ? `${activeGoal.minute}분` : '시간 미설정'}
          </span>
          <button type="button" className="text-xs underline text-gray-500" onClick={() => setSelectedGoalId(null)}>닫기</button>
        </div>

        <GoalEditForm
          action={updateAction}
          roster={roster}
          hasRoster={hasRoster}
          scorerDefault={findRosterValue(activeGoal.scorer_player_id, activeGoal.scorer_name)}
          assistDefault={findRosterValue(activeGoal.assist_player_id, activeGoal.assist_name)}
          minuteDefault={activeGoal.minute}
          scorerNameDefault={activeGoal.scorer_name}
          assistNameDefault={activeGoal.assist_name}
          goalId={activeGoal.id}
        />

        <form action={deleteAction}>
          <input type="hidden" name="goalId" value={activeGoal.id} />
          <input type="hidden" name="teamSide" value={activeGoal.team_side} />
          <PendingSubmitButton className="rounded-lg border border-red-200 text-red-700 px-2 py-1 text-xs" pendingText="삭제중...">
            이벤트 삭제
          </PendingSubmitButton>
        </form>
      </div>
    </div>
  )
}
