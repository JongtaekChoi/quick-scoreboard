import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase'
import { isAdminAuthorized } from '@/lib/adminAuth'
import { getAccountInfo, validateManagerAgainstDb } from '@/lib/channelSession'

type Channel = { id: string; name: string; slug: string; edit_session_version: number }
type MatchGroup = { id: string; play_date: string; venue: string | null; title: string | null; seq: number }

async function canManageChannel(channelId: string) {
  const supabase = getSupabaseServerClient()
  if (!supabase) return { allowed: false, channel: null as Channel | null, managerTeamId: null as string | null }

  const { data: channel } = await supabase
    .from('channels')
    .select('id,name,slug,edit_session_version')
    .eq('id', channelId)
    .maybeSingle<Channel>()

  if (!channel) return { allowed: false, channel: null as Channel | null, managerTeamId: null as string | null }

  const isAdmin = await isAdminAuthorized()
  if (isAdmin) return { allowed: true, channel, managerTeamId: null as string | null }

  const account = await getAccountInfo(channel.slug)
  if (account?.role === 'admin') return { allowed: true, channel, managerTeamId: null as string | null }

  const { ok, teamId } = await validateManagerAgainstDb(channel.slug, channel.id)
  return { allowed: ok, channel, managerTeamId: teamId }
}

export default async function ManagerEntriesPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params
  const supabase = getSupabaseServerClient()
  if (!supabase) return <main className="p-6">Supabase env가 필요합니다.</main>

  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }

  if (!manage.managerTeamId) {
    redirect(`/admin/channel/${channelId}?from=channel`)
  }

  const channel = manage.channel
  if (!channel) return <main className="p-6">리그를 찾을 수 없습니다.</main>

  const { data: myTeam } = await supabase
    .from('teams')
    .select('id,name')
    .eq('id', manage.managerTeamId)
    .maybeSingle<{ id: string; name: string }>()

  const { data: myMatches } = await supabase
    .from('matches')
    .select('match_group_id,team_a_id,team_b_id,team_a_name,team_b_name')
    .eq('channel_id', channel.id)
    .not('match_group_id', 'is', null)
    .returns<{
      match_group_id: string | null
      team_a_id: string | null
      team_b_id: string | null
      team_a_name: string
      team_b_name: string
    }[]>()

  const myGroupIds = Array.from(
    new Set(
      (myMatches ?? [])
        .filter((m) => {
          const byId = m.team_a_id === manage.managerTeamId || m.team_b_id === manage.managerTeamId
          const byName = myTeam ? m.team_a_name === myTeam.name || m.team_b_name === myTeam.name : false
          return byId || byName
        })
        .map((m) => m.match_group_id)
        .filter((v): v is string => Boolean(v)),
    ),
  )

  const { data: groups } = myGroupIds.length
    ? await supabase
        .from('match_groups')
        .select('id,play_date,venue,title,seq')
        .eq('channel_id', channel.id)
        .in('id', myGroupIds)
        .order('play_date', { ascending: false })
        .order('seq', { ascending: true })
        .returns<MatchGroup[]>()
    : { data: [] as MatchGroup[] }

  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-5xl mx-auto space-y-5">
        <header className="space-y-1">
          <div className="text-xs text-gray-500 flex items-center gap-1">
            <Link className="underline" href={`/c/${channel.slug}`}>리그 경기목록</Link>
            <span>›</span>
            <span>내 팀 엔트리 관리</span>
          </div>
          <h1 className="text-2xl font-semibold">내 팀 엔트리 관리</h1>
          <p className="text-sm text-gray-600">경기그룹을 선택해 엔트리를 관리하세요.</p>
        </header>

        <section className="space-y-3">
          {(groups ?? []).length === 0 ? (
            <p className="text-sm text-gray-500">경기그룹이 없습니다.</p>
          ) : (
            (groups ?? []).map((g) => (
              <div key={g.id} className="rounded border p-3 flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-sm">{g.title ?? `${g.play_date}${g.venue ? ` · ${g.venue}` : ''}`}</div>
                  <div className="text-xs text-gray-500">{g.play_date} {g.venue ? `· ${g.venue}` : ''}</div>
                </div>
                <Link className="underline text-sm" href={`/admin/channel/${channel.id}/group/${g.id}?from=channel`}>
                  엔트리 관리
                </Link>
              </div>
            ))
          )}
        </section>
      </section>
    </main>
  )
}
