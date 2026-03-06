import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase'
import { isAdminAuthorized } from '@/lib/adminAuth'
import { getAccountInfo } from '@/lib/channelSession'
import { ensureTeamInChannel } from '@/lib/teamHelpers'
import ImportTeamForm from './ImportTeamForm'

type Channel = { id: string; name: string; slug: string; edit_session_version: number }
type Team = { id: string; name: string; last_used_at: string }
type OtherChannelTeam = { channel_id: string; id: string; name: string }
type OtherChannel = { id: string; name: string }

async function canManageChannel(channelId: string) {
  const supabase = getSupabaseServerClient()
  if (!supabase) return { allowed: false, channel: null as Channel | null }

  const { data: channel } = await supabase
    .from('channels')
    .select('id,name,slug,edit_session_version')
    .eq('id', channelId)
    .maybeSingle<Channel>()

  if (!channel) return { allowed: false, channel: null as Channel | null }

  const isAdmin = await isAdminAuthorized()
  if (isAdmin) return { allowed: true, channel }

  const account = await getAccountInfo(channel.slug)
  if (account?.role === 'admin') return { allowed: true, channel }

  return { allowed: false, channel }
}

async function createTeam(formData: FormData) {
  'use server'
  const channelId = String(formData.get('channelId') || '')
  const name = String(formData.get('name') || '').trim()

  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }

  if (!channelId || !name) return

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  await ensureTeamInChannel(supabase, channelId, name)

  redirect(`/admin/channel/${channelId}/teams`)
}

async function renameTeam(formData: FormData) {
  'use server'
  const channelId = String(formData.get('channelId') || '')
  const teamId = String(formData.get('teamId') || '')
  const name = String(formData.get('name') || '').trim()

  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }

  if (!channelId || !teamId || !name) return

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  await supabase.from('teams').update({ name }).eq('id', teamId)
  await supabase
    .from('channel_teams')
    .update({ last_used_at: new Date().toISOString() })
    .eq('channel_id', channelId)
    .eq('team_id', teamId)
  redirect(`/admin/channel/${channelId}/teams`)
}

async function importTeam(formData: FormData) {
  'use server'
  const channelId = String(formData.get('channelId') || '')
  const sourceChannelId = String(formData.get('sourceChannelId') || '')
  const teamId = String(formData.get('teamId') || '')

  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }

  if (!channelId || !sourceChannelId || !teamId) return

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  // 1. channel_teams junction에 연결 (upsert)
  await supabase.from('channel_teams').upsert(
    { channel_id: channelId, team_id: teamId, last_used_at: new Date().toISOString() },
    { onConflict: 'channel_id,team_id' },
  )

  // 2. 소스 채널의 team_players를 현재 채널로 복사
  const { data: sourcePlayers } = await supabase
    .from('team_players')
    .select('jersey_no,player_name,is_active')
    .eq('channel_id', sourceChannelId)
    .eq('team_id', teamId)
    .returns<{ jersey_no: string; player_name: string; is_active: boolean }[]>()

  if (sourcePlayers && sourcePlayers.length > 0) {
    await supabase.from('team_players').upsert(
      sourcePlayers.map((p) => ({
        channel_id: channelId,
        team_id: teamId,
        jersey_no: p.jersey_no,
        player_name: p.player_name,
        is_active: p.is_active,
      })),
      { onConflict: 'channel_id,team_id,jersey_no' },
    )
  }

  redirect(`/admin/channel/${channelId}/teams`)
}

export default async function AdminChannelTeamsPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params

  const supabase = getSupabaseServerClient()
  if (!supabase) return <main className="p-6">Supabase env가 필요합니다.</main>

  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }

  const channel = manage.channel
  if (!channel) return <main className="p-6">리그를 찾을 수 없습니다.</main>

  const [{ data: teams }, { data: allChannels }, { data: allChannelTeams }] = await Promise.all([
    supabase
      .from('channel_teams_view')
      .select('id,name,last_used_at')
      .eq('channel_id', channelId)
      .order('name', { ascending: true })
      .returns<Team[]>(),
    supabase
      .from('channels')
      .select('id,name')
      .neq('id', channelId)
      .order('name', { ascending: true })
      .returns<OtherChannel[]>(),
    supabase
      .from('channel_teams_view')
      .select('channel_id,id,name')
      .neq('channel_id', channelId)
      .order('name', { ascending: true })
      .returns<OtherChannelTeam[]>(),
  ])

  const channelNameMap = new Map((allChannels ?? []).map((c) => [c.id, c.name]))
  const otherChannelTeams = (allChannelTeams ?? []).map((ct) => ({
    channelId: ct.channel_id,
    channelName: channelNameMap.get(ct.channel_id) ?? '',
    teamId: ct.id,
    teamName: ct.name,
  }))

  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-5xl mx-auto space-y-5">
        <header className="space-y-1">
          <div className="text-xs text-gray-500 flex items-center gap-1">
            <Link className="underline" href={`/c/${channel.slug}`}>리그 경기목록</Link>
            <span>›</span>
            <Link className="underline" href={`/admin/channel/${channel.id}?from=channel`}>경기그룹 관리</Link>
            <span>›</span>
            <span>팀 관리</span>
          </div>
          <h1 className="text-2xl font-semibold">팀 관리</h1>
          <p className="text-sm text-gray-600">{channel.name} · 팀 등록/이름 수정</p>
        </header>

        <section className="rounded border p-4 space-y-2">
          <h2 className="text-sm font-semibold">팀 추가</h2>
          <form action={createTeam} className="grid md:grid-cols-3 gap-2">
            <input type="hidden" name="channelId" value={channel.id} />
            <input className="rounded border px-2 py-1.5 text-sm" name="name" placeholder="팀명" required />
            <button className="rounded border px-3 py-2 text-sm" type="submit">팀 저장</button>
          </form>
        </section>

        <ImportTeamForm
          channelId={channel.id}
          otherChannelTeams={otherChannelTeams}
          importTeam={importTeam}
        />

        <section className="space-y-2">
          {(teams ?? []).length === 0 ? (
            <p className="text-sm text-gray-500">등록된 팀이 없습니다.</p>
          ) : (
            (teams ?? []).map((t) => (
              <div key={t.id} className="rounded border p-3 space-y-2">
                <div className="text-xs text-gray-500">최근 사용: {new Date(t.last_used_at).toLocaleString('ko-KR')}</div>
                <form action={renameTeam} className="flex flex-wrap gap-2 items-center">
                  <input type="hidden" name="channelId" value={channel.id} />
                  <input type="hidden" name="teamId" value={t.id} />
                  <input className="rounded border px-2 py-1.5 text-sm" name="name" defaultValue={t.name} required />
                  <button className="rounded border px-2 py-1.5 text-xs" type="submit">이름 저장</button>
                </form>
              </div>
            ))
          )}
        </section>
      </section>
    </main>
  )
}
