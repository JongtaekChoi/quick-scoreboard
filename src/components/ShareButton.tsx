'use client'

import { useState } from 'react'

export default function ShareButton({ url, title, className }: { url: string; title: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  async function onShare() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
      if (navigator.share) {
        await navigator.share({ title, url })
      }
    } catch {
      // ignore cancel/permission issues
    }
  }

  return (
    <button className={className ?? 'rounded border px-2 py-1 text-xs'} type="button" onClick={onShare}>
      {copied ? '링크 복사됨' : '공유'}
    </button>
  )
}
