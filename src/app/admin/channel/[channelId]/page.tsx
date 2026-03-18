import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { getSupabaseServerClient } from '@/lib/supabase'
import { isAdminAuthorized } from '@/lib/adminAuth'
import { getAccountInfo, validateManagerAgainstDb } from '@/lib/channelSession'
import PendingSubmitButton from '@/components/PendingSubmitButton'
import TransientToast from '@/components/TransientToast'

type Channel = { id: string; name: string; slug: string; edit_session_version: number }
type MatchGroup = { id: string; play_date: string; venue: string | null; title: string | null; seq: number }
type GroupMatch = { match_group_id: string | null; team_a_name: string; team_b_name: string }

const CHANNEL_FEEDBACK_COOKIE = 'qsb_channel_feedback'

async function setChannelFeedback(code: string) {
  const store = await cookies()
  store.set(CHANNEL_FEEDBACK_COOKIE, code, { path: '/', maxAge: 10, sameSite: 'lax' })
}

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
  if (isAdmin) return { allowed: true, channel, managerTeamId: null as string | null }

  const account = await getAccountInfo(channel.slug)
  if (account?.role === 'admin') return { allowed: true, channel, managerTeamId: null as string | null }

  const { ok, teamId } = await validateManagerAgainstDb(channel.slug, channel.id)
  return { allowed: ok, channel, managerTeamId: teamId }
}

async function createGroup(formData: FormData) {
  'use server'
  const channelId = String(formData.get('channelId') || '')
  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }
  if (manage.managerTeamId) {
    await setChannelFeedback('forbidden')
    return
  }

  const playDate = String(formData.get('play_date') || '')
  const venue = String(formData.get('venue') || '').trim()
  const title = String(formData.get('title') || '').trim()
  if (!channelId || !playDate) return

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  const { data: lastGroup } = await supabase
    .from('match_groups')
    .select('seq')
    .eq('channel_id', channelId)
    .eq('play_date', playDate)
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle<{ seq: number }>()

  const nextSeq = (lastGroup?.seq ?? 0) + 1

  await supabase.from('match_groups').insert({
    channel_id: channelId,
    play_date: playDate,
    venue: venue || null,
    title: title || null,
    seq: nextSeq,
  })

  redirect(`/admin/channel/${channelId}`)
}

async function updateGroupMeta(formData: FormData) {
  'use server'
  const channelId = String(formData.get('channelId') || '')
  const groupId = String(formData.get('groupId') || '')

  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }
  if (manage.managerTeamId) {
    await setChannelFeedback('forbidden')
    return
  }

  const playDate = String(formData.get('play_date') || '').trim()
  const venue = String(formData.get('venue') || '').trim()
  const title = String(formData.get('title') || '').trim()
  const firstKickoff = String(formData.get('first_kickoff_time') || '').trim()

  if (!channelId || !groupId || !playDate) return

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  await supabase
    .from('match_groups')
    .update({ play_date: playDate, venue: venue || null, title: title || null })
    .eq('id', groupId)
    .eq('channel_id', channelId)

  if (firstKickoff) {
    const iso = new Date(`${playDate}T${firstKickoff}:00+09:00`).toISOString()
    await supabase
      .from('matches')
      .update({ scheduled_start_at: iso })
      .eq('match_group_id', groupId)
      .eq('seq', 1)
  }

  redirect(`/admin/channel/${channelId}`)
}

