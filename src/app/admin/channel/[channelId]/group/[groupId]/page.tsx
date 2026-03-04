import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseServerClient } from '@/lib/supabase'
import { isAdminAuthorized } from '@/lib/adminAuth'
import { isEditAuthorized } from '@/lib/editAuth'
import { getManagerSession } from '@/lib/managerAuth'

type Channel = { id: string; name: string; slug: string; edit_session_version: number }
type MatchGroup = {
  id: string
  play_date: string
  venue: string | null
  title: string | null
  seq: number
  entry_confirmed_at: string | null
}
type Match = { id: string; seq: number; team_a_name: string; team_b_name: string; score_a: number; score_b: number; status: 'scheduled' | 'live' | 'ended'; scheduled_start_at: string | null }
type Team = { id: string; name: string }
type TeamPlayer = { id: string; team_id: string; jersey_no: string; player_name: string; is_active: boolean }
type GroupEntry = { id: string; team_id: string; player_id: string }

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

  const isEditor = await isEditAuthorized(channel.slug, channel.edit_session_version)
  if (isEditor) return { allowed: true, channel, managerTeamId: null as string | null }

  const mgr = await getManagerSession(channel.slug)
  if (!mgr) return { allowed: false, channel, managerTeamId: null as string | null }

  const { data: account } = await supabase
    .from('team_manager_accounts')
    .select('team_id,session_version,is_active')
    .eq('channel_id', channel.id)
    .eq('login_id', mgr.loginId)
    .maybeSingle<{ team_id: string; session_version: number; is_active: boolean }>()

  const ok = !!account && account.is_active && account.team_id === mgr.teamId && account.session_version === mgr.version
  return { allowed: ok, channel, managerTeamId: ok ? account.team_id : null }
}

function toDateTimeLocalValue(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 16)
}

async function createMatch(formData: FormData) {
  'use server'
  const channelId = String(formData.get('channelId') || '')
  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }
  const groupId = String(formData.get('groupId') || '')
  const teamA = String(formData.get('team_a_name') || '').trim()
  const teamB = String(formData.get('team_b_name') || '').trim()
  if (!channelId || !groupId || !teamA || !teamB) return

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  const { data: lastMatch } = await supabase
    .from('matches')
    .select('seq')
    .eq('match_group_id', groupId)
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle<{ seq: number }>()

  const nextSeq = (lastMatch?.seq ?? 0) + 1

  await supabase.from('matches').insert({
    channel_id: channelId,
    match_group_id: groupId,
    seq: nextSeq,
    team_a_name: teamA,
    team_b_name: teamB,
    score_a: 0,
    score_b: 0,
    status: 'scheduled',
  })

  await supabase.from('teams').upsert(
    [
      { channel_id: channelId, name: teamA, last_used_at: new Date().toISOString() },
      { channel_id: channelId, name: teamB, last_used_at: new Date().toISOString() },
    ],
    { onConflict: 'channel_id,name' },
  )

  redirect(`/admin/channel/${channelId}/group/${groupId}`)
}

async function updateMatch(formData: FormData) {
  'use server'
  const channelId = String(formData.get('channelId') || '')
  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }
  const groupId = String(formData.get('groupId') || '')
  const matchId = String(formData.get('matchId') || '')
  const teamA = String(formData.get('team_a_name') || '').trim()
  const teamB = String(formData.get('team_b_name') || '').trim()
  const status = String(formData.get('status') || 'scheduled') as 'scheduled' | 'live' | 'ended'
  const scheduledStartRaw = String(formData.get('scheduled_start_at') || '').trim()
  const scheduledStartAt = scheduledStartRaw ? new Date(`${scheduledStartRaw}:00+09:00`).toISOString() : null
  if (!channelId || !groupId || !matchId || !teamA || !teamB) return

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  await supabase
    .from('matches')
    .update({
      team_a_name: teamA,
      team_b_name: teamB,
      status,
      scheduled_start_at: status === 'ended' ? null : scheduledStartAt,
    })
    .eq('id', matchId)

  await supabase.from('teams').upsert(
    [
      { channel_id: channelId, name: teamA, last_used_at: new Date().toISOString() },
      { channel_id: channelId, name: teamB, last_used_at: new Date().toISOString() },
    ],
    { onConflict: 'channel_id,name' },
  )

  redirect(`/admin/channel/${channelId}/group/${groupId}`)
}

