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
  if (status === 'live') return { text: '진행중', cls: 'bg-emerald-50 text-emerald-700' }
  if (status === 'ended') return { text: '종료', cls: 'bg-gray-100 text-gray-700' }
  return { text: '예정', cls: 'bg-blue-50 text-blue-700' }
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
    <div className="space-y-4">
      {dateKeys.map((dateKey) => {
        const dayGroups = groupsByDate[dateKey] ?? []
        const totalMatches = dayGroups.reduce((sum, g) => sum + (matchesByGroup[g.id]?.length ?? 0), 0)
        const open = openDateSet.has(dateKey)

        return (
          <section key={dateKey} id={`date-${dateKey}`} className="rounded-2xl bg-white p-4 shadow-sm space-y-3">
            <button
              type="button"
              className="sticky top-0 z-10 -mx-1 flex w-[calc(100%+0.5rem)] items-center justify-between gap-2 rounded-lg bg-white/95 px-1 py-1 text-left backdrop-blur"
              onClick={() => toggleDate(dateKey)}
            >
              <h2 className="text-base font-semibold tracking-tight text-gray-900">{dateKey}</h2>
              <span className="text-xs text-gray-500">{open ? '접기' : '열기'} · {totalMatches}경기</span>
            </button>

            {open ? (
              <div className="space-y-2">
                {dayGroups.map((g) => {
                  const list = matchesByGroup[g.id] ?? []
                  return (
                    <section key={g.id} className="space-y-2 rounded-xl bg-gray-50/80 p-3 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.03)]">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-gray-900">{g.title ?? g.venue ?? '경기'}</h3>
                        {showManagerEntryButton ? (
                          <Link className="shrink-0 rounded-full bg-gray-900 px-2.5 py-1 text-xs font-medium text-white" href={`/admin/channel/${channelId}/group/${g.id}?from=channel`}>
                            경기 엔트리 관리
                          </Link>
                        ) : null}
                      </div>

                      {list.length === 0 ? (
                        <p className="text-sm text-gray-500">등록된 경기가 없습니다.</p>
                      ) : (
                        <ul className="divide-y divide-gray-100 rounded-xl bg-white shadow-sm">
                          {list.map((m) => {
                            const badge = statusLabel(m.status)
                            return (
                              <li key={m.id} className="px-3 py-3">
                                <Link href={`/m/${m.id}`} prefetch scroll={false} className="flex items-center justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 text-sm font-semibold leading-tight text-gray-900">
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
                                    <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                                      <span className={`rounded-full px-2 py-0.5 font-medium ${badge.cls}`}>{badge.text}</span>
                                      {m.status === 'scheduled' && m.scheduled_start_at ? (
                                        <span className="text-blue-600">
                                          {new Date(m.scheduled_start_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}
                                        </span>
                                      ) : null}
                                      {g.venue ? <span className="text-gray-400">· {g.venue}</span> : null}
                                    </div>
                                  </div>
                                  <div className="w-16 shrink-0 text-right text-lg font-semibold tabular-nums whitespace-nowrap text-gray-900">
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
