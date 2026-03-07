"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type MenuItem = { href: string; label: string };
type ChannelRole = "admin" | "manager" | null;
type AdminChannel = { id: string; name: string };

function isActive(pathname: string, href: string, exact = false) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const isStandalone =
    pathname === "/admin/login" || pathname === "/admin/auth";

  const channelId = useMemo(() => {
    const m = pathname.match(/^\/admin\/channel\/([^/]+)/);
    return m?.[1] ?? null;
  }, [pathname]);
  const [channelRole, setChannelRole] = useState<ChannelRole>(null);
  const [adminChannels, setAdminChannels] = useState<AdminChannel[]>([]);

  useEffect(() => {
    let mounted = true;
    if (!channelId) return;
    fetch(`/api/admin/channel/${channelId}/meta`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!mounted) return;
        setChannelRole((json?.role as ChannelRole) ?? null);
      })
      .catch(() => {
        if (!mounted) return;
        setChannelRole(null);
      });

    return () => {
      mounted = false;
    };
  }, [channelId]);

  useEffect(() => {
    let mounted = true;
    fetch("/api/admin/channels", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!mounted) return;
        setAdminChannels(Array.isArray(json?.channels) ? json.channels : []);
      })
      .catch(() => {
        if (!mounted) return;
        setAdminChannels([]);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const isManagerView = !!channelId && channelRole === "manager";

  const commonItems: MenuItem[] = isManagerView
    ? []
    : [{ href: "/admin", label: "리그 관리" }];

  const channelItems: MenuItem[] = channelId
    ? [
        { href: `/admin/channel/${channelId}`, label: "경기그룹 관리" },
        { href: `/admin/channel/${channelId}/teams`, label: "팀 관리" },
        { href: `/admin/channel/${channelId}/roster`, label: "팀 멤버 관리" },
        { href: `/admin/channel/${channelId}/accounts`, label: "계정 관리" },
      ]
    : [];

  if (isStandalone) return <>{children}</>;

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <div className="md:hidden border-b border-gray-200 bg-white/90 backdrop-blur px-3 py-2 flex items-center justify-between sticky top-0 z-30">
        <span className="text-sm font-semibold tracking-tight">리그 관리</span>
        <button
          type="button"
          className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs hover:bg-gray-50"
          onClick={() => setOpen((v) => !v)}
        >
          메뉴
        </button>
      </div>

      <div className="mx-auto max-w-7xl md:grid md:grid-cols-[260px_1fr] md:gap-5 px-3 md:px-5 py-3 md:py-5">
        <aside className={`${open ? "block" : "hidden"} md:block`}>
          <div className="sticky top-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="p-3 border-b border-gray-100">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                quick-scoreboard
              </p>
              <p className="text-sm font-semibold text-gray-900 mt-0.5">
                리그 관리
              </p>
            </div>

            <div className="p-3 space-y-4">
              {commonItems.length > 0 ? (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5 px-1">
                    관리
                  </div>
                  <nav className="space-y-1">
                    {commonItems.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`block rounded-lg px-2.5 py-2 text-sm transition-colors ${
                          isActive(pathname, item.href, item.href === "/admin")
                            ? "bg-gray-900 text-white shadow-sm"
                            : "text-gray-700 hover:bg-gray-100"
                        }`}
                        onClick={() => setOpen(false)}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </nav>
                </div>
              ) : null}

              {adminChannels.length > 0 ? (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5 px-1">
                    리그
                  </div>
                  <select
                    className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-sm text-gray-700"
                    value={channelId ?? ""}
                    onChange={(e) => {
                      const nextChannelId = e.target.value;
                      if (!nextChannelId) return;
                      setOpen(false);
                      router.push(`/admin/channel/${nextChannelId}?from=admin`);
                    }}
                  >
                    <option value="">리그 선택...</option>
                    {adminChannels.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {channelId ? (
                <div>
                  <nav className="space-y-1">
                    {channelItems.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`block rounded-lg px-2.5 py-2 text-sm transition-colors ${
                          isActive(
                            pathname,
                            item.href,
                            item.href === `/admin/channel/${channelId}`,
                          )
                            ? "bg-gray-900 text-white shadow-sm"
                            : "text-gray-700 hover:bg-gray-100"
                        }`}
                        onClick={() => setOpen(false)}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </nav>
                </div>
              ) : (
                <p className="text-xs text-gray-500 px-1">
                  리그 페이지로 이동하면 리그 메뉴가 표시됩니다.
                </p>
              )}
            </div>
          </div>
        </aside>

        <main className="min-w-0">
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm min-h-[calc(100vh-56px)] md:min-h-[calc(100vh-64px)]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
