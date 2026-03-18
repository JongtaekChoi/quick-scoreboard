'use client'

import { useEffect, useState } from 'react'

export default function TransientToast({ message, tone = 'error' }: { message: string; tone?: 'error' | 'success' | 'info' }) {
  const [open, setOpen] = useState(true)

  useEffect(() => {
    const t = window.setTimeout(() => setOpen(false), 3500)
    return () => window.clearTimeout(t)
  }, [])

  if (!open) return null

  const cls = tone === 'success'
    ? 'border-green-200 bg-green-50 text-green-800'
    : tone === 'info'
      ? 'border-blue-200 bg-blue-50 text-blue-800'
      : 'border-red-200 bg-red-50 text-red-800'

  return (
    <div className={`fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-lg border px-3 py-2 text-xs shadow ${cls}`}>
      <div className="flex items-center gap-2">
        <span>{message}</span>
        <button type="button" className="underline" onClick={() => setOpen(false)}>닫기</button>
      </div>
    </div>
  )
}
