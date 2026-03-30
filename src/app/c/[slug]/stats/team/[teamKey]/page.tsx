import Link from 'next/link'
import { getSupabaseServerClient } from '@/lib/supabase'
import { getAccountInfo } from '@/lib/channelSession'
import UserGNB from '@/components/UserGNB'
import ShareButton from '@/components/ShareButton'
import AccountBadge from '@/components/AccountBadge'
import LoginModal from '@/app/c/[slug]/LoginModal'

type Channel = { id: string; name: string; slug: string }
type Match = { id: string; match_group_id: string | null; seq: number; team_a_id: string | null; team_b_id: string | null; team_a_name: string; team_b_name: string; score_a: number; score_b: number; status: 'scheduled'|'live'|'ended' }
type Goal = { match_id: string; team_side: 'A'|'B'; minute: number | null; created_at: string; scorer_player_id: string | null; assist_player_id: string | null; scorer_name: string | null; assist_name: string | null }
type Player = { id: string; player_name: string; team_id: string; jersey_no: string | null }
type Group = { id: string; play_date: string; title: string | null; seq: number }

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
    .select('id,match_group_id,seq,team_a_id,team_b_id,team_a_name,team_b_name,score_a,score_b,status')
    .eq('channel_id', channel.id)
    .eq('status', 'ended')
    .returns<Match[]>()

  const matchIds = (matches ?? []).map((m) => m.id)
  const groupIds = Array.from(new Set((matches ?? []).map((m) => m.match_group_id).filter((v): v is string => Boolean(v))))

  const { data: groups } = groupIds.length
    ? await supabase.from('match_groups').select('id,play_date,title,seq').in('id', groupIds).returns<Group[]>()
    : { data: [] as Group[] }

  const { data: goals } = matchIds.length
    ? await supabase
        .from('goal_events')
        .select('match_id,team_side,minute,created_at,scorer_player_id,assist_player_id,scorer_name,assist_name')
        .in('match_id', matchIds)
        .is('deleted_at', null)
        .returns<Goal[]>()
    : { data: [] as Goal[] }

  const { data: players } = await supabase
    .from('team_players')
    .select('id,player_name,team_id,jersey_no')
    .eq('channel_id', channel.id)
    .returns<Player[]>()

  const isByName = key.startsWith('name:')
  const teamId = isByName ? null : key
  const teamNameFallback = isByName ? key.replace(/^name:/, '') : null

  const groupById = new Map((groups ?? []).map((g) => [g.id, g]))
  const playerById = new Map((players ?? []).map((p) => [p.id, p]))

  const rows = (matches ?? [])
    .map((m) => {
      const isA = teamId ? m.team_a_id === teamId : m.team_a_name === teamNameFallback
      const isB = teamId ? m.team_b_id === teamId : m.team_b_name === teamNameFallback
      if (!isA && !isB) return null
      const side: 'A' | 'B' = isA ? 'A' : 'B'
      const teamName = isA ? m.team_a_name : m.team_b_name
      const opponent = isA ? m.team_b_name : m.team_a_name
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
            scorer: scorer ? `${scorer.jersey_no ? `#${scorer.jersey_no} ` : ''}${scorer.player_name}` : (g.scorer_name ?? '-'),
            assist: assist ? `${assist.jersey_no ? `#${assist.jersey_no} ` : ''}${assist.player_name}` : g.assist_name,
          }
        })

      return {
        id: m.id,
        teamName,
        opponent,
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

        {rows.length === 0 ? (
          <section className="rounded-2xl bg-white p-4 shadow-sm text-sm text-gray-500">기록이 없습니다.</section>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row!.id} className="rounded-xl bg-white p-3 shadow-sm space-y-1.5">
                <div className="text-xs text-gray-500">{row!.playDate} · {row!.seq}경기 {row!.groupTitle ? `· ${row!.groupTitle}` : ''}</div>
                <div className="text-sm font-semibold text-gray-900">vs {row!.opponent} · {row!.scored}:{row!.conceded}</div>
                {row!.goals.length === 0 ? (
                  <div className="text-xs text-gray-500">득점 기록 없음</div>
                ) : (
                  <ul className="divide-y divide-gray-100 rounded-md bg-gray-50 px-2">
                    {row!.goals.map((g, idx) => (
                      <li key={`${row!.id}-${idx}`} className="py-1.5 text-xs text-gray-700">
                        {g.minute != null ? `${g.minute}' ` : ''}득점: {g.scorer}{g.assist ? ` · 어시: ${g.assist}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
