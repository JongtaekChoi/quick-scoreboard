import Link from 'next/link'
import { getSupabaseServerClient } from '@/lib/supabase'
import { isEditAuthorized } from '@/lib/editAuth'

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
}

export const dynamic = 'force-dynamic'

export default async function ChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ date?: string; err?: string; edit?: string }>
}) {
  const { slug } = await params
  const { date, err, edit } = await searchParams

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
        .select('id,match_group_id,seq,team_a_name,team_b_name,score_a,score_b,status')
        .in('match_group_id', groupIds)
        .order('seq', { ascending: true })
        .returns<Match[]>()
    : { data: [] as Match[] }

  const matchesByGroup = new Map<string, Match[]>()
  for (const m of matches ?? []) {
    if (!m.match_group_id) continue
    const arr = matchesByGroup.get(m.match_group_id) ?? []
    arr.push(m)
    matchesByGroup.set(m.match_group_id, arr)
  }

  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-4xl mx-auto space-y-4">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">{channel.name}</h1>
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
            {err === 'password' ? <span className="text-red-600">비밀번호가 틀렸어.</span> : null}
            {edit === '1' ? <span className="text-green-700">편집모드 인증 완료.</span> : null}
          </div>
          <form className="flex items-center gap-2" method="get">
            <label className="text-xs text-gray-600">날짜</label>
            <input className="rounded border px-2 py-1.5 text-sm" type="date" name="date" defaultValue={date ?? ''} />
            <button className="rounded border px-3 py-1.5 text-sm" type="submit">필터</button>
            {date ? (
              <Link className="text-xs underline text-gray-600" href={`/c/${encodeURIComponent(channel.slug)}`}>
                초기화
              </Link>
            ) : null}
          </form>
        </header>

        {(groups ?? []).length === 0 ? (
          <section className="rounded border p-4 text-sm text-gray-500">표시할 경기그룹이 없어.</section>
        ) : (
          <div className="space-y-3">
            {(groups ?? []).map((g) => {
              const list = matchesByGroup.get(g.id) ?? []
              return (
                <section key={g.id} className="rounded border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">{g.title ?? `${g.play_date}${g.venue ? ` · ${g.venue}` : ''}`}</h2>
                    <span className="text-xs text-gray-400">{list.length}경기</span>
                  </div>

                  {list.length === 0 ? (
                    <p className="text-sm text-gray-500">등록된 경기가 없습니다.</p>
                  ) : (
                    <ul className="space-y-2">
                      {list.map((m) => (
                        <li key={m.id} className="rounded border px-3 py-2 bg-white">
                          <Link href={`/m/${m.id}`} className="flex items-center justify-between gap-3">
                            <div className="text-sm">
                              <div className="font-medium">{m.seq}경기 · {m.team_a_name} vs {m.team_b_name}</div>
                              <div className="text-xs text-gray-500">상태: {m.status}</div>
                            </div>
                            <div className="text-lg font-semibold tabular-nums">
                              {m.score_a} : {m.score_b}
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}