async function deleteMatch(formData: FormData) {
  'use server'
  const channelId = String(formData.get('channelId') || '')
  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }
  const groupId = String(formData.get('groupId') || '')
  const matchId = String(formData.get('matchId') || '')
  if (!channelId || !groupId || !matchId) return

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  await supabase.from('goal_events').update({ deleted_at: new Date().toISOString() }).eq('match_id', matchId)
  await supabase.from('matches').delete().eq('id', matchId)

  redirect(`/admin/channel/${channelId}/group/${groupId}`)
}

async function addGroupEntry(formData: FormData) {
  'use server'
  const channelId = String(formData.get('channelId') || '')
  const groupId = String(formData.get('groupId') || '')
  const teamId = String(formData.get('teamId') || '')
  const playerId = String(formData.get('playerId') || '')

  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }

  if (!channelId || !groupId || !teamId || !playerId) return
  if (manage.managerTeamId && manage.managerTeamId !== teamId) {
    redirect(`/admin/channel/${channelId}/group/${groupId}?err=team_scope`)
  }

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  await supabase
    .from('match_group_entries')
    .upsert(
      { channel_id: channelId, match_group_id: groupId, team_id: teamId, player_id: playerId },
      { onConflict: 'match_group_id,team_id,player_id' },
    )

  redirect(`/admin/channel/${channelId}/group/${groupId}`)
}

async function removeGroupEntry(formData: FormData) {
  'use server'
  const channelId = String(formData.get('channelId') || '')
  const groupId = String(formData.get('groupId') || '')
  const entryId = String(formData.get('entryId') || '')
  const teamId = String(formData.get('teamId') || '')

  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }

  if (!channelId || !groupId || !entryId) return
  if (manage.managerTeamId && manage.managerTeamId !== teamId) {
    redirect(`/admin/channel/${channelId}/group/${groupId}?err=team_scope`)
  }

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  await supabase.from('match_group_entries').delete().eq('id', entryId)
  redirect(`/admin/channel/${channelId}/group/${groupId}`)
}

async function toggleEntryConfirm(formData: FormData) {
  'use server'
  const channelId = String(formData.get('channelId') || '')
  const groupId = String(formData.get('groupId') || '')
  const next = String(formData.get('next') || '')

  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }

  if (!channelId || !groupId) return
  if (manage.managerTeamId) {
    redirect(`/admin/channel/${channelId}/group/${groupId}?err=forbidden`)
  }

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  await supabase
    .from('match_groups')
    .update({ entry_confirmed_at: next === '1' ? new Date().toISOString() : null })
    .eq('id', groupId)

  redirect(`/admin/channel/${channelId}/group/${groupId}`)
}

