import { createHash } from 'crypto'
import { cookies } from 'next/headers'

export type AccountSession = {
  loginId: string
  role: 'admin' | 'editor' | 'manager'
  teamId: string | null
  version: number
}

function cookieName(slug: string) {
  return `qsb_account_${slug}`
}

export function hashAccountPassword(raw: string) {
  return createHash('sha256').update(raw).digest('hex')
}

export async function setAccountCookie(slug: string, session: AccountSession) {
  const store = await cookies()
  store.set(cookieName(slug), JSON.stringify(session), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  })
}

export async function getAccountCookie(slug: string): Promise<AccountSession | null> {
  const store = await cookies()
  const raw = store.get(cookieName(slug))?.value
  if (!raw) return null
  try {
    return JSON.parse(raw) as AccountSession
  } catch {
    return null
  }
}

export async function clearAccountCookie(slug: string) {
  const store = await cookies()
  store.delete(cookieName(slug))
}
