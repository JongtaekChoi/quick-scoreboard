import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getSupabaseServerClient } from '@/lib/supabase'
import { isEditAuthorized } from '@/lib/editAuth'
import ScoreActions from './ScoreActions'

type Match = {
  id: string
  seq: number
  team_a_name: string
  team_b_name: string
  score_a: number
  score_b: number
  status: 'scheduled' | 'live' | 'ended'
  channel_id: string
}

type Channel = { id: string; slug: string; edit_session_version: number }

type GoalEvent = {
  id: string
  team_side: 'A' | 'B'
  scorer_no: string | null
  scorer_name: string | null
  assist_no: string | null
  assist_name: string | null
  created_at: string
}

async function addGoal(matchId: string, teamSide: 'A' | 'B', channelSlug: string, channelVersion: number) {
  'use server'

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  const canEdit = await isEditAuthorized(channelSlug, channelVersion)
  if (!canEdit) return

  const { data: match } = await supabase
    .from('matches')
    .select('id,score_a,score_b,status')
    .eq('id', matchId)
    .maybeSingle<{ id: string; score_a: number; score_b: number; status: 'scheduled' | 'live' | 'ended' }>()

  if (!match) return

  const nextScoreA = teamSide === 'A' ? match.score_a + 1 : match.score_a
  const nextScoreB = teamSide === 'B' ? match.score_b + 1 : match.score_b

  await supabase.from('goal_events').insert({
    match_id: matchId,
    team_side: teamSide,
  })

  await supabase
    .from('matches')
    .update({
      score_a: nextScoreA,
      score_b: nextScoreB,
      status: match.status === 'scheduled' ? 'live' : match.status,
      started_at: match.status === 'scheduled' ? new Date().toISOString() : undefined,
    })
    .eq('id', matchId)

  revalidatePath(`/m/${matchId}`)
  redirect(`/m/${matchId}`)
}

async function updateGoalEvent(matchId: string, goalId: string, channelSlug: string, channelVersion: number, formData: FormData) {
  'use server'

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  const canEdit = await isEditAuthorized(channelSlug, channelVersion)
  if (!canEdit) return

  const scorerNo = String(formData.get('scorer_no') || '').trim()
  const scorerName = String(formData.get('scorer_name') || '').trim()
  const assistNo = String(formData.get('assist_no') || '').trim()
  const assistName = String(formData.get('assist_name') || '').trim()

  await supabase
    .from('goal_events')
    .update({
      scorer_no: scorerNo || null,
      scorer_name: scorerName || null,
      assist_no: assistNo || null,
      assist_name: assistName || null,
    })
    .eq('id', goalId)
    .eq('match_id', matchId)

  revalidatePath(`/m/${matchId}`)
  redirect(`/m/${matchId}`)
}

export const dynamic = 'force-dynamic'

