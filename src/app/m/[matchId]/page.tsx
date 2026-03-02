import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getSupabaseServerClient } from '@/lib/supabase'
import { isEditAuthorized } from '@/lib/editAuth'
import ScoreActions from './ScoreActions'
import LiveScoreboard from './LiveScoreboard'

type Match = {
  id: string
  seq: number
  team_a_name: string
  team_b_name: string
  score_a: number
  score_b: number
  status: 'scheduled' | 'live' | 'ended'
  started_at: string | null
  channel_id: string
}

type Channel = { id: string; slug: string; edit_session_version: number }

type GoalEvent = {
  id: string
  team_side: 'A' | 'B'
  minute: number | null
  scorer_no: string | null
  scorer_name: string | null
  assist_no: string | null
  assist_name: string | null
  created_at: string
}

type Alias = { jersey_no: string | null; player_name: string | null }

async function addGoal(matchId: string, teamSide: 'A' | 'B', channelSlug: string, channelVersion: number) {
  'use server'

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  const canEdit = await isEditAuthorized(channelSlug, channelVersion)
  if (!canEdit) return

  const { data: match } = await supabase
    .from('matches')
    .select('id,status,started_at')
    .eq('id', matchId)
    .maybeSingle<{ id: string; status: 'scheduled' | 'live' | 'ended'; started_at: string | null }>()

  if (!match) return
  if (match.status === 'ended') {
    redirect(`/m/${matchId}?err=match_ended`)
  }

  const now = new Date()
  const minute = match.started_at
    ? Math.max(0, Math.floor((now.getTime() - new Date(match.started_at).getTime()) / 60000))
    : 0

  const { data: insertedGoal, error: insertError } = await supabase
    .from('goal_events')
    .insert({
      match_id: matchId,
      team_side: teamSide,
      minute,
      scored_at: now.toISOString(),
    })
    .select('id')
    .maybeSingle<{ id: string }>()

  if (insertError || !insertedGoal?.id) {
    console.error('[addGoal] goal_events insert failed', { matchId, teamSide, error: insertError?.message })
    redirect(`/m/${matchId}?err=goal_insert_failed`)
  }

  const { data: countedGoals, error: countError } = await supabase
    .from('goal_events')
    .select('team_side')
    .eq('match_id', matchId)
    .is('deleted_at', null)

  if (countError) {
    console.error('[addGoal] recount failed', { matchId, error: countError.message })
    redirect(`/m/${matchId}?err=goal_recount_failed`)
  }

  let scoreA = 0
  let scoreB = 0
  for (const g of countedGoals ?? []) {
    if (g.team_side === 'A') scoreA += 1
    else if (g.team_side === 'B') scoreB += 1
  }

  const { error: updateError } = await supabase
    .from('matches')
    .update({
      score_a: scoreA,
      score_b: scoreB,
      status: match.status === 'scheduled' ? 'live' : match.status,
      started_at: match.status === 'scheduled' ? now.toISOString() : undefined,
    })
    .eq('id', matchId)

  if (updateError) {
    await supabase.from('goal_events').update({ deleted_at: now.toISOString() }).eq('id', insertedGoal.id).eq('match_id', matchId)
    console.error('[addGoal] matches update failed', { matchId, error: updateError.message })
    redirect(`/m/${matchId}?err=score_update_failed`)
  }

  revalidatePath(`/m/${matchId}`)
  redirect(`/m/${matchId}`)
}

async function startMatch(matchId: string, channelSlug: string, channelVersion: number) {
  'use server'

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  const canEdit = await isEditAuthorized(channelSlug, channelVersion)
  if (!canEdit) return

  await supabase
    .from('matches')
    .update({ status: 'live', started_at: new Date().toISOString() })
    .eq('id', matchId)

  revalidatePath(`/m/${matchId}`)
  redirect(`/m/${matchId}`)
}

