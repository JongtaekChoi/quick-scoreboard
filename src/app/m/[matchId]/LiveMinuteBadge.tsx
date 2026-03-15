'use client'

import { useEffect, useMemo, useState } from 'react'

export default function LiveMinuteBadge({
  periodState,
  firstHalfStartedAt,
  secondHalfStartedAt,
  firstHalfBaseMinute,
}: {
  periodState: 'pre' | 'first_half' | 'halftime' | 'second_half' | 'ended'
  firstHalfStartedAt: string | null
  secondHalfStartedAt: string | null
  firstHalfBaseMinute: number
}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (periodState !== 'first_half' && periodState !== 'second_half') return
    const timer = window.setInterval(() => setNow(Date.now()), 15000)
    return () => window.clearInterval(timer)
  }, [periodState])

  const text = useMemo(() => {
    const start = periodState === 'first_half' ? firstHalfStartedAt : periodState === 'second_half' ? secondHalfStartedAt : null
    if (!start) return null
    const elapsed = Math.max(0, Math.floor((now - new Date(start).getTime()) / 60000))
    const minute = periodState === 'second_half' ? firstHalfBaseMinute + elapsed : elapsed
    return `${minute}분`
  }, [periodState, firstHalfStartedAt, secondHalfStartedAt, firstHalfBaseMinute, now])

  if (!text) return null
  return <span>{` · ${text}`}</span>
}
