import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase'
import { isAdminAuthorized } from '@/lib/adminAuth'
import { getAccountInfo } from '@/lib/channelSession'
import PendingSubmitButton from '@/components/PendingSubmitButton'

type Channel = { id: string; name: string; slug: string; edit_session_version: number }
type Team = { id: string; name: string }
type TeamPlayer = { id: string; team_id: string; jersey_no: string; player_name: string; is_active: boolean }

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

async function addPlayer(formData: FormData) {
  'use server'
  const channelId = String(formData.get('channelId') || '')
  const teamId = String(formData.get('teamId') || '')
  const jerseyNo = String(formData.get('jersey_no') || '').trim()
  const playerName = String(formData.get('player_name') || '').trim()

  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }

  if (!channelId || !teamId || !jerseyNo || !playerName) return

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  await supabase.from('team_players').upsert(
    {
      channel_id: channelId,
      team_id: teamId,
      jersey_no: jerseyNo,
      player_name: playerName,
      is_active: true,
    },
    { onConflict: 'channel_id,team_id,jersey_no' },
  )

  redirect(`/admin/channel/${channelId}/roster`)
}

async function togglePlayerActive(formData: FormData) {
  'use server'
  const channelId = String(formData.get('channelId') || '')
  const playerId = String(formData.get('playerId') || '')
  const next = String(formData.get('next') || '') === '1'

  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }

  if (!channelId || !playerId) return

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  await supabase.from('team_players').update({ is_active: next }).eq('id', playerId)
  redirect(`/admin/channel/${channelId}/roster`)
}

export default async function AdminRosterPage({ params }: { params: Promise<{ channelId: string }> }) {
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

  const [{ data: teams }, { data: players }] = await Promise.all([
    supabase.from('channel_teams_view').select('id,name').eq('channel_id', channelId).order('name', { ascending: true }).returns<Team[]>(),
    supabase
      .from('team_players')
      .select('id,team_id,jersey_no,player_name,is_active')
      .eq('channel_id', channelId)
      .order('is_active', { ascending: false })
      .order('jersey_no', { ascending: true })
      .returns<TeamPlayer[]>(),
  ])

  const playersByTeam = new Map<string, TeamPlayer[]>()
  for (const p of players ?? []) {
    const arr = playersByTeam.get(p.team_id) ?? []
    arr.push(p)
    playersByTeam.set(p.team_id, arr)
  }

  const totalPlayers = (players ?? []).length
  const totalActivePlayers = (players ?? []).filter((p) => p.is_active).length

  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-5xl mx-auto space-y-5">
        <header className="space-y-1">
          <div className="text-xs text-gray-500 flex items-center gap-1">
            <Link className="underline" href={`/c/${channel.slug}`}>리그 경기목록</Link>
            <span>›</span>
            <Link className="underline" href={`/admin/channel/${channel.id}?from=channel`}>경기그룹 관리</Link>
            <span>›</span>
            <span>팀 멤버 관리</span>
          </div>
          <h1 className="text-2xl font-semibold">팀 멤버 관리</h1>
          <p className="text-sm text-gray-600">{channel.name} · 팀별 등번호/이름 등록</p>
          <p className="text-xs text-gray-500">전체 팀인원: {totalActivePlayers}/{totalPlayers}명 (활성/전체)</p>
        </header>

        {(teams ?? []).length === 0 ? (
          <section className="rounded border p-4 text-sm text-gray-500">먼저 경기 입력을 통해 팀을 생성해 주세요.</section>
        ) : (
          <section className="space-y-3">
            {(teams ?? []).map((t) => {
              const list = playersByTeam.get(t.id) ?? []
              const activeCount = list.filter((p) => p.is_active).length
              return (
                <details key={t.id} className="rounded border p-3" open>
                  <summary className="cursor-pointer list-none flex items-center justify-between gap-2">
                    <span className="font-medium text-sm">{t.name}</span>
                    <span className="text-xs text-gray-500">팀인원 {activeCount}/{list.length}명</span>
                  </summary>

                  <div className="mt-3 space-y-3">
                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold text-gray-700">팀 선수 멤버</h3>
                      <form action={addPlayer} className="grid grid-cols-1 md:grid-cols-4 gap-2">
                        <input type="hidden" name="channelId" value={channel.id} />
                        <input type="hidden" name="teamId" value={t.id} />
                        <input className="rounded border px-2 py-1.5 text-sm" name="jersey_no" placeholder="등번호" required />
                        <input className="rounded border px-2 py-1.5 text-sm" name="player_name" placeholder="이름" required />
                        <PendingSubmitButton className="rounded border px-3 py-2 text-sm" pendingText="저장중...">멤버 추가/수정</PendingSubmitButton>
                      </form>

                      {list.length === 0 ? (
                        <p className="text-xs text-gray-500">등록된 멤버가 없습니다.</p>
                      ) : (
                        <ul className="space-y-1">
                          {list.map((p) => (
                            <li key={p.id} className="rounded border px-2 py-1.5 flex items-center justify-between text-sm">
                              <span>
                                #{p.jersey_no} {p.player_name}
                                {!p.is_active ? <span className="text-xs text-gray-400"> (비활성)</span> : null}
                              </span>
                              <form action={togglePlayerActive}>
                                <input type="hidden" name="channelId" value={channel.id} />
                                <input type="hidden" name="playerId" value={p.id} />
                                <input type="hidden" name="next" value={p.is_active ? '0' : '1'} />
                                <PendingSubmitButton className="text-xs underline" pendingText="처리중...">{p.is_active ? '비활성화' : '활성화'}</PendingSubmitButton>
                              </form>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </div>
                </details>
              )
            })}
          </section>
        )}
      </section>
    </main>
  )
}
