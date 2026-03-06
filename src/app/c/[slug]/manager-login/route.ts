import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase'
import { hashAccountPassword } from '@/lib/passwordHash'
import { createAccountSession, destroyChannelSession } from '@/lib/channelSession'

type Channel = { id: string; slug: string; edit_session_version: number }
type ManagerAccount = { id: string; team_id: string; login_id: string; password_hash: string; session_version: number; is_active: boolean }

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const form = await req.formData()
  const loginId = String(form.get('login_id') || '').trim()
  const password = String(form.get('password') || '').trim()
  const action = String(form.get('action') || 'login')

  const supabase = getSupabaseServerClient()
  if (!supabase) return NextResponse.redirect(new URL(`/c/${slug}?mgr=env`, req.url))

  if (action === 'logout') {
    await destroyChannelSession(slug)
    return NextResponse.redirect(new URL(`/c/${slug}`, req.url))
  }

  const { data: channel } = await supabase
    .from('channels')
    .select('id,slug,edit_session_version')
    .eq('slug', slug)
    .maybeSingle<Channel>()

  if (!channel) return NextResponse.redirect(new URL(`/c/${slug}?mgr=notfound`, req.url))

  const { data: account } = await supabase
    .from('channel_accounts')
    .select('id,team_id,login_id,password_hash,session_version,is_active')
    .eq('channel_id', channel.id)
    .eq('login_id', loginId)
    .eq('role', 'manager')
    .maybeSingle<ManagerAccount>()

  if (!account || !account.is_active || hashAccountPassword(password) !== account.password_hash) {
    return NextResponse.redirect(new URL(`/c/${slug}?mgr=password`, req.url))
  }

  await createAccountSession(slug, {
    loginId: account.login_id,
    role: 'manager',
    teamId: account.team_id,
    version: account.session_version,
    editVersion: channel.edit_session_version,
  })
  return NextResponse.redirect(new URL(`/c/${slug}?mgr=1`, req.url))
}
