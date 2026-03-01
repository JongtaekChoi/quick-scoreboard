import Link from 'next/link'
import { getSupabaseServerClient } from '@/lib/supabase'

type Channel = { id: string; name: string; slug: string }
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
  searchParams: Promise<{ date?: string }>
}) {
  const { slug } = await params
  const { date } = await searchParams

  const supabase = getSupabaseServerClient()

  if (!supabase) {
    return (
      <main className="min-h-screen p-4 md:p-6">
        <section className="max-w-4xl mx-auto space-y-3">
          <h1 className="text-2xl font-semibold">채널 경기목록</h1>
          <p className="text-sm text-amber-700">
            Supabase 환경변수가 없어 데이터 연결을 건너뛰었습니다.
          </p>
          <p className="text-xs text-gray-600">NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 설정 후 다시 확인해줘.</p>
        </section>
      </main>
    )
  }

  const { data: channel } = await supabase
    .from('channels')
    .select('id,name,slug')
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
                    <div>
                      <h2 className="text-sm font-semibold">{g.title ?? `${g.play_date} 그룹 ${g.seq}`}</h2>
                      <p className="text-xs text-gray-500">{g.play_date} {g.venue ? `· ${g.venue}` : ''}</p>
                    </div>
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
