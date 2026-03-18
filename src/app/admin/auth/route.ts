import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { clearAdminCookie, setAdminCookie } from '@/lib/adminAuth'

const ADMIN_LOGIN_FEEDBACK_COOKIE = 'qsb_admin_login_feedback'

export async function POST(req: Request) {
  const form = await req.formData()
  const action = String(form.get('action') || 'login')

  if (action === 'logout') {
    await clearAdminCookie()
    return NextResponse.redirect(new URL('/admin/login', req.url))
  }

  const password = String(form.get('password') || '')
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    const store = await cookies()
    store.set(ADMIN_LOGIN_FEEDBACK_COOKIE, 'invalid_password', { path: '/', maxAge: 10, sameSite: 'lax' })
    return NextResponse.redirect(new URL('/admin/login', req.url))
  }

  const store = await cookies()
  for (const c of store.getAll()) {
    if (c.name.startsWith('qsb_') && c.name !== 'qsb_admin') {
      store.delete(c.name)
    }
  }

  await setAdminCookie()
  return NextResponse.redirect(new URL('/admin', req.url))
}
