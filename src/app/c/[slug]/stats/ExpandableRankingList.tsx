'use client'

import { useMemo, useState } from 'react'

type Item = {
  name: string
  team: string
  jersey: string | null
  value: number
}

export default function ExpandableRankingList({
  items,
  valueLabel,
}: {
  items: Item[]
  valueLabel?: string
}) {
  const [expanded, setExpanded] = useState(false)

  const ranked = useMemo(() => {
    return items.reduce<Array<Item & { rank: number }>>((acc, item, idx) => {
      const prev = acc[idx - 1]
      const rank = prev && prev.value === item.value ? prev.rank : idx + 1
      acc.push({ ...item, rank })
      return acc
    }, [])
  }, [items])

  const visible = expanded ? ranked : ranked.slice(0, 5)

  return (
    <>
      <ul className="space-y-1 text-sm">
        {visible.map((s, i) => (
          <li key={`${s.name}-${s.rank}-${i}`} className="flex justify-between border-b last:border-0 py-1">
            <span>
              {s.rank}. {s.name}
              <span className="text-xs text-gray-500"> {s.team !== '-' ? `(${s.team}${s.jersey ? ` #${s.jersey}` : ''})` : ''}</span>
            </span>
            <span className="font-medium">{s.value}{valueLabel ?? ''}</span>
          </li>
        ))}
      </ul>

      {ranked.length > 5 ? (
        <div className="mt-2">
          {!expanded ? (
            <button type="button" className="text-xs text-gray-600 underline" onClick={() => setExpanded(true)}>
              더보기
            </button>
          ) : (
            <button type="button" className="text-xs text-gray-600 underline" onClick={() => setExpanded(false)}>
              접기
            </button>
          )}
        </div>
      ) : null}
    </>
  )
}
