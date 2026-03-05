'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

type MenuItem = { href: string; label: string }

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const isStandalone = pathname === '/admin/login' || pathname === '/admin/auth'

  const channelId = useMemo(() => {
    const m = pathname.match(/^\/admin\/channel\/([^/]+)/)
    return m?.[1] ?? null
  }, [pathname])
  const [channelName, setChannelName] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    if (!channelId) return
    fetch(`/api/admin/channel/${channelId}/meta`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!mounted) return
        setChannelName(json?.name ?? null)
      })
      .catch(() => {
        if (!mounted) return
        setChannelName(null)
      })

    return () => {
      mounted = false
    }
  }, [channelId])

  const commonItems: MenuItem[] = [{ href: '/admin', label: '관리자 홈' }]

  const channelItems: MenuItem[] = channelId
    ? [
        { href: `/admin/channel/${channelId}`, label: '경기그룹 관리' },
        { href: `/admin/channel/${channelId}/teams`, label: '팀 관리' },
        { href: `/admin/channel/${channelId}/roster`, label: '팀 멤버 관리' },
        { href: `/admin/channel/${channelId}/accounts`, label: '계정 관리' },
      ]
    : []

  if (isStandalone) return <>{children}</>

  return (
    <div className="min-h-screen bg-white">
      <div className="md:hidden border-b px-3 py-2 flex items-center justify-between">
        <span className="text-sm font-semibold">운영 관리</span>
        <button
          type="button"
          className="rounded border px-2 py-1 text-xs"
          onClick={() => setOpen((v) => !v)}
        >
          메뉴
        </button>
      </div>

      <div className="mx-auto max-w-7xl md:grid md:grid-cols-[240px_1fr] md:gap-4">
        <aside className={`${open ? 'block' : 'hidden'} md:block border-r bg-gray-50/70`}>
          <div className="p-3 space-y-4 sticky top-0">
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-1">관리</div>
              <nav className="space-y-1">
                {commonItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`block rounded px-2 py-1.5 text-sm ${
                      isActive(pathname, item.href)
                        ? 'bg-gray-900 text-white'
                        : 'text-gray-700 hover:bg-gray-200'
                    }`}
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>

            {channelId ? (
              <div>
                <div className="text-xs font-semibold text-gray-500 mb-1">리그</div>
                <div className="text-xs text-gray-700 mb-2 px-1">{channelName ?? '리그 로딩 중...'}</div>
                <nav className="space-y-1">
                  {channelItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`block rounded px-2 py-1.5 text-sm ${
                        isActive(pathname, item.href)
                          ? 'bg-gray-900 text-white'
                          : 'text-gray-700 hover:bg-gray-200'
                      }`}
                      onClick={() => setOpen(false)}
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
              </div>
            ) : (
              <p className="text-xs text-gray-500">리그 페이지로 이동하면 리그 메뉴가 표시됩니다.</p>
            )}
          </div>
        </aside>

        <main className="min-w-0">{children}</main>
      </div>
    </div>
  )
}
