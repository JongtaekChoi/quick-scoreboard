'use client'

import { useState } from 'react'

export default function ShareChannelButton({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false)

  async function onShare() {
    try {
      if (navigator.share) {
        await navigator.share({ title, url })
        return
      }
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // user canceled share dialog, ignore
    }
  }

  return (
    <button className="rounded border px-2 py-1 text-xs" type="button" onClick={onShare}>
      {copied ? '링크 복사됨' : 'URL 공유'}
    </button>
  )
}
