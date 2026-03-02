'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ReadonlyAutoRefresh({ enabled, intervalMs = 5000 }: { enabled: boolean; intervalMs?: number }) {
  const router = useRouter()

  useEffect(() => {
    if (!enabled) return
    const t = setInterval(() => {
      router.refresh()
    }, intervalMs)
    return () => clearInterval(t)
  }, [enabled, intervalMs, router])

  return null
}