async function endMatch(matchId: string, channelSlug: string, channelVersion: number) {
  'use server'

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  const canEdit = await isEditAuthorized(channelSlug, channelVersion)
  if (!canEdit) return

  await supabase
    .from('matches')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
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

  let scorer = String(formData.get('scorer') || '').trim()
  let assist = String(formData.get('assist') || '').trim()
  const setNone = String(formData.get('set_none') || '')
  if (setNone === 'scorer') scorer = ''
  if (setNone === 'assist') assist = ''
  const minuteRaw = String(formData.get('minute') || '').trim()
  const minute = minuteRaw === '' ? null : Math.max(0, Number(minuteRaw) || 0)

  await supabase
    .from('goal_events')
    .update({
      minute,
      scorer_no: null,
      scorer_name: scorer || null,
      assist_no: null,
      assist_name: assist || null,
    })
    .eq('id', goalId)
    .eq('match_id', matchId)

  const aliasPairs = [
    { jersey_no: null, player_name: scorer || null },
    { jersey_no: null, player_name: assist || null },
  ].filter((x) => x.player_name)

  for (const a of aliasPairs) {
    await supabase
      .from('match_player_aliases')
      .upsert(
        {
          match_id: matchId,
          jersey_no: a.jersey_no,
          player_name: a.player_name,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: 'match_id,jersey_no,player_name' },
      )
  }

  revalidatePath(`/m/${matchId}`)
  redirect(`/m/${matchId}`)
}

async function deleteGoalEvent(matchId: string, goalId: string, teamSide: 'A' | 'B', channelSlug: string, channelVersion: number) {
  'use server'

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  const canEdit = await isEditAuthorized(channelSlug, channelVersion)
  if (!canEdit) return

  await supabase.from('goal_events').update({ deleted_at: new Date().toISOString() }).eq('id', goalId).eq('match_id', matchId)

  const { data: match } = await supabase
    .from('matches')
    .select('score_a,score_b')
    .eq('id', matchId)
    .maybeSingle<{ score_a: number; score_b: number }>()

  if (match) {
    const nextA = teamSide === 'A' ? Math.max(0, (match.score_a ?? 0) - 1) : match.score_a
    const nextB = teamSide === 'B' ? Math.max(0, (match.score_b ?? 0) - 1) : match.score_b
    await supabase.from('matches').update({ score_a: nextA, score_b: nextB }).eq('id', matchId)
  }

  revalidatePath(`/m/${matchId}`)
  redirect(`/m/${matchId}`)
}

export const dynamic = 'force-dynamic'

