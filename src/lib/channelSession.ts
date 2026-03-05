import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { getSupabaseServerClient } from '@/lib/supabase'

export type ChannelSessionData = {
  loginId: string | null
  role: 'admin' | 'editor' | 'manager' | 'edit-only'
  teamId: string | null
  version: number
  editVersion: number | null
  source: 'account' | 'manager-account' | 'edit'
}

function cookieName(slug: string) {
  return `qsb_${slug}`
}

function getSessionOptions(slug: string) {
  return {
    password: process.env.SESSION_SECRET!,
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
  data: { loginId: string; role: 'admin' | 'editor' | 'manager'; teamId: string | null; version: number; editVersion: number | null },
) {
  const session = await getChannelSession(slug)
  session.loginId = data.loginId
  session.role = data.role
  session.teamId = data.teamId
  session.version = data.version
  session.editVersion = data.editVersion
  session.source = 'account'
  await session.save()
}

export async function createManagerSession(
  slug: string,
  data: { loginId: string; teamId: string; version: number },
) {
  const session = await getChannelSession(slug)
  session.loginId = data.loginId
  session.role = 'manager'
  session.teamId = data.teamId
  session.version = data.version
  session.editVersion = null
  session.source = 'manager-account'
  await session.save()
}

export async function createEditSession(slug: string, editVersion: number) {
  const session = await getChannelSession(slug)
  session.loginId = null
  session.role = 'edit-only'
  session.teamId = null
  session.version = 0
  session.editVersion = editVersion
  session.source = 'edit'
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
    source: session.source,
  }
}

export async function isEditAuthorized(slug: string, currentEditVersion: number): Promise<boolean> {
  const data = await getSessionData(slug)
  if (!data) return false
  if (data.role === 'admin' || data.role === 'editor') return true
  if (data.role === 'edit-only') return data.editVersion === currentEditVersion
  if (data.role === 'manager') {
    if (data.source === 'account' && data.editVersion === currentEditVersion) return true
  }
  return false
}

export async function getManagerInfo(slug: string): Promise<{ loginId: string; teamId: string; version: number; source: 'account' | 'manager-account' } | null> {
  const data = await getSessionData(slug)
  if (!data) return null
  if (data.role !== 'manager') return null
  if (!data.loginId || !data.teamId) return null
  if (data.source !== 'account' && data.source !== 'manager-account') return null
  return { loginId: data.loginId, teamId: data.teamId, version: data.version, source: data.source }
}

export async function getAccountInfo(slug: string): Promise<{ loginId: string; role: 'admin' | 'editor' | 'manager'; teamId: string | null; version: number } | null> {
  const data = await getSessionData(slug)
  if (!data) return null
  if (data.source !== 'account') return null
  if (!data.loginId) return null
  if (data.role === 'edit-only') return null
  return { loginId: data.loginId, role: data.role as 'admin' | 'editor' | 'manager', teamId: data.teamId, version: data.version }
}

export async function validateManagerAgainstDb(
  slug: string,
  channelId: string,
): Promise<{ ok: boolean; teamId: string | null }> {
  const mgr = await getManagerInfo(slug)
  if (!mgr) return { ok: false, teamId: null }

  const supabase = getSupabaseServerClient()
  if (!supabase) return { ok: false, teamId: null }

  const table = mgr.source === 'manager-account' ? 'team_manager_accounts' : 'channel_accounts'

  let query = supabase
    .from(table)
    .select('team_id,session_version,is_active')
    .eq('channel_id', channelId)
    .eq('login_id', mgr.loginId)

  if (mgr.source === 'account') {
    query = query.eq('role', 'manager')
  }

  const { data: account } = await query.maybeSingle<{ team_id: string; session_version: number; is_active: boolean }>()

  const ok = !!account && account.is_active && account.team_id === mgr.teamId && account.session_version === mgr.version
  return { ok, teamId: ok ? account.team_id : null }
}
