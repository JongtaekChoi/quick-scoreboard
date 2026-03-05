import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase'
import { hashManagerPassword } from '@/lib/passwordHash'
import { createManagerSession, destroyChannelSession } from '@/lib/channelSession'

type Channel = { id: string; slug: string }
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
    .select('id,slug')
    .eq('slug', slug)
    .maybeSingle<Channel>()

  if (!channel) return NextResponse.redirect(new URL(`/c/${slug}?mgr=notfound`, req.url))

  const { data: account } = await supabase
    .from('team_manager_accounts')
    .select('id,team_id,login_id,password_hash,session_version,is_active')
    .eq('channel_id', channel.id)
    .eq('login_id', loginId)
    .maybeSingle<ManagerAccount>()

  if (!account || !account.is_active || hashManagerPassword(password) !== account.password_hash) {
    return NextResponse.redirect(new URL(`/c/${slug}?mgr=password`, req.url))
  }

  await createManagerSession(slug, { teamId: account.team_id, version: account.session_version, loginId: account.login_id })
  return NextResponse.redirect(new URL(`/c/${slug}?mgr=1`, req.url))
}
