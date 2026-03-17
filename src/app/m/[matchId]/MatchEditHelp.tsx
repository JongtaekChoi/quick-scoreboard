"use client";

import { useState } from "react";

const HIDE_KEY = "qsb_match_edit_help_hidden_v1";

export default function MatchEditHelp({
  isEditMode,
  canStartPeriod,
  startPeriodLabel,
}: {
  isEditMode: boolean;
  canStartPeriod: boolean;
  startPeriodLabel: string | null;
}) {
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(HIDE_KEY) !== "1";
  });
  const [dontShowAgain, setDontShowAgain] = useState(false);

  function closeModal() {
    if (dontShowAgain && typeof window !== "undefined") {
      window.localStorage.setItem(HIDE_KEY, "1");
    }
    setOpen(false);
  }

  if (!isEditMode) return null;

  return (
    <>
      <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 flex flex-wrap items-center gap-2 justify-between">
        <div>
          {canStartPeriod ? (
            <span>
              <span className="font-semibold text-emerald-700">{startPeriodLabel ?? "1P 시작"}</span>
              <span> 버튼을 먼저 눌러야 기록을 시작할 수 있습니다.</span>
            </span>
          ) : (
            <span>도움말에서 기록 순서를 확인할 수 있습니다.</span>
          )}
        </div>
        <button
          type="button"
          className="rounded border border-blue-300 bg-white px-2 py-0.5 text-[11px]"
          onClick={() => setOpen(true)}
        >
          ? 사용 안내
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={closeModal}>
          <div className="w-full max-w-xl rounded-xl bg-white p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold">경기 기록 빠른 안내</h3>
            <div className="rounded bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 space-y-1.5">
              <p>💡 골을 기록하려면 검은색 골 버튼(+1)을 누르세요.</p>
              <p>경기 시작 시간을 기준으로 현재 경과 시간이 기본 입력되며, 수동으로 변경할 수 있습니다.</p>
              <p>득점자/어시스트를 모르면 일단 저장하고 나중에 수정해도 됩니다.</p>
              <p>첫 구간 종료 시 <span className="font-semibold">1P 종료</span>, 다음 구간 시작 시 <span className="font-semibold">2P 시작</span>을 눌러 재개해 주세요.</p>
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={dontShowAgain} onChange={(e) => setDontShowAgain(e.target.checked)} />
              다시 보지 않기
            </label>
            <div className="flex justify-end">
              <button type="button" className="rounded border px-3 py-1.5 text-xs" onClick={closeModal}>확인</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
