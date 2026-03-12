"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

type Props = {
  loginId: string;
  role: string;
  slug: string;
  redirectTo?: string;
  accountHref?: string;
};

export default function AccountBadge({ loginId, role, slug, redirectTo, accountHref }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded px-2 py-0.5 border bg-green-50 border-green-200 text-green-700 text-xs cursor-pointer"
      >
        {loginId} ({role})
      </button>
      {open ? (
        <div className="absolute right-0 top-full mt-1 z-30 rounded border bg-white shadow-md py-1 min-w-[130px]">
          {accountHref ? (
            <Link
              href={accountHref}
              className="block px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              onClick={() => setOpen(false)}
            >
              비밀번호 변경
            </Link>
          ) : null}
          <form
            action={`/c/${encodeURIComponent(slug)}/login`}
            method="post"
          >
            <input type="hidden" name="action" value="logout" />
            {redirectTo ? (
              <input type="hidden" name="redirect_to" value={redirectTo} />
            ) : null}
            <button
              className="block w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer"
              type="submit"
            >
              로그아웃
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
