'use client'

import { useMemo, useState } from 'react'
import JerseyBadge from '@/components/JerseyBadge'

type GoalLog = {
  matchId: string
  matchLabel: string
  minute: number | null
  assistLabel: string | null
  createdAt: string
}

type ScorerItem = {
  key: string
  name: string
  team: string
  jersey: string | null
  value: number
  logs: GoalLog[]
}

export default function ScorerRankingWithLogs({ items }: { items: ScorerItem[] }) {
  const [expanded, setExpanded] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)

  const ranked = useMemo(() => {
    return items.reduce<Array<ScorerItem & { rank: number }>>((acc, item, idx) => {
      const prev = acc[idx - 1]
      const rank = prev && prev.value === item.value ? prev.rank : idx + 1
      acc.push({ ...item, rank })
      return acc
    }, [])
  }, [items])

  const visible = expanded ? ranked : ranked.slice(0, 5)
  const active = ranked.find((r) => r.key === openKey) ?? null

  return (
    <>
      <ul className="divide-y divide-gray-100 rounded-xl bg-gray-50/60 px-2 text-sm">
        {visible.map((s, i) => (
          <li key={`${s.key}-${i}`} className="flex justify-between py-2">
            <span>
              {s.rank}. {s.name}
              <span className="text-xs text-gray-500">
                {s.team !== '-' ? (
                  <span className="inline-flex items-center gap-1">
                    <span>({s.team}</span>
                    <JerseyBadge number={s.jersey} />
                    <span>)</span>
                  </span>
                ) : ''}
              </span>
            </span>
            {s.logs.length > 0 ? (
              <button type="button" className="rounded-md bg-gray-900 px-2 py-0.5 text-xs font-semibold text-white" onClick={() => setOpenKey(s.key)}>
                {s.value}
              </button>
            ) : (
              <span className="font-medium">{s.value}</span>
            )}
          </li>
        ))}
      </ul>

      {ranked.length > 5 ? (
        <div className="mt-2">
          {!expanded ? (
            <button type="button" className="text-xs rounded-md bg-gray-100 px-2 py-1 text-gray-600" onClick={() => setExpanded(true)}>
              더보기
            </button>
          ) : (
            <button type="button" className="text-xs rounded-md bg-gray-100 px-2 py-1 text-gray-600" onClick={() => setExpanded(false)}>
              접기
            </button>
          )}
        </div>
      ) : null}

      {active ? (
        <div className="fixed inset-0 z-50 bg-black/40 p-4 flex items-center justify-center" onClick={() => setOpenKey(null)}>
          <div className="w-full max-w-xl rounded-xl bg-white p-4 space-y-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{active.name} 득점 기록</h3>
              <button type="button" className="text-xs rounded-md bg-gray-100 px-2 py-1" onClick={() => setOpenKey(null)}>닫기</button>
            </div>
            <ul className="max-h-80 overflow-auto space-y-1 text-sm">
              {active.logs
                .slice()
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .map((log, idx) => (
                  <li key={`${log.matchId}-${idx}`} className="rounded-lg bg-gray-50 px-2 py-1.5 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs text-gray-700">{log.matchLabel}</div>
                      <div className="text-[11px] text-gray-500">{log.assistLabel ? `어시스트: ${log.assistLabel}` : '어시스트 없음'}</div>
                    </div>
                    <a className="text-xs rounded-md bg-white px-2 py-0.5 shadow-sm" href={`/m/${log.matchId}`}>{log.minute != null ? `${log.minute}'` : '-'}</a>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  )
}
