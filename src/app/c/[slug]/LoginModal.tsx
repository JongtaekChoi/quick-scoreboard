"use client";

import { useState, useEffect } from "react";

export default function LoginModal({
  slug,
  accError,
}: {
  slug: string;
  accError?: boolean;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (accError) setOpen(true);
  }, [accError]);

  return (
    <>
      <button
        className="rounded border px-2 py-1 text-xs"
        type="button"
        onClick={() => setOpen(true)}
      >
        로그인
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 bg-black/30 p-4 flex items-center justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-sm rounded-xl border bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">로그인</h3>
              <button
                className="text-xs underline"
                type="button"
                onClick={() => setOpen(false)}
              >
                닫기
              </button>
            </div>

            {accError ? (
              <p className="text-xs text-red-600">
                계정 정보가 올바르지 않습니다.
              </p>
            ) : null}

            <form
              action={`/c/${encodeURIComponent(slug)}/login`}
              method="post"
              className="space-y-2"
            >
              <input
                className="w-full rounded border px-2 py-1 text-sm"
                name="login_id"
                placeholder="계정 ID"
                required
                autoFocus
              />
              <input
                className="w-full rounded border px-2 py-1 text-sm"
                type="password"
                name="password"
                placeholder="비밀번호"
                required
              />
              <button
                className="w-full rounded border px-2 py-1 text-sm"
                type="submit"
              >
                로그인
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
