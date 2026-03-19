import Link from 'next/link'
import { ReactNode } from 'react'

type TabKey = 'matches' | 'stats' | 'calendar' | 'account'

export default function UserGNB({
  slug,
  channelName,
  current,
  rightActions,
  subtitle,
}: {
  slug: string
  channelName: string
  current: TabKey
  rightActions?: ReactNode
  subtitle?: ReactNode
}) {
  const tabs: { key: TabKey; label: string; href: string }[] = [
    { key: 'matches', label: '경기', href: `/c/${encodeURIComponent(slug)}` },
    { key: 'stats', label: '통계', href: `/c/${encodeURIComponent(slug)}/stats` },
    { key: 'calendar', label: '달력', href: `/c/${encodeURIComponent(slug)}/calendar` },
    { key: 'account', label: '계정', href: `/c/${encodeURIComponent(slug)}/account` },
  ]

  return (
    <header className="sticky top-0 z-20 rounded-2xl border bg-white/95 p-4 shadow-sm backdrop-blur space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{channelName}</h1>
          {subtitle ? <div className="text-xs text-gray-500 mt-0.5">{subtitle}</div> : null}
        </div>
        <div className="flex items-center gap-2">{rightActions}</div>
      </div>

      <nav className="flex flex-wrap items-center gap-1">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={`rounded-full px-2.5 py-1 text-xs border ${current === tab.key ? 'border-black text-black bg-gray-50 font-semibold' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </header>
  )
}