export default async function AdminChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ channelId: string }>
  searchParams: Promise<{ from?: string; err?: string }>
}) {
  const { channelId } = await params
  const { from, err } = await searchParams
  const fromChannel = from === 'channel'
  const store = await cookies()
  const feedbackCode = err ?? store.get(CHANNEL_FEEDBACK_COOKIE)?.value ?? null
  const errToastMap: Record<string, string> = {
    forbidden: '팀장 계정은 경기그룹 생성 권한이 없습니다.',
  }
  const errToast = feedbackCode ? errToastMap[feedbackCode] : null
  const supabase = getSupabaseServerClient()
  if (!supabase) return <main className="p-6">Supabase env가 필요합니다.</main>

  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }

  const channel = manage.channel
  const managerTeamId = manage.managerTeamId
  if (!channel) return <main className="p-6">리그를 찾을 수 없습니다.</main>
  if (managerTeamId) {
    redirect(`/admin/channel/${channelId}/manager-entries`)
  }

  const [{ data: groups }, { data: groupMatches }] = await Promise.all([
    supabase
      .from('match_groups')
      .select('id,play_date,venue,title,seq')
      .eq('channel_id', channelId)
      .order('play_date', { ascending: false })
      .order('seq', { ascending: true })
      .returns<MatchGroup[]>(),
    supabase
      .from('matches')
      .select('match_group_id,team_a_name,team_b_name')
      .eq('channel_id', channelId)
      .not('match_group_id', 'is', null)
      .returns<GroupMatch[]>(),
  ])

  const teamNamesByGroup = new Map<string, string[]>()
  for (const m of groupMatches ?? []) {
    if (!m.match_group_id) continue
    const set = new Set(teamNamesByGroup.get(m.match_group_id) ?? [])
    set.add(m.team_a_name)
    set.add(m.team_b_name)
    teamNamesByGroup.set(m.match_group_id, Array.from(set).sort())
  }

  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-5xl mx-auto space-y-5">
        {errToast ? <TransientToast message={errToast} tone="error" /> : null}
        <header className="space-y-1">
          <div className="text-xs text-gray-500 flex items-center gap-1">
            <Link className="underline" href={fromChannel ? `/c/${channel.slug}` : '/admin'}>
              {fromChannel ? '리그 경기목록' : '관리자 홈'}
            </Link>
            <span>›</span>
            <span>경기그룹 관리</span>
          </div>
          <h1 className="text-2xl font-semibold">{channel.name} 경기그룹 관리</h1>
          <p className="text-sm text-gray-600">리그: /{channel.slug}</p>
          {managerTeamId ? (
            <p className="text-xs text-blue-700">팀장 모드: 엔트리 관리만 가능합니다.</p>
          ) : (
            <div className="flex items-center gap-3 text-sm">
              <Link className="underline" href={`/admin/channel/${channel.id}/teams`}>팀 관리</Link>
              <Link className="underline" href={`/admin/channel/${channel.id}/roster`}>팀 멤버 관리</Link>
              <Link className="underline" href={`/admin/channel/${channel.id}/accounts`}>계정 관리</Link>
              <Link className="underline" href={`/admin/channel/${channel.id}/logs`}>변경 이력</Link>
              <Link className="underline" href={`/admin/channel/${channel.id}/export`}>엑셀 내보내기</Link>
            </div>
          )}
        </header>

        {managerTeamId ? null : (
          <section className="rounded border p-4 space-y-2">
            <h2 className="text-sm font-semibold">경기그룹 생성</h2>
            <p className="text-xs text-gray-500">순번(seq)은 같은 날짜 기준으로 자동 부여됩니다.</p>
            <form action={createGroup} className="grid md:grid-cols-4 gap-2">
              <input type="hidden" name="channelId" value={channel.id} />
              <input className="rounded border px-2 py-1.5 text-sm" name="play_date" type="date" required />
              <input className="rounded border px-2 py-1.5 text-sm" name="venue" placeholder="구장(선택)" />
              <input className="rounded border px-2 py-1.5 text-sm" name="title" placeholder="그룹 제목(선택)" />
              <PendingSubmitButton className="rounded border px-3 py-2 text-sm" pendingText="생성중...">생성</PendingSubmitButton>
            </form>
          </section>
        )}

        <section className="space-y-3">
          {(groups ?? []).length === 0 ? (
            <p className="text-sm text-gray-500">경기그룹이 없습니다.</p>
          ) : (
            (groups ?? []).map((g) => {
              const participantTeams = teamNamesByGroup.get(g.id) ?? []
              return (
                <div key={g.id} className="rounded border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-medium text-sm">{g.title ?? `${g.play_date}${g.venue ? ` · ${g.venue}` : ''}`}</div>
                      <div className="text-xs text-gray-500">{g.play_date} {g.venue ? `· ${g.venue}` : ''}</div>
                    </div>
                    <Link className="underline text-sm" href={`/admin/channel/${channel.id}/group/${g.id}?from=${fromChannel ? 'channel' : 'admin'}`}>
                      {managerTeamId ? '이 그룹 엔트리 관리' : '이 그룹 경기 관리'}
                    </Link>
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs text-gray-500">참여팀</div>
                    {participantTeams.length === 0 ? (
                      <div className="text-xs text-gray-400">등록된 경기가 없어 참여팀이 없습니다.</div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {participantTeams.map((teamName) => (
                          <span key={`${g.id}-${teamName}`} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                            {teamName}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {!managerTeamId ? (
                    <details className="rounded bg-gray-50 p-2">
                      <summary className="cursor-pointer text-xs font-medium text-gray-700">그룹 정보 수정</summary>
                      <form action={updateGroupMeta} className="mt-2 grid md:grid-cols-5 gap-2 items-center">
                        <input type="hidden" name="channelId" value={channel.id} />
                        <input type="hidden" name="groupId" value={g.id} />
                        <input className="rounded border px-2 py-1.5 text-sm" name="play_date" type="date" defaultValue={g.play_date} required />
                        <input className="rounded border px-2 py-1.5 text-sm" name="venue" placeholder="구장(선택)" defaultValue={g.venue ?? ''} />
                        <input className="rounded border px-2 py-1.5 text-sm" name="title" placeholder="그룹 제목(선택)" defaultValue={g.title ?? ''} />
                        <input className="rounded border px-2 py-1.5 text-sm" name="first_kickoff_time" type="time" placeholder="1경기 시작시간" />
                        <PendingSubmitButton className="rounded border px-2 py-1.5 text-xs" pendingText="저장중...">수정 저장</PendingSubmitButton>
                      </form>
                    </details>
                  ) : null}
                </div>
              )
            })
          )}
        </section>
      </section>
    </main>
  )
}