export default async function AdminGroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ channelId: string; groupId: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const { channelId, groupId } = await params
  const { from } = await searchParams
  const fromChannel = from === 'channel'
  const supabase = getSupabaseServerClient()
  if (!supabase) return <main className="p-6">Supabase env가 필요합니다.</main>

  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }

  const channel = manage.channel
  const [{ data: group }, { data: matches }, { data: teams }, { data: players }, { data: entries }] = await Promise.all([
    supabase.from('match_groups').select('id,play_date,venue,title,seq,entry_confirmed_at').eq('id', groupId).maybeSingle<MatchGroup>(),
    supabase.from('matches').select('id,seq,team_a_name,team_b_name,score_a,score_b,status,scheduled_start_at').eq('match_group_id', groupId).order('seq', { ascending: true }).returns<Match[]>(),
    supabase.from('teams').select('id,name').eq('channel_id', channelId).order('last_used_at', { ascending: false }).limit(50).returns<Team[]>(),
    supabase.from('team_players').select('id,team_id,jersey_no,player_name,is_active').eq('channel_id', channelId).eq('is_active', true).order('jersey_no', { ascending: true }).returns<TeamPlayer[]>(),
    supabase.from('match_group_entries').select('id,team_id,player_id').eq('match_group_id', groupId).returns<GroupEntry[]>(),
  ])

  if (!channel || !group) return <main className="p-6">채널/그룹을 찾을 수 없습니다.</main>

  const playersByTeam = new Map<string, TeamPlayer[]>()
  for (const p of players ?? []) {
    const arr = playersByTeam.get(p.team_id) ?? []
    arr.push(p)
    playersByTeam.set(p.team_id, arr)
  }

  const entriesByTeam = new Map<string, GroupEntry[]>()
  for (const e of entries ?? []) {
    const arr = entriesByTeam.get(e.team_id) ?? []
    arr.push(e)
    entriesByTeam.set(e.team_id, arr)
  }

  const playerMap = new Map((players ?? []).map((p) => [p.id, p]))

  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-5xl mx-auto space-y-5">
        <header className="space-y-1">
          <div className="text-xs text-gray-500 flex items-center gap-1">
            <Link className="underline" href={fromChannel ? `/c/${channel.slug}` : '/admin'}>
              {fromChannel ? '채널 경기목록' : '관리자 홈'}
            </Link>
            <span>›</span>
            <Link className="underline" href={`/admin/channel/${channel.id}?from=${fromChannel ? 'channel' : 'admin'}`}>
              경기그룹 관리
            </Link>
            <span>›</span>
            <span>경기 관리</span>
          </div>
          <h1 className="text-2xl font-semibold">경기 관리</h1>
          <p className="text-sm text-gray-600">{group.title ?? `${group.play_date} 그룹 ${group.seq}`} · {group.play_date} {group.venue ? `· ${group.venue}` : ''}</p>
        </header>

        <section className="rounded border p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">쿼터 엔트리(=경기그룹 엔트리)</h2>
            <form action={toggleEntryConfirm}>
              <input type="hidden" name="channelId" value={channel.id} />
              <input type="hidden" name="groupId" value={group.id} />
              <input type="hidden" name="next" value={group.entry_confirmed_at ? '0' : '1'} />
              <button className="rounded border px-3 py-1.5 text-xs" type="submit">
                {group.entry_confirmed_at ? '엔트리 확정 해제' : '엔트리 확정'}
              </button>
            </form>
          </div>
          <p className="text-xs text-gray-500">
            상태: {group.entry_confirmed_at ? `확정됨 (${new Date(group.entry_confirmed_at).toLocaleString('ko-KR')})` : '미확정'}
          </p>

          {(teams ?? []).length === 0 ? (
            <p className="text-xs text-gray-500">팀이 없습니다. 먼저 경기를 추가해 팀을 생성해줘.</p>
          ) : (
            <div className="space-y-3">
              {(teams ?? []).map((t) => {
                const teamPlayers = playersByTeam.get(t.id) ?? []
                const teamEntries = entriesByTeam.get(t.id) ?? []
                return (
                  <div key={t.id} className="rounded border p-2 space-y-2">
                    <div className="font-medium text-sm">{t.name}</div>
                    <form action={addGroupEntry} className="flex flex-wrap gap-2 items-center">
                      <input type="hidden" name="channelId" value={channel.id} />
                      <input type="hidden" name="groupId" value={group.id} />
                      <input type="hidden" name="teamId" value={t.id} />
                      <select className="rounded border px-2 py-1.5 text-sm" name="playerId" required>
                        <option value="">선수 선택</option>
                        {teamPlayers.map((p) => (
                          <option key={p.id} value={p.id}>#{p.jersey_no} {p.player_name}</option>
                        ))}
                      </select>
                      <button className="rounded border px-2 py-1.5 text-xs" type="submit">엔트리 추가</button>
                    </form>

                    {teamEntries.length === 0 ? (
                      <p className="text-xs text-gray-500">등록 엔트리 없음</p>
                    ) : (
                      <ul className="space-y-1">
                        {teamEntries.map((e) => {
                          const p = playerMap.get(e.player_id)
                          return (
                            <li key={e.id} className="rounded border px-2 py-1 text-xs flex items-center justify-between">
                              <span>{p ? `#${p.jersey_no} ${p.player_name}` : '삭제된 선수'}</span>
                              <form action={removeGroupEntry}>
                                <input type="hidden" name="channelId" value={channel.id} />
                                <input type="hidden" name="groupId" value={group.id} />
                                <input type="hidden" name="teamId" value={t.id} />
                                <input type="hidden" name="entryId" value={e.id} />
                                <button className="underline" type="submit">제거</button>
                              </form>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <datalist id="team-suggestions">
          {(teams ?? []).map((t) => (
            <option key={t.id} value={t.name} />
          ))}
        </datalist>

        <section className="rounded border p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">경기 추가</h2>
            <Link className="text-xs underline" href={`/admin/channel/${channel.id}/teams`}>팀 관리는 별도 화면에서</Link>
          </div>
          <form action={createMatch} className="grid md:grid-cols-4 gap-2">
            <input type="hidden" name="channelId" value={channel.id} />
            <input type="hidden" name="groupId" value={group.id} />
            <input className="rounded border px-2 py-1.5 text-sm" list="team-suggestions" name="team_a_name" placeholder="A팀명" required />
            <input className="rounded border px-2 py-1.5 text-sm" list="team-suggestions" name="team_b_name" placeholder="B팀명" required />
            <button className="rounded border px-3 py-2 text-sm" type="submit">경기 추가</button>
          </form>
        </section>

        <section className="space-y-2">
          {(matches ?? []).length === 0 ? (
            <p className="text-sm text-gray-500">등록된 경기가 없습니다.</p>
          ) : (
            (matches ?? []).map((m) => (
              <div key={m.id} className="rounded border p-3 space-y-2">
                <div className="text-sm font-medium">{m.seq}경기 · {m.score_a}:{m.score_b}</div>
                <form action={updateMatch} className="grid md:grid-cols-6 gap-2 items-center">
                  <input type="hidden" name="channelId" value={channel.id} />
                  <input type="hidden" name="groupId" value={group.id} />
                  <input type="hidden" name="matchId" value={m.id} />
                  <input className="rounded border px-2 py-1.5 text-sm" list="team-suggestions" name="team_a_name" defaultValue={m.team_a_name} required />
                  <input className="rounded border px-2 py-1.5 text-sm" list="team-suggestions" name="team_b_name" defaultValue={m.team_b_name} required />
                  <select className="rounded border px-2 py-1.5 text-sm" name="status" defaultValue={m.status}>
                    <option value="scheduled">scheduled</option>
                    <option value="live">live</option>
                    <option value="ended">ended</option>
                  </select>
                  <input className="rounded border px-2 py-1.5 text-sm" type="datetime-local" name="scheduled_start_at" defaultValue={toDateTimeLocalValue(m.scheduled_start_at)} />
                  <button className="rounded border px-2 py-1.5 text-xs" type="submit">수정 저장</button>
                </form>

                <div className="flex items-center justify-between">
                  <Link className="underline text-xs" href={`/m/${m.id}`}>경기 화면</Link>
                  <form action={deleteMatch}>
                    <input type="hidden" name="channelId" value={channel.id} />
                    <input type="hidden" name="groupId" value={group.id} />
                    <input type="hidden" name="matchId" value={m.id} />
                    <button className="rounded border border-red-300 text-red-700 px-2 py-1 text-xs" type="submit">경기 삭제</button>
                  </form>
                </div>
              </div>
            ))
          )}
        </section>
      </section>
    </main>
  )
}
