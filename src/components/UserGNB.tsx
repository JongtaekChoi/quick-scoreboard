"use client";

import Link from 'next/link'
import { ReactNode } from 'react'
import { useRouter } from 'next/navigation'

type TabKey = 'matches' | 'stats' | 'calendar' | 'account'

export default function UserGNB({
  slug,
  channelName,
  current,
  rightActions,
  subtitle,
  isLoggedIn = false,
}: {
  slug?: string | null
  channelName: string
  current: TabKey
  rightActions?: ReactNode
  subtitle?: ReactNode
  isLoggedIn?: boolean
}) {
  const router = useRouter()
  const normalizedSlug = slug?.trim() ?? ''
  const hasSlug = normalizedSlug.length > 0
  const tabs: { key: TabKey; label: string; href: string }[] = hasSlug
    ? [
        { key: 'matches', label: '경기', href: `/c/${encodeURIComponent(normalizedSlug)}` },
        { key: 'stats', label: '통계', href: `/c/${encodeURIComponent(normalizedSlug)}/stats` },
        { key: 'calendar', label: '달력', href: `/c/${encodeURIComponent(normalizedSlug)}/calendar` },
        ...(isLoggedIn
          ? [{ key: 'account' as const, label: '계정', href: `/c/${encodeURIComponent(normalizedSlug)}/account` }]
          : []),
      ]
    : []

  return (
    <header className="sticky top-0 z-20 -mx-4 border-b border-gray-100 bg-white/95 px-4 py-3 backdrop-blur md:mx-0 md:px-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{channelName}</h1>
          {subtitle ? <div className="text-xs text-gray-500 mt-0.5">{subtitle}</div> : null}
        </div>
        <div className="flex items-center gap-2">{rightActions}</div>
      </div>

      {hasSlug ? (
        <nav className="flex flex-wrap items-center gap-1">
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              prefetch
              scroll={false}
              onMouseEnter={() => router.prefetch(tab.href)}
              onFocus={() => router.prefetch(tab.href)}
              className={`rounded-full px-2.5 py-1 text-xs ${current === tab.key ? 'bg-gray-900 text-white font-semibold' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  )
}