export default async function MatchDetailPage({
  params,
}: {
  params: Promise<{ matchId: string }>
}) {
  const { matchId } = await params
  const supabase = getSupabaseServerClient()

  if (!supabase) {
    return (
      <main className="min-h-screen p-4 md:p-6 bg-white">
        <section className="max-w-3xl mx-auto space-y-3">
          <h1 className="text-2xl font-semibold">경기 상세</h1>
          <p className="text-sm text-amber-700">Supabase 환경변수가 없어 데이터 연결을 건너뛰었습니다.</p>
        </section>
      </main>
    )
  }

  const { data: match } = await supabase
    .from('matches')
    .select('id,seq,team_a_name,team_b_name,score_a,score_b,status,channel_id')
    .eq('id', matchId)
    .maybeSingle<Match>()

  if (!match) {
    return (
      <main className="min-h-screen p-4 md:p-6 bg-white">
        <section className="max-w-3xl mx-auto space-y-3">
          <h1 className="text-2xl font-semibold">경기를 찾을 수 없음</h1>
          <p className="text-sm text-gray-600">유효한 경기 링크인지 확인해줘.</p>
        </section>
      </main>
    )
  }

  const { data: channel } = await supabase
    .from('channels')
    .select('id,slug,edit_session_version')
    .eq('id', match.channel_id)
    .maybeSingle<Channel>()

  const { data: goals } = await supabase
    .from('goal_events')
    .select('id,team_side,scorer_no,scorer_name,assist_no,assist_name,created_at')
    .eq('match_id', matchId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .returns<GoalEvent[]>()

  const canEdit = channel ? await isEditAuthorized(channel.slug, channel.edit_session_version) : false

  const addGoalA = channel ? addGoal.bind(null, matchId, 'A', channel.slug, channel.edit_session_version) : async () => {}
  const addGoalB = channel ? addGoal.bind(null, matchId, 'B', channel.slug, channel.edit_session_version) : async () => {}

  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-3xl mx-auto space-y-4">
        <header className="space-y-2">
          <Link href={channel ? `/c/${channel.slug}` : '/'} className="underline text-sm">
            ← 경기목록
          </Link>
          <h1 className="text-2xl font-semibold">{match.seq}경기</h1>
          <p className="text-sm text-gray-600">상태: {match.status}</p>
          <p className={`text-xs ${canEdit ? 'text-green-700' : 'text-gray-500'}`}>
            {canEdit ? '편집모드 ON' : '읽기모드 (채널에서 편집 비밀번호 입력 필요)'}
          </p>
        </header>

        <section className="rounded border p-4 space-y-3">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div className="text-right">
              <div className="text-sm text-gray-600">A팀</div>
              <div className="text-lg font-semibold">{match.team_a_name}</div>
            </div>
            <div className="text-3xl font-bold tabular-nums">{match.score_a} : {match.score_b}</div>
            <div>
              <div className="text-sm text-gray-600">B팀</div>
              <div className="text-lg font-semibold">{match.team_b_name}</div>
            </div>
          </div>

          {canEdit ? (
            <ScoreActions addGoalA={addGoalA} addGoalB={addGoalB} />
          ) : (
            <p className="text-xs text-gray-500">읽기모드에서는 득점 버튼을 사용할 수 없습니다.</p>
          )}
        </section>

        <section className="rounded border p-4 space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">득점 이벤트 (최근순)</h2>
          {(goals ?? []).length === 0 ? (
            <p className="text-sm text-gray-500">아직 득점 이벤트가 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {(goals ?? []).map((g, idx) => (
                <li key={g.id} className="rounded border px-3 py-2 text-sm space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">{(goals?.length ?? 0) - idx}. {g.team_side}팀 득점</div>
                      <div className="text-xs text-gray-500">
                        골 {g.scorer_no ? `#${g.scorer_no}` : ''} {g.scorer_name ?? ''}
                        {g.assist_no || g.assist_name ? ` · 어시 ${g.assist_no ? `#${g.assist_no}` : ''} ${g.assist_name ?? ''}` : ''}
                      </div>
                    </div>
                    <div className="text-xs text-gray-400">{new Date(g.created_at).toLocaleTimeString()}</div>
                  </div>

                  {canEdit && channel ? (
                    <form
                      action={updateGoalEvent.bind(null, matchId, g.id, channel.slug, channel.edit_session_version)}
                      className="grid grid-cols-2 md:grid-cols-4 gap-2"
                    >
                      <input className="rounded border px-2 py-1" name="scorer_no" placeholder="골 번호" defaultValue={g.scorer_no ?? ''} />
                      <input className="rounded border px-2 py-1" name="scorer_name" placeholder="골 이름" defaultValue={g.scorer_name ?? ''} />
                      <input className="rounded border px-2 py-1" name="assist_no" placeholder="어시 번호" defaultValue={g.assist_no ?? ''} />
                      <input className="rounded border px-2 py-1" name="assist_name" placeholder="어시 이름" defaultValue={g.assist_name ?? ''} />
                      <button className="rounded border px-2 py-1 text-xs md:col-span-4 justify-self-end" type="submit">선수정보 저장</button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-500">편집모드에서 득점/어시 번호와 이름을 사후 입력할 수 있습니다.</p>
        </section>
      </section>
    </main>
  )
}
