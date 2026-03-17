'use client'

import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import PendingSubmitButton from '@/components/PendingSubmitButton'
import GoalEditForm from './GoalEditForm'

type RosterPlayer = { playerId: string; jerseyNo: string; playerName: string; value: string }

export default function GoalEditModal({
  teamSide,
  minute,
  scorerName,
  assistName,
  roster,
  hasRoster,
  scorerDefault,
  assistDefault,
  updateAction,
  deleteAction,
}: {
  teamSide: 'A' | 'B'
  minute: number | null
  scorerName: string | null
  assistName: string | null
  roster: RosterPlayer[]
  hasRoster: boolean
  scorerDefault: string
  assistDefault: string
  updateAction: (formData: FormData) => void | Promise<void>
  deleteAction: (formData: FormData) => void | Promise<void>
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(true)

  function closeModal() {
    setOpen(false)
    const qs = new URLSearchParams(searchParams.toString())
    qs.delete('goal')
    router.replace(`${pathname}?${qs.toString()}`, { scroll: false })
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={closeModal}>
      <div className="w-full max-w-xl rounded-xl bg-white p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 text-sm text-gray-700">
          <span>
            골 이벤트 편집 · {teamSide}팀 · {minute !== null ? `${minute}분` : '시간 미설정'}
          </span>
          <button type="button" className="text-xs underline text-gray-500" onClick={closeModal}>닫기</button>
        </div>

        <GoalEditForm
          action={updateAction}
          roster={roster}
          hasRoster={hasRoster}
          scorerDefault={scorerDefault}
          assistDefault={assistDefault}
          minuteDefault={minute}
          scorerNameDefault={scorerName}
          assistNameDefault={assistName}
        />

        <form action={deleteAction}>
          <PendingSubmitButton className="rounded-lg border border-red-200 text-red-700 px-2 py-1 text-xs" pendingText="삭제중...">
            이벤트 삭제
          </PendingSubmitButton>
        </form>
      </div>
    </div>
  )
}
