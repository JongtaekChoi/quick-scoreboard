import { cookies } from 'next/headers'

const ADMIN_COOKIE = 'qsb_admin'

export async function isAdminAuthorized() {
  const pw = process.env.ADMIN_PASSWORD
  if (!pw) return false
  const store = await cookies()
  return store.get(ADMIN_COOKIE)?.value === '1'
}

export async function setAdminCookie() {
  const store = await cookies()
  store.set(ADMIN_COOKIE, '1', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  })
}

export async function clearAdminCookie() {
  const store = await cookies()
  store.delete(ADMIN_COOKIE)
}
