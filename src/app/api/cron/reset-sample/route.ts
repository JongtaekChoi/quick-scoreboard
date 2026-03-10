import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase'

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

type Channel = { id: string; slug: string }
type TeamRow = { id: string; name: string }
type PlayerRow = { id: string; team_id: string; player_name: string }
type MatchRow = {
  id: string
  team_a_name: string
  team_b_name: string
  match_group_id: string | null
}

const SAMPLE_TEAMS = ['FC 레드', 'FC 블루', 'FC 그린', 'FC 옐로']
const PASSWORD_HASH_TEST1234 = '937e8d5fbb48bd4949536cd65b8d35c426b80d2f830c5c308e2cdec422ae2244'

const SAMPLE_PLAYERS: Record<string, string[]> = {
  'FC 레드': ['김민수', '이정호', '박성진', '최준혁', '강대원', '윤태영'],
  'FC 블루': ['장동혁', '임상우', '홍기태', '배준서', '류시현', '남궁민'],
  'FC 그린': ['조현식', '문지훈', '황태호', '고은찬', '안병준', '신재호'],
  'FC 옐로': ['나상호', '허성민', '도현우', '주영웅', '탁민호', '엄기준'],
}

const VENUES = ['서울 월드컵경기장', '수원 빅버드', '인천 축구전용경기장', '대전 월드컵경기장']

// 4팀 중 3팀 선택 조합 (인덱스)
const TEAM_COMBOS = [
  [0, 1, 2],
  [1, 2, 3],
  [0, 2, 3],
  [0, 1, 3],
]

// 골 수 가중 분포: 0→10%, 1→15%, 2→25%, 3→25%, 4→15%, 5→10%
const GOAL_WEIGHTS = [10, 15, 25, 25, 15, 10]

const EPOCH = new Date('2026-01-01T00:00:00Z')
const ROLLING_DAYS = 12
const CYCLE_DAYS = 3

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const isVercelCron = req.headers.has('x-vercel-cron')
  if (secret) return auth === `Bearer ${secret}` || isVercelCron
  return isVercelCron
}

