'use client'

import { useMemo, useState } from 'react'

type TeamStat = {
  key: string
  team: string
  played: number
  win: number
  draw: number
  loss: number
  gf: number
  ga: number
  gd: number
  pts: number
}

type Match = {
  id: string
  match_group_id: string | null
  seq: number
  team_a_id: string | null
  team_b_id: string | null
  team_a_name: string
  team_b_name: string
  score_a: number
  score_b: number
}

type Goal = {
  match_id: string
  minute: number | null
  created_at: string
  scorer_player_id: string | null
  assist_player_id: string | null
  scorer_name: string | null
  assist_name: string | null
  team_side?: 'A' | 'B'
}

type PlayerRow = { id: string; player_name: string; team_id: string; jersey_no: string | null }
type GroupRow = { id: string; play_date: string; title: string | null; seq: number }

export default function TeamRankingWithDetailModal({
  teamStats,
  matches,
  goals,
  players,
  groups,
  teamColorById,
}: {
  teamStats: TeamStat[]
  matches: Match[]
  goals: Goal[]
  players: PlayerRow[]
  groups: GroupRow[]
  teamColorById: Record<string, string>
}) {
  const [openKey, setOpenKey] = useState<string | null>(null)

  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])

  const selectedTeam = teamStats.find((t) => t.key === openKey) ?? null

  const detailRows = useMemo(() => {
    if (!selectedTeam) return []

    const isByName = selectedTeam.key.startsWith('name:')
    const teamId = isByName ? null : selectedTeam.key

    return matches
      .map((m) => {
        const isA = teamId
          ? m.team_a_id === teamId
          : m.team_a_name === selectedTeam.team
        const isB = teamId
          ? m.team_b_id === teamId
          : m.team_b_name === selectedTeam.team
        if (!isA && !isB) return null

        const side: 'A' | 'B' = isA ? 'A' : 'B'
        const opponent = isA ? m.team_b_name : m.team_a_name
        const scored = isA ? m.score_a : m.score_b
        const conceded = isA ? m.score_b : m.score_a

        const matchGoals = goals
          .filter((g) => g.match_id === m.id && g.team_side === side)
          .sort((a, b) => {
            const ma = a.minute ?? 999
            const mb = b.minute ?? 999
            if (ma !== mb) return ma - mb
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          })
          .map((g) => {
            const scorer = g.scorer_player_id
              ? playerById.get(g.scorer_player_id)
              : null
            const assist = g.assist_player_id
              ? playerById.get(g.assist_player_id)
              : null
            return {
              minute: g.minute,
              scorer: scorer
                ? `${scorer.jersey_no ? `#${scorer.jersey_no} ` : ''}${scorer.player_name}`
                : (g.scorer_name ?? '-'),
              assist: assist
                ? `${assist.jersey_no ? `#${assist.jersey_no} ` : ''}${assist.player_name}`
                : g.assist_name,
            }
          })

        const group = m.match_group_id ? groupById.get(m.match_group_id) : null

        return {
          id: m.id,
          seq: m.seq,
          playDate: group?.play_date ?? '',
          groupTitle: group?.title ?? null,
          opponent,
          scored,
          conceded,
          goals: matchGoals,
        }
      })
      .filter(Boolean)
      .sort((a, b) => {
        const da = a!.playDate
        const db = b!.playDate
        if (da !== db) return db.localeCompare(da)
        return b!.seq - a!.seq
      })
  }, [selectedTeam, matches, goals, playerById, groupById])

  return (
    <>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left border-b border-gray-100 text-xs text-gray-500">
              <th className="py-1 pr-2">순위</th>
              <th className="py-1 pr-2">팀</th>
              <th className="py-1 pr-2">경기</th>
              <th className="py-1 pr-2">승</th>
              <th className="py-1 pr-2">무</th>
              <th className="py-1 pr-2">패</th>
              <th className="py-1 pr-2">득점</th>
              <th className="py-1 pr-2">실점</th>
              <th className="py-1 pr-2">득실</th>
              <th className="py-1 pr-2">승점</th>
            </tr>
          </thead>
          <tbody>
            {teamStats.map((t, i) => (
              <tr key={t.key} className="border-b border-gray-100 last:border-0">
                <td className="py-1 pr-2">{i + 1}</td>
                <td className="py-1 pr-2">
                  <button type="button" className="inline-flex items-center gap-1.5 hover:underline" onClick={() => setOpenKey(t.key)}>
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm border border-black/10"
                      style={{ backgroundColor: t.key.startsWith('name:') ? '#D1D5DB' : (teamColorById[t.key] ?? '#D1D5DB') }}
                    />
                    <span>{t.team}</span>
                  </button>
                </td>
                <td className="py-1 pr-2">{t.played}</td>
                <td className="py-1 pr-2">{t.win}</td>
                <td className="py-1 pr-2">{t.draw}</td>
                <td className="py-1 pr-2">{t.loss}</td>
                <td className="py-1 pr-2">{t.gf}</td>
                <td className="py-1 pr-2">{t.ga}</td>
                <td className="py-1 pr-2">{t.gd}</td>
                <td className="py-1 pr-2 font-semibold">{t.pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedTeam ? (
        <div className="fixed inset-0 z-50 bg-black/40 p-4 flex items-center justify-center" onClick={() => setOpenKey(null)}>
          <div className="w-full max-w-2xl rounded-xl bg-white p-4 space-y-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{selectedTeam.team} 경기 상세</h3>
              <button type="button" className="text-xs rounded-md bg-gray-100 px-2 py-1" onClick={() => setOpenKey(null)}>닫기</button>
            </div>

            {detailRows.length === 0 ? (
              <p className="text-sm text-gray-500">기록이 없습니다.</p>
            ) : (
              <ul className="max-h-[70vh] overflow-auto space-y-2">
                {detailRows.map((row) => (
                  <li key={row!.id} className="rounded-lg bg-gray-50 p-3 space-y-1.5">
                    <div className="text-xs text-gray-500">{row!.playDate} · {row!.seq}경기 {row!.groupTitle ? `· ${row!.groupTitle}` : ''}</div>
                    <div className="text-sm font-semibold text-gray-900">vs {row!.opponent} · {row!.scored}:{row!.conceded}</div>
                    {row!.goals.length === 0 ? (
                      <div className="text-xs text-gray-500">득점 기록 없음</div>
                    ) : (
                      <ul className="divide-y divide-gray-200 rounded-md bg-white px-2">
                        {row!.goals.map((g, idx) => (
                          <li key={`${row!.id}-${idx}`} className="py-1.5 text-xs text-gray-700">
                            {g.minute != null ? `${g.minute}' ` : ''}
                            득점: {g.scorer}
                            {g.assist ? ` · 어시: ${g.assist}` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </>
  )
}
