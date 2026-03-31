import type { Metadata } from 'next'
import Link from 'next/link'
import { getSupabaseServerClient } from '@/lib/supabase'
import { getAccountInfo } from '@/lib/channelSession'
import UserGNB from '@/components/UserGNB'
import ShareButton from '@/components/ShareButton'
import AccountBadge from '@/components/AccountBadge'
import LoginModal from '@/app/c/[slug]/LoginModal'
import JerseyBadge from '@/components/JerseyBadge'

type Channel = { id: string; name: string; slug: string }
type Match = { id: string; match_group_id: string | null; seq: number; team_a_id: string | null; team_b_id: string | null; team_a_name: string; team_b_name: string; score_a: number; score_b: number; status: 'scheduled'|'live'|'ended'; scheduled_start_at: string | null }
type Goal = { match_id: string; team_side: 'A'|'B'; minute: number | null; created_at: string; scorer_player_id: string | null; assist_player_id: string | null; scorer_name: string | null; assist_name: string | null }
type Player = { id: string; player_name: string; team_id: string; jersey_no: string | null }
type Group = { id: string; play_date: string; title: string | null; seq: number }
type TeamRow = { id: string; name: string; short_name: string | null }

export async function generateMetadata({ params }: { params: Promise<{ slug: string; teamKey: string }> }): Promise<Metadata> {
  const { slug, teamKey } = await params
  const key = decodeURIComponent(teamKey)
  const supabase = getSupabaseServerClient()

  if (!supabase) {
    return { title: '팀 상세 통계 | Quick Scoreboard' }
  }

  const { data: channel } = await supabase
    .from('channels')
    .select('name')
    .eq('slug', slug)
    .maybeSingle<{ name: string }>()

  let teamName = key.startsWith('name:') ? key.replace(/^name:/, '') : key
  if (!key.startsWith('name:')) {
    const { data: team } = await supabase
      .from('teams')
      .select('name')
      .eq('id', key)
      .maybeSingle<{ name: string }>()
    if (team?.name) teamName = team.name
  }

  const channelName = channel?.name ?? '리그'
  const title = `${teamName} 팀 상세 통계 | ${channelName}`
  const description = `${channelName} ${teamName}의 경기 결과, 순위, 팀 내 득점/어시스트 통계`
  const url = `/c/${encodeURIComponent(slug)}/stats/team/${encodeURIComponent(key)}`

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      type: 'article',
      locale: 'ko_KR',
      siteName: '풋살리그운영',
      url,
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
  }
}

