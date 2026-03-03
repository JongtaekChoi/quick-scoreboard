'use client'

import type { ReactNode } from 'react'
import { useFormStatus } from 'react-dom'

type Props = {
  children: ReactNode
  pendingText?: string
  className?: string
}

export default function PendingSubmitButton({ children, pendingText = '처리중...', className }: Props) {
  const { pending } = useFormStatus()

  return (
    <button className={className} type="submit" disabled={pending}>
      {pending ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {pendingText}
        </span>
      ) : (
        children
      )}
    </button>
  )
}
