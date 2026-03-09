import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { getSupabaseServerClient } from '@/lib/supabase'

export type ChannelSessionData = {
  loginId: string | null
  role: 'admin' | 'manager' | 'player'
  teamId: string | null
  version: number
  editVersion: number | null
  mustChangePassword: boolean
  source: 'account'
}

function cookieName(slug: string) {
  return `qsb_${slug}`
}

function getSessionOptions(slug: string) {
  const sessionPassword =
    process.env.SESSION_SECRET ||
    'dev-only-session-secret-change-this-to-32chars-min';

  return {
    password: sessionPassword,
    cookieName: cookieName(slug),
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 12,
    },
  }
}

export async function getChannelSession(slug: string) {
  const store = await cookies()
  return getIronSession<ChannelSessionData>(store, getSessionOptions(slug))
}

export async function createAccountSession(
  slug: string,
  data: { loginId: string; role: 'admin' | 'manager' | 'player'; teamId: string | null; version: number; editVersion: number | null; mustChangePassword?: boolean },
) {
  const session = await getChannelSession(slug)
  session.loginId = data.loginId
  session.role = data.role
  session.teamId = data.teamId
  session.version = data.version
  session.editVersion = data.editVersion
  session.mustChangePassword = !!data.mustChangePassword
  session.source = 'account'
  await session.save()
}

export async function destroyChannelSession(slug: string) {
  const session = await getChannelSession(slug)
  session.destroy()
}

export async function getSessionData(slug: string): Promise<ChannelSessionData | null> {
  const session = await getChannelSession(slug)
  if (!session.source) return null
  return {
    loginId: session.loginId,
    role: session.role,
    teamId: session.teamId,
    version: session.version,
    editVersion: session.editVersion,
    mustChangePassword: !!session.mustChangePassword,
    source: session.source,
  }
}

export async function isEditAuthorized(slug: string, currentEditVersion: number): Promise<boolean> {
  const data = await getSessionData(slug)
  if (!data) return false
  if (data.role === 'admin') return true
  if (data.role === 'manager' || data.role === 'player') {
    if (data.editVersion === currentEditVersion) return true
  }
  return false
}

export async function getManagerInfo(slug: string): Promise<{ loginId: string; teamId: string; version: number } | null> {
  const data = await getSessionData(slug)
  if (!data) return null
  if (data.role !== 'manager') return null
  if (!data.loginId || !data.teamId) return null
  return { loginId: data.loginId, teamId: data.teamId, version: data.version }
}

export async function getAccountInfo(slug: string): Promise<{ loginId: string; role: 'admin' | 'manager' | 'player'; teamId: string | null; version: number; mustChangePassword: boolean } | null> {
  const data = await getSessionData(slug)
  if (!data) return null
  if (!data.loginId) return null
  return { loginId: data.loginId, role: data.role, teamId: data.teamId, version: data.version, mustChangePassword: !!data.mustChangePassword }
}

export async function validateManagerAgainstDb(
  slug: string,
  channelId: string,
): Promise<{ ok: boolean; teamId: string | null }> {
  const mgr = await getManagerInfo(slug)
  if (!mgr) return { ok: false, teamId: null }

  const supabase = getSupabaseServerClient()
  if (!supabase) return { ok: false, teamId: null }

  const { data: account } = await supabase
    .from('channel_accounts')
    .select('team_id,session_version,is_active')
    .eq('channel_id', channelId)
    .eq('login_id', mgr.loginId)
    .eq('role', 'manager')
    .maybeSingle<{ team_id: string; session_version: number; is_active: boolean }>()

  const ok = !!account && account.is_active && account.team_id === mgr.teamId && account.session_version === mgr.version
  return { ok, teamId: ok ? account.team_id : null }
}