/** KST 기준 오늘 날짜를 yyyy-mm-dd로 반환 */
function todayKST(): string {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const y = kst.getUTCFullYear()
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const d = String(kst.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 날짜 문자열에서 N일 전 날짜 반환 */
function subtractDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - days)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/** epoch 으로부터의 일 수 기반 3일 주기 라운드 번호 */
function roundNumber(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00Z')
  const diffMs = d.getTime() - EPOCH.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  return Math.floor(diffDays / CYCLE_DAYS)
}

/** 가중 랜덤으로 골 수 결정 */
function weightedGoalCount(): number {
  const total = GOAL_WEIGHTS.reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  for (let i = 0; i < GOAL_WEIGHTS.length; i++) {
    r -= GOAL_WEIGHTS[i]
    if (r <= 0) return i
  }
  return GOAL_WEIGHTS.length - 1
}

/** min~max 사이 정수 (inclusive) */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/** 배열에서 랜덤 요소 하나 */
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/* ------------------------------------------------------------------ */
/*  Main handler                                                      */
/* ------------------------------------------------------------------ */

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ error: 'env_missing' }, { status: 500 })
  }

  const { data: channel } = await supabase
    .from('channels')
    .select('id,slug')
    .eq('slug', 'sample')
    .maybeSingle<Channel>()

  if (!channel) {
    return NextResponse.json({ ok: true, message: 'sample channel not found; skipped' })
  }

  const today = todayKST()
  const log: string[] = []

  // ── Step 1: 팀/선수/계정 보장 (upsert) ──────────────────────────
  await supabase.from('teams').upsert(SAMPLE_TEAMS.map((name) => ({ name })), { onConflict: 'name' })

  const { data: teams } = await supabase
    .from('teams')
    .select('id,name')
    .in('name', SAMPLE_TEAMS)
    .returns<TeamRow[]>()

  const teamMap = new Map((teams ?? []).map((t) => [t.name, t.id]))

  await supabase.from('channel_teams').upsert(
    (teams ?? []).map((t) => ({ channel_id: channel.id, team_id: t.id })),
    { onConflict: 'channel_id,team_id' },
  )

  for (const teamName of SAMPLE_TEAMS) {
    const teamId = teamMap.get(teamName)
    if (!teamId) continue
    const players = SAMPLE_PLAYERS[teamName] ?? []
    await supabase.from('team_players').upsert(
      players.map((playerName, idx) => ({
        channel_id: channel.id,
        team_id: teamId,
        jersey_no: String(idx + 1),
        player_name: playerName,
        is_active: true,
      })),
      { onConflict: 'channel_id,team_id,jersey_no' },
    )
  }

  const red = teamMap.get('FC 레드')
  const blue = teamMap.get('FC 블루')
  const green = teamMap.get('FC 그린')
  const yellow = teamMap.get('FC 옐로')

  await supabase.from('channel_accounts').upsert(
    [
      { channel_id: channel.id, role: 'admin', login_id: 'admin', password_hash: PASSWORD_HASH_TEST1234, team_id: null, is_active: true, must_change_password: false },
      { channel_id: channel.id, role: 'manager', login_id: 'mgr-red', password_hash: PASSWORD_HASH_TEST1234, team_id: red ?? null, is_active: true, must_change_password: false },
      { channel_id: channel.id, role: 'manager', login_id: 'mgr-blue', password_hash: PASSWORD_HASH_TEST1234, team_id: blue ?? null, is_active: true, must_change_password: false },
      { channel_id: channel.id, role: 'manager', login_id: 'mgr-green', password_hash: PASSWORD_HASH_TEST1234, team_id: green ?? null, is_active: true, must_change_password: false },
      { channel_id: channel.id, role: 'manager', login_id: 'mgr-yellow', password_hash: PASSWORD_HASH_TEST1234, team_id: yellow ?? null, is_active: true, must_change_password: false },
    ],
    { onConflict: 'channel_id,login_id' },
  )
  log.push('step1: teams/players/accounts ensured')

  // ── Step 2: 12일 이전 롤링 삭제 ─────────────────────────────────
  const cutoff = subtractDays(today, ROLLING_DAYS)

  const { data: oldGroups } = await supabase
    .from('match_groups')
    .select('id')
    .eq('channel_id', channel.id)
    .lt('play_date', cutoff)
    .returns<{ id: string }[]>()

  const oldGroupIds = (oldGroups ?? []).map((g) => g.id)

  if (oldGroupIds.length > 0) {
    // matches는 match_group 삭제 시 SET NULL이므로 먼저 삭제
    // matches 삭제 시 goal_events, match_change_logs, player_ratings CASCADE
    await supabase.from('matches').delete().in('match_group_id', oldGroupIds)
    // match_groups 삭제 시 match_group_entries, match_group_guests CASCADE
    await supabase.from('match_groups').delete().in('id', oldGroupIds)
  }

  // match_group_id가 null인 orphan matches도 삭제
  await supabase
    .from('matches')
    .delete()
    .eq('channel_id', channel.id)
    .is('match_group_id', null)

  log.push(`step2: rolling delete cutoff=${cutoff}, removed ${oldGroupIds.length} groups`)

  // ── Step 3: 과거 미종료 경기에 랜덤 결과 기록 ───────────────────
  // 오늘 이전 play_date의 match_group에 속한 미종료 경기 조회
  const { data: pastGroups } = await supabase
    .from('match_groups')
    .select('id')
    .eq('channel_id', channel.id)
    .lt('play_date', today)
    .returns<{ id: string }[]>()

  const pastGroupIds = (pastGroups ?? []).map((g) => g.id)
  let resultsGenerated = 0

  if (pastGroupIds.length > 0) {
    const { data: pendingMatches } = await supabase
      .from('matches')
      .select('id,team_a_name,team_b_name,match_group_id')
      .eq('channel_id', channel.id)
      .in('match_group_id', pastGroupIds)
      .neq('status', 'ended')
      .returns<MatchRow[]>()

    // 모든 선수 조회 (골 이벤트 생성용)
    const { data: allPlayers } = await supabase
      .from('team_players')
      .select('id,team_id,player_name')
      .eq('channel_id', channel.id)
      .eq('is_active', true)
      .returns<PlayerRow[]>()

    const playersByTeamId = new Map<string, PlayerRow[]>()
    for (const p of allPlayers ?? []) {
      const list = playersByTeamId.get(p.team_id) ?? []
      list.push(p)
      playersByTeamId.set(p.team_id, list)
    }

    for (const match of pendingMatches ?? []) {
      const teamAId = teamMap.get(match.team_a_name)
      const teamBId = teamMap.get(match.team_b_name)
      if (!teamAId || !teamBId) continue

      const playersA = playersByTeamId.get(teamAId) ?? []
      const playersB = playersByTeamId.get(teamBId) ?? []
      if (playersA.length === 0 || playersB.length === 0) continue

      const totalGoals = weightedGoalCount()

      if (totalGoals > 0) {
        // 각 골에 랜덤 분 배정 후 정렬
        const minutes = Array.from({ length: totalGoals }, () => randInt(1, 90)).sort((a, b) => a - b)

        const goalEvents = minutes.map((minute) => {
          const teamSide = Math.random() < 0.5 ? 'A' : 'B'
          const players = teamSide === 'A' ? playersA : playersB
          const scorer = pickRandom(players)
          const others = players.filter((p) => p.id !== scorer.id)
          const hasAssist = others.length > 0 && Math.random() > 0.3
          const assister = hasAssist ? pickRandom(others) : null
          const isFirstHalf = minute <= 45

          return {
            match_id: match.id,
            team_side: teamSide,
            minute,
            period: isFirstHalf ? 'first_half' : 'second_half',
            scorer_name: scorer.player_name,
            scorer_player_id: scorer.id,
            assist_name: assister?.player_name ?? null,
            assist_player_id: assister?.id ?? null,
          }
        })

        await supabase.from('goal_events').insert(goalEvents)

        const scoreA = goalEvents.filter((g) => g.team_side === 'A').length
        const scoreB = goalEvents.filter((g) => g.team_side === 'B').length

        await supabase
          .from('matches')
          .update({
            status: 'ended',
            score_a: scoreA,
            score_b: scoreB,
            ended_at: new Date().toISOString(),
            period_state: 'ended',
          })
          .eq('id', match.id)
      } else {
        // 0-0
        await supabase
          .from('matches')
          .update({
            status: 'ended',
            score_a: 0,
            score_b: 0,
            ended_at: new Date().toISOString(),
            period_state: 'ended',
          })
          .eq('id', match.id)
      }

      resultsGenerated++
    }
  }

  log.push(`step3: generated results for ${resultsGenerated} past matches`)

  // ── Step 4: 오늘 경기 생성 ──────────────────────────────────────
  // 이미 오늘 match_group이 있는지 확인
  const { data: existingToday } = await supabase
    .from('match_groups')
    .select('id')
    .eq('channel_id', channel.id)
    .eq('play_date', today)
    .returns<{ id: string }[]>()

  const hasTodayGroup = (existingToday ?? []).length > 0

  // 3일 주기 판단
  const todayRound = roundNumber(today)
  const diffMs = new Date(today + 'T00:00:00Z').getTime() - EPOCH.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const isMatchDay = diffDays % CYCLE_DAYS === 0

  // 경기일이거나, 오늘 match_group이 없으면 항상 생성
  const shouldCreate = !hasTodayGroup && (isMatchDay || !hasTodayGroup)

  if (shouldCreate && (teams ?? []).length >= 4) {
    const round = isMatchDay ? todayRound : todayRound // round 번호로 로테이션
    const comboIdx = ((round % TEAM_COMBOS.length) + TEAM_COMBOS.length) % TEAM_COMBOS.length
    const venueIdx = ((round % VENUES.length) + VENUES.length) % VENUES.length
    const combo = TEAM_COMBOS[comboIdx]
    const selectedTeams = combo.map((i) => (teams ?? [])[i])
    const venue = VENUES[venueIdx]

    const { data: insertedGroup } = await supabase
      .from('match_groups')
      .insert({
        channel_id: channel.id,
        play_date: today,
        title: '샘플 경기',
        seq: 1,
        venue,
      })
      .select('id')
      .maybeSingle<{ id: string }>()

    if (insertedGroup && selectedTeams.length >= 3) {
      const [a, b, c] = selectedTeams
      await supabase.from('matches').insert([
        { channel_id: channel.id, match_group_id: insertedGroup.id, seq: 1, team_a_name: a.name, team_b_name: b.name, status: 'scheduled' },
        { channel_id: channel.id, match_group_id: insertedGroup.id, seq: 2, team_a_name: a.name, team_b_name: c.name, status: 'scheduled' },
        { channel_id: channel.id, match_group_id: insertedGroup.id, seq: 3, team_a_name: b.name, team_b_name: c.name, status: 'scheduled' },
      ])
      log.push(`step4: created today group at ${venue} with teams [${selectedTeams.map((t) => t.name).join(', ')}]`)
    }
  } else if (hasTodayGroup) {
    log.push('step4: today group already exists, skipped')
  } else {
    log.push('step4: not enough teams, skipped')
  }

  return NextResponse.json({ ok: true, channel: channel.slug, today, log })
}
