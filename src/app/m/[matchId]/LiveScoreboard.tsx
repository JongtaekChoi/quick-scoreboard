'use client'

import { useCallback, useEffect, useState } from 'react'

type Goal = {
  id: string
  team_side: 'A' | 'B'
  minute: number | null
  scorer_name: string | null
  scorer_no: string | null
  created_at: string
}

type MatchMini = {
  id: string
  team_a_name: string
  team_b_name: string
  score_a: number
  score_b: number
}

export default function LiveScoreboard({
  matchId,
  initialMatch,
  initialGoals,
  readonly,
}: {
  matchId: string
  initialMatch: MatchMini
  initialGoals: Goal[]
  readonly: boolean
}) {
  const [match, setMatch] = useState(initialMatch)
  const [goals, setGoals] = useState(initialGoals)
  const [autoUpdate, setAutoUpdate] = useState(false)
  const [countdown, setCountdown] = useState(10)
  const [refreshing, setRefreshing] = useState(false)

  const refreshScoreboard = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await fetch(`/api/matches/${matchId}/scoreboard`, { cache: 'no-store' })
      if (!res.ok) return
      const json = (await res.json()) as { match: MatchMini; goals: Goal[] }
      setMatch(json.match)
      setGoals(json.goals)
      setCountdown(10)
    } finally {
      setRefreshing(false)
    }
  }, [matchId])

  useEffect(() => {
    if (!readonly || !autoUpdate) return
    const t = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          void refreshScoreboard()
          return 10
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [readonly, autoUpdate, refreshScoreboard])

  return (
    <section className="sticky top-0 z-10 rounded border p-4 space-y-3 bg-white/95 backdrop-blur">
      {readonly ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-gray-600">자동 업데이트</span>
            <input type="checkbox" checked={autoUpdate} onChange={(e) => setAutoUpdate(e.target.checked)} />
          </label>
          <button className="rounded border px-2 py-1 text-xs" type="button" onClick={() => void refreshScoreboard()}>
            {autoUpdate ? `${countdown}초 후` : ''} {refreshing ? '갱신 중...' : '↻ 새로고침'}
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3">
        <div className="text-right space-y-1">
          <div className="text-lg font-semibold">{match.team_a_name}</div>
        </div>
        <div className="text-3xl font-bold tabular-nums">{match.score_a} : {match.score_b}</div>
        <div className="space-y-1">
          <div className="text-lg font-semibold">{match.team_b_name}</div>
        </div>
      </div>

      <div className="rounded border p-2 space-y-1">
        {goals.length === 0 ? (
          <p className="text-xs text-gray-500">득점 이벤트 없음</p>
        ) : (
          goals.map((g) => {
            const who = g.scorer_name ?? g.scorer_no ?? '-'
            return (
              <div key={g.id} className="grid grid-cols-[1fr_auto_1fr] items-center text-xs gap-2">
                <div className="text-right">{g.team_side === 'A' ? who : ''}</div>
                <div className="text-gray-500">{g.minute !== null ? `${g.minute}’` : '-'}</div>
                <div>{g.team_side === 'B' ? who : ''}</div>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
