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
    <button
      className={className ?? 'rounded border p-1.5 text-gray-500 hover:bg-gray-50'}
      type="button"
      onClick={onShare}
      aria-label="공유"
      title={copied ? '링크 복사됨' : '공유'}
    >
      {copied ? (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-green-600">
          <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path d="M13 4.5a2.5 2.5 0 1 1 .702 1.737L6.97 9.604a2.518 2.518 0 0 1 0 .799l6.733 3.364a2.5 2.5 0 1 1-.671 1.341l-6.733-3.364a2.5 2.5 0 1 1 0-3.484l6.733-3.364A2.52 2.52 0 0 1 13 4.5Z" />
        </svg>
      )}
    </button>
  )
}