export default async function TeamDetailPage({ params }: { params: Promise<{ slug: string; teamKey: string }> }) {
  const { slug, teamKey } = await params
  const key = decodeURIComponent(teamKey)
  const supabase = getSupabaseServerClient()
  if (!supabase) return <main className="p-6">Supabase env가 필요합니다.</main>

  const { data: channel } = await supabase
    .from('channels')
    .select('id,name,slug')
    .eq('slug', slug)
    .maybeSingle<Channel>()
  if (!channel) return <main className="p-6">리그를 찾을 수 없습니다.</main>

  const accountSession = await getAccountInfo(channel.slug)

  const { data: matches } = await supabase
    .from('matches')
    .select('id,match_group_id,seq,team_a_id,team_b_id,team_a_name,team_b_name,score_a,score_b,status,scheduled_start_at')
    .eq('channel_id', channel.id)
    .returns<(Match & { scheduled_start_at: string | null })[]>()

  const endedMatches = (matches ?? []).filter((m) => m.status === 'ended')
  const upcomingMatches = (matches ?? []).filter((m) => m.status !== 'ended')

  const matchIds = endedMatches.map((m) => m.id)
  const groupIds = Array.from(new Set((matches ?? []).map((m) => m.match_group_id).filter((v): v is string => Boolean(v))))
  const teamIds = Array.from(new Set((matches ?? []).flatMap((m) => [m.team_a_id, m.team_b_id]).filter((v): v is string => Boolean(v))))

  const [{ data: groups }, { data: goals }, { data: players }, { data: teams }] = await Promise.all([
    groupIds.length
      ? supabase.from('match_groups').select('id,play_date,title,seq').in('id', groupIds).returns<Group[]>()
      : Promise.resolve({ data: [] as Group[] }),
    matchIds.length
      ? supabase
          .from('goal_events')
          .select('match_id,team_side,minute,created_at,scorer_player_id,assist_player_id,scorer_name,assist_name')
          .in('match_id', matchIds)
          .is('deleted_at', null)
          .returns<Goal[]>()
      : Promise.resolve({ data: [] as Goal[] }),
    supabase
      .from('team_players')
      .select('id,player_name,team_id,jersey_no')
      .eq('channel_id', channel.id)
      .returns<Player[]>(),
    teamIds.length
      ? supabase.from('teams').select('id,name,short_name').in('id', teamIds).returns<TeamRow[]>()
      : Promise.resolve({ data: [] as TeamRow[] }),
  ])

  const isByName = key.startsWith('name:')
  const teamId = isByName ? null : key
  const teamNameFallback = isByName ? key.replace(/^name:/, '') : null

  const groupById = new Map((groups ?? []).map((g) => [g.id, g]))
  const playerById = new Map((players ?? []).map((p) => [p.id, p]))
  const teamNameById = new Map((teams ?? []).map((t) => [t.id, t.name]))
  const teamShortById = new Map((teams ?? []).map((t) => [t.id, t.short_name ?? t.name]))

  const rows = endedMatches
    .map((m) => {
      const isA = teamId ? m.team_a_id === teamId : m.team_a_name === teamNameFallback
      const isB = teamId ? m.team_b_id === teamId : m.team_b_name === teamNameFallback
      if (!isA && !isB) return null
      const side: 'A' | 'B' = isA ? 'A' : 'B'
      const teamName = isA ? m.team_a_name : m.team_b_name
      const opponentFull = isA ? (m.team_b_id ? (teamNameById.get(m.team_b_id) ?? m.team_b_name) : m.team_b_name) : (m.team_a_id ? (teamNameById.get(m.team_a_id) ?? m.team_a_name) : m.team_a_name)
      const opponentShort = isA ? (m.team_b_id ? (teamShortById.get(m.team_b_id) ?? opponentFull) : opponentFull) : (m.team_a_id ? (teamShortById.get(m.team_a_id) ?? opponentFull) : opponentFull)
      const scored = isA ? m.score_a : m.score_b
      const conceded = isA ? m.score_b : m.score_a
      const group = m.match_group_id ? groupById.get(m.match_group_id) : null

      const matchGoals = (goals ?? [])
        .filter((g) => g.match_id === m.id && g.team_side === side)
        .sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map((g) => {
          const scorer = g.scorer_player_id ? playerById.get(g.scorer_player_id) : null
          const assist = g.assist_player_id ? playerById.get(g.assist_player_id) : null
          return {
            minute: g.minute,
            scorerName: scorer?.player_name ?? (g.scorer_name ?? '-'),
            scorerJersey: scorer?.jersey_no ?? null,
            assistName: assist?.player_name ?? (g.assist_name ?? null),
            assistJersey: assist?.jersey_no ?? null,
          }
        })

      return {
        id: m.id,
        teamName,
        side,
        opponentFull,
        opponentShort,
        scored,
        conceded,
        seq: m.seq,
        playDate: group?.play_date ?? '',
        groupTitle: group?.title ?? null,
        goals: matchGoals,
      }
    })
    .filter(Boolean)
    .sort((a, b) => b!.playDate.localeCompare(a!.playDate) || b!.seq - a!.seq)

  const timelineMatches = endedMatches
    .map((m) => {
      const group = m.match_group_id ? groupById.get(m.match_group_id) : null
      return { ...m, playDate: group?.play_date ?? '' }
    })
    .sort((a, b) => a.playDate.localeCompare(b.playDate) || a.seq - b.seq)

  const standings = new Map<string, { pts: number; gd: number; gf: number }>()
  const rankAfterMatch = new Map<string, number>()

  const keyFor = (id: string | null, name: string) => id ?? `name:${name}`

  for (const m of timelineMatches) {
    const aKey = keyFor(m.team_a_id, m.team_a_name)
    const bKey = keyFor(m.team_b_id, m.team_b_name)
    const aPrev = standings.get(aKey) ?? { pts: 0, gd: 0, gf: 0 }
    const bPrev = standings.get(bKey) ?? { pts: 0, gd: 0, gf: 0 }

    const aPts = m.score_a > m.score_b ? 3 : m.score_a === m.score_b ? 1 : 0
    const bPts = m.score_b > m.score_a ? 3 : m.score_a === m.score_b ? 1 : 0

    standings.set(aKey, { pts: aPrev.pts + aPts, gd: aPrev.gd + (m.score_a - m.score_b), gf: aPrev.gf + m.score_a })
    standings.set(bKey, { pts: bPrev.pts + bPts, gd: bPrev.gd + (m.score_b - m.score_a), gf: bPrev.gf + m.score_b })

    const ranked = Array.from(standings.entries())
      .sort((x, y) => y[1].pts - x[1].pts || y[1].gd - x[1].gd || y[1].gf - x[1].gf || x[0].localeCompare(y[0]))
      .map(([k]) => k)

    const targetKey = key
    const idx = ranked.indexOf(targetKey)
    if (idx >= 0) rankAfterMatch.set(m.id, idx + 1)
  }

  const rowsWithRank = rows.map((row) => ({ ...row!, postRank: rankAfterMatch.get(row!.id) ?? null }))

  const upcomingRows = upcomingMatches
    .map((m) => {
      const isA = teamId ? m.team_a_id === teamId : m.team_a_name === teamNameFallback
      const isB = teamId ? m.team_b_id === teamId : m.team_b_name === teamNameFallback
      if (!isA && !isB) return null
      const opponentFull = isA ? (m.team_b_id ? (teamNameById.get(m.team_b_id) ?? m.team_b_name) : m.team_b_name) : (m.team_a_id ? (teamNameById.get(m.team_a_id) ?? m.team_a_name) : m.team_a_name)
      const opponentShort = isA ? (m.team_b_id ? (teamShortById.get(m.team_b_id) ?? opponentFull) : opponentFull) : (m.team_a_id ? (teamShortById.get(m.team_a_id) ?? opponentFull) : opponentFull)
      const group = m.match_group_id ? groupById.get(m.match_group_id) : null
      return {
        id: m.id,
        opponentFull,
        opponentShort,
        status: m.status,
        seq: m.seq,
        playDate: group?.play_date ?? '',
        groupTitle: group?.title ?? null,
        scheduledStartAt: m.scheduled_start_at,
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a!.playDate.localeCompare(b!.playDate) || a!.seq - b!.seq))

  const sideByMatchId = new Map(rowsWithRank.map((row) => [row.id, row.side as 'A' | 'B']))
  const scorerMap = new Map<string, { name: string; jersey: string | null; goals: number }>()
  const assistMap = new Map<string, { name: string; jersey: string | null; assists: number }>()

  for (const g of goals ?? []) {
    const side = sideByMatchId.get(g.match_id)
    if (!side || g.team_side !== side) continue

    if (g.scorer_player_id || g.scorer_name) {
      const key = g.scorer_player_id ? `p:${g.scorer_player_id}` : `n:${g.scorer_name}`
      const p = g.scorer_player_id ? playerById.get(g.scorer_player_id) : null
      const name = p?.player_name ?? (g.scorer_name ?? '-')
      const jersey = p?.jersey_no ?? null
      const prev = scorerMap.get(key)
      scorerMap.set(key, { name, jersey, goals: (prev?.goals ?? 0) + 1 })
    }

    if (g.assist_player_id || g.assist_name) {
      const key = g.assist_player_id ? `p:${g.assist_player_id}` : `n:${g.assist_name}`
      const p = g.assist_player_id ? playerById.get(g.assist_player_id) : null
      const name = p?.player_name ?? (g.assist_name ?? '-')
      const jersey = p?.jersey_no ?? null
      const prev = assistMap.get(key)
      assistMap.set(key, { name, jersey, assists: (prev?.assists ?? 0) + 1 })
    }
  }

  const teamScorers = Array.from(scorerMap.values()).sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name)).slice(0, 20)
  const teamAssisters = Array.from(assistMap.values()).sort((a, b) => b.assists - a.assists || a.name.localeCompare(b.name)).slice(0, 20)

  const titleTeam = rows[0]?.teamName ?? teamNameFallback ?? '팀'

  return (
    <main className="min-h-screen bg-gray-50 px-4 pb-24 pt-0 md:px-6 md:pb-24 md:pt-0">
      <section className="max-w-5xl mx-auto space-y-5">
        <UserGNB
          slug={channel.slug}
          channelName={channel.name}
          current="stats"
          subtitle={`${titleTeam} 상세 기록`}
          isLoggedIn={!!accountSession}
          rightActions={
            <>
              {!accountSession ? (
                <LoginModal slug={channel.slug} redirectTo={`/c/${encodeURIComponent(channel.slug)}/stats/team/${encodeURIComponent(key)}`} triggerClassName="rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white" />
              ) : null}
              {accountSession ? (
                <AccountBadge loginId={accountSession.loginId} role={accountSession.role} slug={channel.slug} accountHref={`/c/${encodeURIComponent(channel.slug)}/account`} />
              ) : null}
              <ShareButton url={`https://quick-scoreboard.vercel.app/c/${encodeURIComponent(channel.slug)}/stats/team/${encodeURIComponent(key)}`} title={`${channel.name} ${titleTeam} 상세`} />
            </>
          }
        />

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">{titleTeam} 경기 기록</h2>
            <Link className="text-xs rounded-md bg-gray-100 px-2 py-1 text-gray-700" href={`/c/${encodeURIComponent(channel.slug)}/stats`}>통계로 돌아가기</Link>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <details>
            <summary className="cursor-pointer list-none flex items-center justify-between gap-2 text-sm font-semibold text-gray-900">
              <span>예정 경기</span>
              <span className="text-xs font-normal text-gray-500">{upcomingRows.length}경기 · 접기/펼치기</span>
            </summary>

            <div className="mt-3">
              {upcomingRows.length === 0 ? (
                <p className="text-sm text-gray-500">예정 경기가 없습니다.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100 text-gray-500">
                        <th className="py-1 pr-2 text-left">날짜</th>
                        <th className="py-1 pr-2 text-left">상대팀</th>
                        <th className="py-1 pr-2 text-left">상태</th>
                        <th className="py-1 pr-2 text-left">시간</th>
                      </tr>
                    </thead>
                    <tbody>
                      {upcomingRows.map((row) => (
                        <tr key={`upcoming-${row!.id}`} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                          <td className="py-1 pr-2 whitespace-nowrap">
                            <Link className="block" href={`/m/${row!.id}`}>{row!.playDate || '-'}</Link>
                          </td>
                          <td className="py-1 pr-2 max-w-[110px]">
                            <Link className="block" href={`/m/${row!.id}`}>
                              <span className="hidden sm:inline truncate">{row!.opponentFull}</span>
                              <span className="sm:hidden truncate">{row!.opponentShort || row!.opponentFull}</span>
                            </Link>
                          </td>
                          <td className="py-1 pr-2">
                            <Link className="block" href={`/m/${row!.id}`}>
                              <span className={`inline-block text-[11px] rounded-full px-2 py-0.5 ${row!.status === 'live' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                                {row!.status === 'live' ? '진행중' : '예정'}
                              </span>
                            </Link>
                          </td>
                          <td className="py-1 pr-2 whitespace-nowrap">
                            <Link className="block" href={`/m/${row!.id}`}>
                              {row!.scheduledStartAt ? new Date(row!.scheduledStartAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '-'}
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </details>
        </section>

        {rowsWithRank.length === 0 ? (
          <section className="rounded-2xl bg-white p-4 shadow-sm text-sm text-gray-500">종료 경기 기록이 없습니다.</section>
        ) : (
          <>
            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">경기 요약표</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-500">
                      <th className="py-1 pr-2 text-left">날짜</th>
                      <th className="py-1 pr-2 text-left">상대팀</th>
                      <th className="py-1 pr-2 text-left">결과</th>
                      <th className="py-1 pr-2 text-left">득점</th>
                      <th className="py-1 pr-2 text-left">실점</th>
                      <th className="py-1 pr-2 text-left">순위</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowsWithRank.map((row) => {
                      const result = row.scored > row.conceded ? '승' : row.scored < row.conceded ? '패' : '무'
                      return (
                        <tr key={`sum-${row.id}`} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                          <td className="py-1 pr-2 whitespace-nowrap"><Link className="block" href={`/m/${row.id}`}>{row.playDate || '-'}</Link></td>
                          <td className="py-1 pr-2 max-w-[110px]"><Link className="block" href={`/m/${row.id}`}><span className="hidden sm:inline truncate">{row.opponentFull}</span><span className="sm:hidden truncate">{row.opponentShort || row.opponentFull}</span></Link></td>
                          <td className="py-1 pr-2"><Link className="block" href={`/m/${row.id}`}>{result}</Link></td>
                          <td className="py-1 pr-2"><Link className="block" href={`/m/${row.id}`}>{row.scored}</Link></td>
                          <td className="py-1 pr-2"><Link className="block" href={`/m/${row.id}`}>{row.conceded}</Link></td>
                          <td className="py-1 pr-2"><Link className="block" href={`/m/${row.id}`}>{row.postRank ?? '-'}</Link></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-gray-500">* 경기 반영 후 순위</p>
            </section>

            <ul className="space-y-2">
            {rowsWithRank.map((row) => (
              <li key={row!.id} className="rounded-xl bg-white p-3 shadow-sm space-y-1.5">
                <div className="text-xs text-gray-500">{row!.playDate} · {row!.seq}경기 {row!.groupTitle ? `· ${row!.groupTitle}` : ''}</div>
                <div className="text-sm font-semibold text-gray-900">vs <span className="hidden sm:inline">{row!.opponentFull}</span><span className="sm:hidden">{row!.opponentShort || row!.opponentFull}</span> · {row!.scored}:{row!.conceded}</div>
                {row!.goals.length === 0 ? (
                  <div className="text-xs text-gray-500">득점 기록 없음</div>
                ) : (
                  <ul className="divide-y divide-gray-100 rounded-md bg-gray-50 px-2">
                    {row!.goals.map((g, idx) => (
                      <li key={`${row!.id}-${idx}`} className="py-1.5 text-xs text-gray-700">
                        {g.minute != null ? `${g.minute}' ` : ''}득점: <JerseyBadge number={g.scorerJersey} /> {g.scorerName}{g.assistName ? <> · 어시: <JerseyBadge number={g.assistJersey} /> {g.assistName}</> : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>

          <div className="grid gap-3 md:grid-cols-2">
            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">팀 내 득점 순위</h3>
              {teamScorers.length === 0 ? (
                <p className="text-sm text-gray-500">득점 기록이 없습니다.</p>
              ) : (
                <ol className="divide-y divide-gray-100 text-sm">
                  {teamScorers.map((item, i) => (
                    <li key={`scorer-${item.name}-${item.jersey ?? i}`} className="flex items-center justify-between py-1.5">
                      <span className="inline-flex items-center gap-1">{i + 1}. <JerseyBadge number={item.jersey} /> {item.name}</span>
                      <span className="font-semibold">{item.goals}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">팀 내 어시스트 순위</h3>
              {teamAssisters.length === 0 ? (
                <p className="text-sm text-gray-500">어시스트 기록이 없습니다.</p>
              ) : (
                <ol className="divide-y divide-gray-100 text-sm">
                  {teamAssisters.map((item, i) => (
                    <li key={`assist-${item.name}-${item.jersey ?? i}`} className="flex items-center justify-between py-1.5">
                      <span className="inline-flex items-center gap-1">{i + 1}. <JerseyBadge number={item.jersey} /> {item.name}</span>
                      <span className="font-semibold">{item.assists}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
          </>
        )}
      </section>
    </main>
  )
}
