import { createHash } from 'crypto'
import { cookies } from 'next/headers'

export function hashEditPassword(raw: string) {
  return createHash('sha256').update(raw).digest('hex')
}

function cookieName(slug: string) {
  return `qsb_edit_${slug}`
}

export async function isEditAuthorized(slug: string, version: number) {
  const store = await cookies()
  const token = store.get(cookieName(slug))?.value
  return token === String(version)
}

export async function setEditCookie(slug: string, version: number) {
  const store = await cookies()
  store.set(cookieName(slug), String(version), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })
}

export async function clearEditCookie(slug: string) {
  const store = await cookies()
  store.delete(cookieName(slug))
}
