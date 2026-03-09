import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase'

type Channel = { id: string; slug: string }
type TeamRow = { id: string; name: string }

const SAMPLE_TEAMS = ['FC 레드', 'FC 블루', 'FC 그린', 'FC 옐로']
const PASSWORD_HASH_TEST1234 = '937e8d5fbb48bd4949536cd65b8d35c426b80d2f830c5c308e2cdec422ae2244'

const SAMPLE_PLAYERS: Record<string, string[]> = {
  'FC 레드': ['김민수', '이정호', '박성진', '최준혁', '강대원', '윤태영'],
  'FC 블루': ['장동혁', '임상우', '홍기태', '배준서', '류시현', '남궁민'],
  'FC 그린': ['조현식', '문지훈', '황태호', '고은찬', '안병준', '신재호'],
  'FC 옐로': ['나상호', '허성민', '도현우', '주영웅', '탁민호', '엄기준'],
}

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const isVercelCron = req.headers.has('x-vercel-cron')

  if (secret) return auth === `Bearer ${secret}` || isVercelCron
  return isVercelCron
}

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

  // 1) sample 채널 하위 운영 데이터 삭제
  await supabase.from('matches').delete().eq('channel_id', channel.id)
  await supabase.from('match_group_guests').delete().eq('channel_id', channel.id)
  await supabase.from('match_group_entries').delete().eq('channel_id', channel.id)
  await supabase.from('match_groups').delete().eq('channel_id', channel.id)
  await supabase.from('match_change_logs').delete().eq('channel_id', channel.id)
  await supabase.from('player_ratings').delete().eq('channel_id', channel.id)

  // 2) 팀/선수/계정도 샘플 채널 기준 리셋
  await supabase.from('channel_accounts').delete().eq('channel_id', channel.id)
  await supabase.from('team_players').delete().eq('channel_id', channel.id)
  await supabase.from('channel_teams').delete().eq('channel_id', channel.id)

  // 3) 샘플 팀 보장 + 채널 연결
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

  // 4) 샘플 선수 재생성
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

  // 5) 샘플 계정 재생성 (공개 테스트용)
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

  // 6) 오늘 날짜 기준 샘플 그룹/경기 생성
  const today = new Date()
  const kst = new Date(today.getTime() + 9 * 60 * 60 * 1000)
  const yyyy = kst.getUTCFullYear()
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(kst.getUTCDate()).padStart(2, '0')
  const playDate = `${yyyy}-${mm}-${dd}`

  const { data: insertedGroup } = await supabase
    .from('match_groups')
    .insert({
      channel_id: channel.id,
      play_date: playDate,
      title: '샘플 자동 리셋 그룹',
      seq: 1,
      venue: 'Sample Arena',
    })
    .select('id')
    .maybeSingle<{ id: string }>()

  if (!insertedGroup) {
    return NextResponse.json({ ok: false, error: 'group_insert_failed' }, { status: 500 })
  }

  const selectedTeams = (teams ?? []).slice(0, 3)
  if (selectedTeams.length >= 3) {
    const [a, b, c] = selectedTeams
    await supabase.from('matches').insert([
      { channel_id: channel.id, match_group_id: insertedGroup.id, seq: 1, team_a_name: a.name, team_b_name: b.name, status: 'scheduled' },
      { channel_id: channel.id, match_group_id: insertedGroup.id, seq: 2, team_a_name: a.name, team_b_name: c.name, status: 'scheduled' },
      { channel_id: channel.id, match_group_id: insertedGroup.id, seq: 3, team_a_name: b.name, team_b_name: c.name, status: 'scheduled' },
    ])
  }

  return NextResponse.json({ ok: true, channel: channel.slug, playDate, teams: teams?.length ?? 0 })
}
