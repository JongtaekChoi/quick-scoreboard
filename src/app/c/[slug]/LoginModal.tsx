"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

export default function LoginModal({
  slug,
  accError,
  redirectTo,
  triggerLabel = "로그인",
  triggerClassName = "rounded border px-2 py-1 text-xs",
}: {
  slug: string;
  accError?: boolean;
  redirectTo?: string;
  triggerLabel?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(!!accError);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const modal = open ? (
        <div
          className="fixed inset-0 z-[100] bg-black/40 p-4 flex items-center justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-sm rounded-xl border bg-white p-4 space-y-3 shadow-xl">
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
              onSubmit={() => setIsSubmitting(true)}
            >
              {redirectTo ? <input type="hidden" name="redirect_to" value={redirectTo} /> : null}
              <input
                className="w-full rounded border px-2 py-1 text-base"
                name="login_id"
                placeholder="계정 ID"
                required
                autoFocus
              />
              <input
                className="w-full rounded border px-2 py-1 text-base"
                type="password"
                name="password"
                placeholder="비밀번호"
                required
              />
              <button
                className="w-full rounded border px-2 py-1 text-sm disabled:opacity-60"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? "로그인중..." : "로그인"}
              </button>
            </form>
          </div>
        </div>
      ) : null;

  return (
    <>
      <button
        className={triggerClassName}
        type="button"
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </button>
      {typeof document !== "undefined" ? createPortal(modal, document.body) : null}
    </>
  );
}
