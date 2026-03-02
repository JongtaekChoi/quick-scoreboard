import { NextResponse } from 'next/server'
import { clearAdminCookie, setAdminCookie } from '@/lib/adminAuth'

export async function POST(req: Request) {
  const form = await req.formData()
  const action = String(form.get('action') || 'login')

  if (action === 'logout') {
    await clearAdminCookie()
    return NextResponse.redirect(new URL('/admin/login', req.url))
  }

  const password = String(form.get('password') || '')
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.redirect(new URL('/admin/login?err=1', req.url))
  }

  await setAdminCookie()
  return NextResponse.redirect(new URL('/admin', req.url))
}
