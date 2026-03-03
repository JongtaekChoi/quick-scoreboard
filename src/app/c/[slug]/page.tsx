import type { Metadata } from 'next'
import Link from 'next/link'
import { getSupabaseServerClient } from '@/lib/supabase'
import { isEditAuthorized } from '@/lib/editAuth'
import { autoStartDueMatches } from '@/lib/matchSchedule'
import { getManagerSession } from '@/lib/managerAuth'
import GroupList from './GroupList'
import ShareButton from '@/components/ShareButton'

type Channel = { id: string; name: string; slug: string; edit_session_version: number }
type MatchGroup = { id: string; channel_id: string; play_date: string; venue: string | null; title: string | null; seq: number }
type Match = {
  id: string
  match_group_id: string | null
  seq: number
  team_a_name: string
  team_b_name: string
  score_a: number
  score_b: number
  status: 'scheduled' | 'live' | 'ended'
  scheduled_start_at: string | null
}

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const supabase = getSupabaseServerClient()

  if (!supabase) {
    return { title: `채널 ${slug}` }
  }

  const { data: channel } = await supabase
    .from('channels')
    .select('name')
    .eq('slug', slug)
    .maybeSingle<{ name: string }>()

  return {
    title: channel ? channel.name : `채널 ${slug}`,
    description: channel ? `${channel.name} 경기목록` : '채널 경기목록',
  }
}