export default async function MatchDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ matchId: string }>
  searchParams: Promise<{ goal?: string; err?: string }>
}) {
  const { matchId } = await params
  const { goal: goalParam, err } = await searchParams
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
    .select('id,seq,team_a_name,team_b_name,score_a,score_b,status,started_at,channel_id')
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
    .select('id,team_side,minute,scorer_no,scorer_name,assist_no,assist_name,created_at')
    .eq('match_id', matchId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .returns<GoalEvent[]>()

  const { data: aliases } = await supabase
    .from('match_player_aliases')
    .select('jersey_no,player_name')
    .eq('match_id', matchId)
    .order('last_used_at', { ascending: false })
    .limit(50)
    .returns<Alias[]>()

  const canEdit = channel ? await isEditAuthorized(channel.slug, channel.edit_session_version) : false

  const activeGoalId = goalParam || (goals?.[0]?.id ?? '')
  const activeGoal = (goals ?? []).find((g) => g.id === activeGoalId) ?? (goals?.[0] ?? null)

  const suggestedNames = Array.from(
    new Set(
      [
        ...(aliases ?? []).map((a) => a.player_name).filter(Boolean),
        ...(goals ?? []).flatMap((g) => [g.scorer_name, g.assist_name]).filter(Boolean),
      ] as string[],
    ),
  ).slice(0, 20)

  const addGoalA = channel ? addGoal.bind(null, matchId, 'A', channel.slug, channel.edit_session_version) : async () => {}
  const addGoalB = channel ? addGoal.bind(null, matchId, 'B', channel.slug, channel.edit_session_version) : async () => {}
  const startMatchAction = channel ? startMatch.bind(null, matchId, channel.slug, channel.edit_session_version) : async () => {}
  const endMatchAction = channel ? endMatch.bind(null, matchId, channel.slug, channel.edit_session_version) : async () => {}

  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-3xl mx-auto space-y-4">
        <header className="space-y-2">
          <Link href={channel ? `/c/${channel.slug}` : '/'} className="underline text-sm">
            ← 경기목록
          </Link>
          <h1 className="text-2xl font-semibold">{match.seq}경기</h1>
          <p className="text-sm text-gray-600">상태: {match.status}</p>
          <p className="text-xs text-gray-500">
            시작시간: {match.started_at ? new Date(match.started_at).toLocaleTimeString() : '미설정'}
          </p>
          <p className={`text-xs ${canEdit ? 'text-green-700' : 'text-gray-500'}`}>
            {canEdit ? '편집모드 ON' : '읽기모드 (채널에서 편집 비밀번호 입력 필요)'}
          </p>
          {err ? <p className="text-xs text-red-600">저장 중 오류가 발생했습니다: {err}</p> : null}
        </header>

        <LiveScoreboard
          matchId={matchId}
          readonly={!canEdit}
          initialMatch={{
            id: match.id,
            team_a_name: match.team_a_name,
            team_b_name: match.team_b_name,
            score_a: match.score_a,
            score_b: match.score_b,
          }}
          initialGoals={(goals ?? []).map((g) => ({
            id: g.id,
            team_side: g.team_side,
            minute: g.minute,
            scorer_name: g.scorer_name,
            scorer_no: g.scorer_no,
            assist_name: g.assist_name,
            assist_no: g.assist_no,
            created_at: g.created_at,
          }))}
        />

        {canEdit ? (
          <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-2 shadow-sm">
            {!match.started_at ? (
              <form action={startMatchAction}>
                <button className="rounded border px-3 py-2 text-sm" type="submit">경기 시작</button>
              </form>
            ) : null}
            {match.status !== 'ended' ? (
              <form action={endMatchAction}>
                <button className="rounded border px-3 py-2 text-sm" type="submit">경기 종료</button>
              </form>
            ) : (
              <p className="text-xs text-gray-500">종료된 경기입니다.</p>
            )}
            <ScoreActions addGoalA={addGoalA} addGoalB={addGoalB} teamAName={match.team_a_name} teamBName={match.team_b_name} />
          </section>
        ) : null}

        {canEdit ? (
          <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700">현재 편집 이벤트</h2>
            {!activeGoal || !channel ? (
              <p className="text-sm text-gray-500">편집할 이벤트가 없습니다.</p>
            ) : (
              <>
                <div className="text-sm text-gray-700">
                  {activeGoal.team_side}팀 · {activeGoal.minute !== null ? `${activeGoal.minute}분` : '시간 미설정'}
                </div>
                <form
                  action={updateGoalEvent.bind(null, matchId, activeGoal.id, channel.slug, channel.edit_session_version)}
                  className="grid grid-cols-2 md:grid-cols-3 gap-2"
                >
                  <input className="rounded-lg border border-gray-200 px-2 py-1" name="minute" type="number" min={0} placeholder="분" defaultValue={activeGoal.minute ?? ''} />
                  <input className="rounded-lg border border-gray-200 px-2 py-1" list="name-suggestions" name="scorer" placeholder="득점자(통합)" defaultValue={activeGoal.scorer_name ?? activeGoal.scorer_no ?? ''} />
                  <input className="rounded-lg border border-gray-200 px-2 py-1" list="name-suggestions" name="assist" placeholder="어시(통합)" defaultValue={activeGoal.assist_name ?? activeGoal.assist_no ?? ''} />
                  <div className="md:col-span-3 flex flex-wrap gap-2 justify-end">
                    <button className="rounded-lg border border-gray-200 px-2 py-1 text-xs" type="submit" name="set_none" value="scorer">득점자 미상</button>
                    <button className="rounded-lg border border-gray-200 px-2 py-1 text-xs" type="submit" name="set_none" value="assist">어시 없음</button>
                    <button className="rounded-lg border border-gray-200 px-2 py-1 text-xs" type="submit">이벤트 저장</button>
                  </div>
                </form>
                <form action={deleteGoalEvent.bind(null, matchId, activeGoal.id, activeGoal.team_side, channel.slug, channel.edit_session_version)}>
                  <button className="rounded-lg border border-red-200 text-red-700 px-2 py-1 text-xs" type="submit">이벤트 삭제</button>
                </form>
              </>
            )}

            {suggestedNames.length > 0 ? (
              <div className="space-y-1">
                <div className="text-xs text-gray-500">이 경기에서 자주 쓴 값 추천</div>
                <div className="flex flex-wrap gap-1">
                  {suggestedNames.map((name) => (
                    <span key={name} className="text-[11px] rounded-lg border border-gray-200 px-1.5 py-0.5 text-gray-600">{name}</span>
                  ))}
                </div>
              </div>
            ) : null}

            <datalist id="name-suggestions">
              {suggestedNames.map((name) => (
                <option key={`name-${name}`} value={name} />
              ))}
            </datalist>
          </section>
        ) : null}
      </section>
    </main>
  )
}
