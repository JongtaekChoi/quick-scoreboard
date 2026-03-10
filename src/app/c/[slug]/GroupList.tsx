'use client'

import Link from 'next/link'
import { useEffect } from 'react'

type MatchGroup = { id: string; channel_id: string; play_date: string; venue: string | null; title: string | null; seq: number }
type Match = {
  id: string
  match_group_id: string | null
  seq: number
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
  channelId,
  showManagerEntryButton,
}: {
  groups: MatchGroup[]
  matchesByGroup: Record<string, Match[]>
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

  useEffect(() => {
    const el = document.getElementById(`date-${todayKey}`)
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [todayKey])

  return (
    <div className="space-y-4">
      {dateKeys.map((dateKey) => (
        <section key={dateKey} id={`date-${dateKey}`} className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">{dateKey}</h2>

          {groupsByDate[dateKey].map((g) => {
            const list = matchesByGroup[g.id] ?? []
            return (
              <section key={g.id} className="space-y-2 rounded-2xl border bg-white p-3 shadow-sm">
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
                        <li key={m.id} className="rounded-xl border bg-white px-3 py-2">
                          <Link href={`/m/${m.id}`} className="flex items-center justify-between gap-3">
                            <div className="text-sm">
                              <div className="font-medium">{m.team_a_name} vs {m.team_b_name}</div>
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
                            <div className="text-lg font-semibold tabular-nums">{m.score_a} : {m.score_b}</div>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )
          })}
        </section>
      ))}
    </div>
  )
}