export default async function ChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ date?: string; err?: string; edit?: string; order?: string; mgr?: string }>
}) {
  const { slug } = await params
  const { date, err, edit, order, mgr } = await searchParams
  const matchOrder: 'asc' | 'desc' = order === 'desc' ? 'desc' : 'asc'

  const supabase = getSupabaseServerClient()

  if (!supabase) {
    return (
      <main className="min-h-screen p-4 md:p-6">
        <section className="max-w-4xl mx-auto space-y-3">
          <h1 className="text-2xl font-semibold">채널 경기목록</h1>
          <p className="text-sm text-amber-700">
            Supabase 환경변수가 없어 데이터 연결을 건너뛰었습니다.
          </p>
          <p className="text-xs text-gray-600">NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 설정 후 다시 확인해줘.</p>
        </section>
      </main>
    )
  }

  const { data: channel } = await supabase
    .from('channels')
    .select('id,name,slug,edit_session_version')
    .eq('slug', slug)
    .maybeSingle<Channel>()

  if (!channel) {
    return (
      <main className="min-h-screen p-4 md:p-6">
        <section className="max-w-4xl mx-auto space-y-3">
          <h1 className="text-2xl font-semibold">채널을 찾을 수 없음</h1>
          <p className="text-sm text-gray-600">유효한 링크인지 확인해줘.</p>
        </section>
      </main>
    )
  }

  const canEdit = await isEditAuthorized(channel.slug, channel.edit_session_version)
  const managerSession = await getManagerSession(channel.slug)
  const managerTeamId = managerSession?.teamId ?? null
  const channelUrl = `https://quick-scoreboard.vercel.app/c/${encodeURIComponent(channel.slug)}`

  await autoStartDueMatches(supabase)

  let groupQuery = supabase
    .from('match_groups')
    .select('id,channel_id,play_date,venue,title,seq')
    .eq('channel_id', channel.id)
    .order('play_date', { ascending: false })
    .order('seq', { ascending: true })

  if (date) {
    groupQuery = groupQuery.eq('play_date', date)
  }

  const { data: groups } = await groupQuery.returns<MatchGroup[]>()
  const groupIds = (groups ?? []).map((g) => g.id)

  const { data: matches } = groupIds.length
    ? await supabase
        .from('matches')
        .select('id,match_group_id,seq,team_a_name,team_b_name,score_a,score_b,status,scheduled_start_at')
        .in('match_group_id', groupIds)
        .order('seq', { ascending: matchOrder === 'asc' })
        .returns<Match[]>()
    : { data: [] as Match[] }

  const matchesByGroup = new Map<string, Match[]>()
  for (const m of matches ?? []) {
    if (!m.match_group_id) continue
    const arr = matchesByGroup.get(m.match_group_id) ?? []
    arr.push(m)
    matchesByGroup.set(m.match_group_id, arr)
  }
  const matchesByGroupObj = Object.fromEntries(matchesByGroup.entries())

  return (
    <main className="min-h-screen p-4 md:p-6 bg-white page-enter">
      <section className="max-w-4xl mx-auto space-y-4">
        <header className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-2xl font-semibold">{channel.name}</h1>
            <ShareButton url={channelUrl} title={`${channel.name} 경기목록`} className="rounded border px-2 py-1 text-xs" />
          </div>
          <p className="text-sm text-gray-600">경기목록 (날짜/그룹 단위)</p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded px-2 py-1 border ${canEdit ? 'bg-green-50 border-green-200 text-green-700' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
              {canEdit ? '편집모드 ON' : '읽기모드'}
            </span>
            {canEdit ? (
              <form action={`/c/${encodeURIComponent(channel.slug)}/edit-login`} method="post">
                <input type="hidden" name="action" value="logout" />
                <button className="underline" type="submit">편집모드 종료</button>
              </form>
            ) : (
              <form action={`/c/${encodeURIComponent(channel.slug)}/edit-login`} method="post" className="flex items-center gap-2">
                <input className="rounded border px-2 py-1" type="password" name="password" placeholder="편집 비밀번호" required />
                <button className="rounded border px-2 py-1" type="submit">편집 시작</button>
              </form>
            )}
            {managerTeamId ? (
              <form action={`/c/${encodeURIComponent(channel.slug)}/manager-login`} method="post">
                <input type="hidden" name="action" value="logout" />
                <button className="underline" type="submit">팀장 로그아웃</button>
              </form>
            ) : (
              <form action={`/c/${encodeURIComponent(channel.slug)}/manager-login`} method="post" className="flex items-center gap-2">
                <input className="rounded border px-2 py-1" name="login_id" placeholder="팀장ID" required />
                <input className="rounded border px-2 py-1" type="password" name="password" placeholder="팀장 비밀번호" required />
                <button className="rounded border px-2 py-1" type="submit">팀장 로그인</button>
              </form>
            )}
            {err === 'password' ? <span className="text-red-600">비밀번호가 틀렸어.</span> : null}
            {edit === '1' ? <span className="text-green-700">편집모드 인증 완료.</span> : null}
            {mgr === '1' ? <span className="text-green-700">팀장 로그인 완료.</span> : null}
            {mgr === 'password' ? <span className="text-red-600">팀장 계정 정보가 올바르지 않아.</span> : null}
            {canEdit ? (
              <Link className="underline" href={`/admin/channel/${channel.id}?from=channel`}>
                운영 관리 열기
              </Link>
            ) : null}
          </div>
          <form className="flex flex-wrap items-center gap-2" method="get">
            <label className="text-xs text-gray-600">날짜</label>
            <input className="rounded border px-2 py-1.5 text-sm" type="date" name="date" defaultValue={date ?? ''} />
            <label className="text-xs text-gray-600">정렬</label>
            <select className="rounded border px-2 py-1.5 text-sm" name="order" defaultValue={matchOrder}>
              <option value="asc">경기순 1→N</option>
              <option value="desc">경기순 N→1</option>
            </select>
            <button className="rounded border px-3 py-1.5 text-sm" type="submit">적용</button>
            {(date || matchOrder !== 'asc') ? (
              <Link className="text-xs underline text-gray-600" href={`/c/${encodeURIComponent(channel.slug)}`}>
                초기화
              </Link>
            ) : null}
          </form>
        </header>

        {(groups ?? []).length === 0 ? (
          <section className="rounded border p-4 text-sm text-gray-500">표시할 경기그룹이 없어.</section>
        ) : (
          <GroupList groups={groups ?? []} matchesByGroup={matchesByGroupObj} />
        )}
      </section>
    </main>
  )
}
