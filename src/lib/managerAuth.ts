import { createHash } from 'crypto'
import { cookies } from 'next/headers'

type ManagerSession = { teamId: string; version: number; loginId: string }

function cookieName(slug: string) {
  return `qsb_mgr_${slug}`
}

export function hashManagerPassword(raw: string) {
  return createHash('sha256').update(raw).digest('hex')
}

export async function setManagerCookie(slug: string, session: ManagerSession) {
  const store = await cookies()
  store.set(cookieName(slug), JSON.stringify(session), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  })
}

export async function clearManagerCookie(slug: string) {
  const store = await cookies()
  store.delete(cookieName(slug))
}

export async function getManagerSession(slug: string): Promise<ManagerSession | null> {
  const store = await cookies()
  const raw = store.get(cookieName(slug))?.value
  if (!raw) return null
  try {
    return JSON.parse(raw) as ManagerSession
  } catch {
    return null
  }
}
