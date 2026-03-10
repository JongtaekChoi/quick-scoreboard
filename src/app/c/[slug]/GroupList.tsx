'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type MatchGroup = { id: string; channel_id: string; play_date: string; venue: string | null; title: string | null; seq: number }
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
  status: 'scheduled' | 'live' | 'ended'
  scheduled_start_at: string | null
}

function statusLabel(status: Match['status']) {
  if (status === 'live') return { text: '진행중', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
  if (status === 'ended') return { text: '종료', cls: 'bg-gray-100 text-gray-700 border-gray-200' }
  return { text: '예정', cls: 'bg-blue-50 text-blue-700 border-blue-200' }
}

export default function GroupList({
  groups,
  matchesByGroup,
  teamColorById,
  channelId,
  showManagerEntryButton,
}: {
  groups: MatchGroup[]
  matchesByGroup: Record<string, Match[]>
  teamColorById: Record<string, string>
  channelId: string
  showManagerEntryButton: boolean
}) {
  const groupsByDate = groups.reduce<Record<string, MatchGroup[]>>((acc, g) => {
    if (!acc[g.play_date]) acc[g.play_date] = []
    acc[g.play_date].push(g)
    return acc
  }, {})

  const dateKeys = Object.keys(groupsByDate).sort((a, b) => b.localeCompare(a))
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  const initialOpenDate = useMemo(() => {
    const nearestUpcoming = [...dateKeys].sort((a, b) => a.localeCompare(b)).find((d) => d >= todayKey)
    if (nearestUpcoming) return nearestUpcoming
    return dateKeys[0] ?? null
  }, [dateKeys, todayKey])

  const [openDateSet, setOpenDateSet] = useState<Set<string>>(() =>
    new Set(initialOpenDate ? [initialOpenDate] : []),
  )

  useEffect(() => {
    if (!initialOpenDate) return
    const el = document.getElementById(`date-${initialOpenDate}`)
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [initialOpenDate])

  function toggleDate(dateKey: string) {
    setOpenDateSet((prev) => {
      const next = new Set(prev)
      if (next.has(dateKey)) next.delete(dateKey)
      else next.add(dateKey)
      return next
    })
  }

  return (
    <div className="space-y-3">
      {dateKeys.map((dateKey) => {
        const dayGroups = groupsByDate[dateKey] ?? []
        const totalMatches = dayGroups.reduce((sum, g) => sum + (matchesByGroup[g.id]?.length ?? 0), 0)
        const open = openDateSet.has(dateKey)

        return (
          <section key={dateKey} id={`date-${dateKey}`} className="rounded-2xl border bg-white p-3 shadow-sm space-y-2">
            <button
              type="button"
              className="sticky top-0 z-10 -mx-1 flex w-[calc(100%+0.5rem)] items-center justify-between gap-2 rounded-lg bg-white/95 px-1 py-1 text-left backdrop-blur"
              onClick={() => toggleDate(dateKey)}
            >
              <h2 className="text-sm font-semibold text-gray-800">{dateKey}</h2>
              <span className="text-xs text-gray-500">{open ? '▼' : '▶'} {totalMatches}경기</span>
            </button>

            {open ? (
              <div className="space-y-2">
                {dayGroups.map((g) => {
                  const list = matchesByGroup[g.id] ?? []
                  return (
                    <section key={g.id} className="space-y-2 rounded-xl border border-gray-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold">{g.title ?? g.venue ?? '경기'}</h3>
                        {showManagerEntryButton ? (
                          <Link className="shrink-0 rounded-full border px-2 py-1 text-xs text-gray-700" href={`/admin/channel/${channelId}/group/${g.id}?from=channel`}>
                            내 팀 엔트리
                          </Link>
                        ) : null}
                      </div>

                      {list.length === 0 ? (
                        <p className="text-sm text-gray-500">등록된 경기가 없습니다.</p>
                      ) : (
                        <ul className="space-y-2">
                          {list.map((m) => {
                            const badge = statusLabel(m.status)
                            return (
                              <li key={m.id} className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                                <Link href={`/m/${m.id}`} className="flex items-center justify-between gap-3">
                                  <div className="min-w-0 flex-1 text-sm">
                                    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 font-medium leading-tight">
                                      <div className="flex items-center justify-end gap-1.5 text-right break-words">
                                        <span className="inline-block h-2.5 w-2.5 rounded-sm border border-black/10" style={{ backgroundColor: m.team_a_id ? (teamColorById[m.team_a_id] ?? '#D1D5DB') : '#D1D5DB' }} />
                                        <span>{m.team_a_name}</span>
                                      </div>
                                      <div className="px-1 text-[11px] uppercase tracking-[0.12em] text-gray-400">vs</div>
                                      <div className="flex items-center gap-1.5 break-words">
                                        <span className="inline-block h-2.5 w-2.5 rounded-sm border border-black/10" style={{ backgroundColor: m.team_b_id ? (teamColorById[m.team_b_id] ?? '#D1D5DB') : '#D1D5DB' }} />
                                        <span>{m.team_b_name}</span>
                                      </div>
                                    </div>
                                    <div className="mt-1 flex items-center gap-2 text-xs">
                                      <span className={`rounded-full border px-2 py-0.5 ${badge.cls}`}>{badge.text}</span>
                                      {m.status === 'scheduled' && m.scheduled_start_at ? (
                                        <span className="text-blue-700">
                                          {new Date(m.scheduled_start_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}
                                        </span>
                                      ) : null}
                                      {g.venue ? <span className="text-gray-500">· {g.venue}</span> : null}
                                    </div>
                                  </div>
                                  <div className="w-16 shrink-0 text-right text-lg font-semibold tabular-nums whitespace-nowrap">
                                    {m.score_a}
                                    <span className="px-1 text-gray-400">:</span>
                                    {m.score_b}
                                  </div>
                                </Link>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </section>
                  )
                })}
              </div>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}
