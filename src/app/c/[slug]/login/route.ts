import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase'
import { clearAccountCookie, hashAccountPassword, setAccountCookie } from '@/lib/accountAuth'
import { clearEditCookie, setEditCookie } from '@/lib/editAuth'
import { clearManagerCookie, setManagerCookie } from '@/lib/managerAuth'
import { clearAdminCookie, setAdminCookie } from '@/lib/adminAuth'

type Channel = { id: string; slug: string; edit_session_version: number }
type ChannelAccount = {
  id: string
  role: 'admin' | 'editor' | 'manager'
  login_id: string
  password_hash: string
  team_id: string | null
  session_version: number
  is_active: boolean
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const form = await req.formData()
  const loginId = String(form.get('login_id') || '').trim()
  const password = String(form.get('password') || '').trim()
  const action = String(form.get('action') || 'login')

  const supabase = getSupabaseServerClient()
  if (!supabase) return NextResponse.redirect(new URL(`/c/${slug}?acc=env`, req.url))

  if (action === 'logout') {
    await clearAccountCookie(slug)
    await clearEditCookie(slug)
    await clearManagerCookie(slug)
    await clearAdminCookie()
    return NextResponse.redirect(new URL(`/c/${slug}`, req.url))
  }

  const { data: channel } = await supabase
    .from('channels')
    .select('id,slug,edit_session_version')
    .eq('slug', slug)
    .maybeSingle<Channel>()

  if (!channel) return NextResponse.redirect(new URL(`/c/${slug}?acc=notfound`, req.url))

  const { data: account } = await supabase
    .from('channel_accounts')
    .select('id,role,login_id,password_hash,team_id,session_version,is_active')
    .eq('channel_id', channel.id)
    .eq('login_id', loginId)
    .maybeSingle<ChannelAccount>()

  if (!account || !account.is_active || hashAccountPassword(password) !== account.password_hash) {
    return NextResponse.redirect(new URL(`/c/${slug}?acc=password`, req.url))
  }

  await setAccountCookie(slug, {
    loginId: account.login_id,
    role: account.role,
    teamId: account.team_id,
    version: account.session_version,
  })

  if (account.role === 'admin') {
    await setAdminCookie()
  } else {
    await clearAdminCookie()
  }

  if (account.role === 'manager' || account.role === 'admin' || account.role === 'editor') {
    await setEditCookie(slug, channel.edit_session_version)
  } else {
    await clearEditCookie(slug)
  }

  if (account.role === 'manager' && account.team_id) {
    await setManagerCookie(slug, { teamId: account.team_id, version: account.session_version, loginId: account.login_id })
  } else {
    await clearManagerCookie(slug)
  }

  return NextResponse.redirect(new URL(`/c/${slug}?acc=1`, req.url))
}
