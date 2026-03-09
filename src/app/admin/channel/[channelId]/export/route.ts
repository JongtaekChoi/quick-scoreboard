import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { getSupabaseServerClient } from '@/lib/supabase'
import { isAdminAuthorized } from '@/lib/adminAuth'
import { getAccountInfo } from '@/lib/channelSession'

type Channel = { id: string; name: string; slug: string }

function addSheetFromRows(workbook: ExcelJS.Workbook, name: string, rows: Record<string, unknown>[]) {
  const ws = workbook.addWorksheet(name)
  if (!rows.length) {
    ws.addRow(['(no data)'])
    return
  }

  const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
  ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.max(14, h.length + 2) }))
  for (const r of rows) {
    const flat: Record<string, unknown> = {}
    for (const h of headers) {
      const v = r[h]
      flat[h] = typeof v === 'object' && v !== null ? JSON.stringify(v) : v
    }
    ws.addRow(flat)
  }
  ws.getRow(1).font = { bold: true }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

export async function GET(_: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params
  const supabase = getSupabaseServerClient()
  if (!supabase) return NextResponse.json({ error: 'env_missing' }, { status: 500 })

  const { data: channel } = await supabase
    .from('channels')
    .select('id,name,slug')
    .eq('id', channelId)
    .maybeSingle<Channel>()

  if (!channel) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const adminCookie = await isAdminAuthorized()
  const account = await getAccountInfo(channel.slug)
  if (!adminCookie && account?.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const groupsRes = await supabase
    .from('match_groups')
    .select('*')
    .eq('channel_id', channel.id)
    .order('play_date', { ascending: false })
    .order('seq', { ascending: true })

  const matchesRes = await supabase
    .from('matches')
    .select('*')
    .eq('channel_id', channel.id)
    .order('match_group_id', { ascending: true })
    .order('seq', { ascending: true })

  const matchIds = (matchesRes.data ?? []).map((m) => m.id)

  const goalsRes = matchIds.length
    ? await supabase
        .from('goal_events')
        .select('*')
        .in('match_id', matchIds)
        .order('created_at', { ascending: true })
    : { data: [] as Record<string, unknown>[] }

  const [teamsRes, playersRes, accountsRes, entriesRes, guestsRes] = await Promise.all([
    supabase.from('channel_teams_view').select('*').eq('channel_id', channel.id).order('name', { ascending: true }),
    supabase.from('team_players').select('*').eq('channel_id', channel.id).order('team_id', { ascending: true }).order('jersey_no', { ascending: true }),
    supabase.from('channel_accounts').select('id,channel_id,role,login_id,team_id,player_id,is_active,must_change_password,session_version,created_at,updated_at').eq('channel_id', channel.id).order('role', { ascending: true }).order('login_id', { ascending: true }),
    supabase.from('match_group_entries').select('*').eq('channel_id', channel.id).order('match_group_id', { ascending: true }),
    supabase.from('match_group_guests').select('*').eq('channel_id', channel.id).order('match_group_id', { ascending: true }),
  ])

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'quick-scoreboard'
  workbook.created = new Date()

  addSheetFromRows(workbook, 'league_summary', [
    {
      channel_id: channel.id,
      channel_name: channel.name,
      channel_slug: channel.slug,
      exported_at_kst: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
      match_groups: groupsRes.data?.length ?? 0,
      matches: matchesRes.data?.length ?? 0,
      goals: goalsRes.data?.length ?? 0,
      teams: teamsRes.data?.length ?? 0,
      players: playersRes.data?.length ?? 0,
      accounts: accountsRes.data?.length ?? 0,
    },
  ])
  addSheetFromRows(workbook, 'match_groups', (groupsRes.data ?? []) as Record<string, unknown>[])
  addSheetFromRows(workbook, 'matches', (matchesRes.data ?? []) as Record<string, unknown>[])
  addSheetFromRows(workbook, 'goal_events', (goalsRes.data ?? []) as Record<string, unknown>[])
  addSheetFromRows(workbook, 'teams', (teamsRes.data ?? []) as Record<string, unknown>[])
  addSheetFromRows(workbook, 'team_players', (playersRes.data ?? []) as Record<string, unknown>[])
  addSheetFromRows(workbook, 'accounts', (accountsRes.data ?? []) as Record<string, unknown>[])
  addSheetFromRows(workbook, 'group_entries', (entriesRes.data ?? []) as Record<string, unknown>[])
  addSheetFromRows(workbook, 'group_guests', (guestsRes.data ?? []) as Record<string, unknown>[])

  const buffer = await workbook.xlsx.writeBuffer()
  const fileName = `quick-scoreboard_${channel.slug}_${new Date().toISOString().slice(0, 10)}.xlsx`

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  })
}
