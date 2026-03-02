'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

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

export default function GroupList({
  groups,
  matchesByGroup,
}: {
  groups: MatchGroup[]
  matchesByGroup: Record<string, Match[]>
}) {
  const initialOpen = useMemo(() => new Set(groups.length ? [groups[0].id] : []), [groups])
  const [openSet, setOpenSet] = useState<Set<string>>(initialOpen)

  function toggle(id: string) {
    setOpenSet((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const list = matchesByGroup[g.id] ?? []
        const open = openSet.has(g.id)
        return (
          <section key={g.id} className="rounded border p-3 space-y-2">
            <button
              type="button"
              className="w-full flex items-center justify-between gap-2 text-left"
              onClick={() => toggle(g.id)}
            >
              <h2 className="text-sm font-semibold">{g.title ?? `${g.play_date}${g.venue ? ` · ${g.venue}` : ''}`}</h2>
              <span className="text-xs text-gray-400">{open ? '▼' : '▶'} {list.length}경기</span>
            </button>

            {open ? (
              list.length === 0 ? (
                <p className="text-sm text-gray-500">등록된 경기가 없습니다.</p>
              ) : (
                <ul className="space-y-2">
                  {list.map((m) => (
                    <li key={m.id} className="rounded border px-3 py-2 bg-white">
                      <Link href={`/m/${m.id}`} className="flex items-center justify-between gap-3">
                        <div className="text-sm">
                          <div className="font-medium">{m.seq}경기 · {m.team_a_name} vs {m.team_b_name}</div>
                          <div className="text-xs text-gray-500">상태: {m.status}</div>
                          {m.status === 'scheduled' && m.scheduled_start_at ? (
                            <div className="text-xs text-blue-700">
                              {new Date(m.scheduled_start_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })} 시작 예정
                            </div>
                          ) : null}
                        </div>
                        <div className="text-lg font-semibold tabular-nums">{m.score_a} : {m.score_b}</div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </section>
        )
      })}
    </div>
  )
}
