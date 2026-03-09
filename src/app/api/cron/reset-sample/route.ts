import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase'

type Channel = { id: string; slug: string }
type TeamRow = { id: string; name: string }

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = req.headers.get('authorization') || ''
  return auth === `Bearer ${secret}`
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

  await supabase.from('matches').delete().eq('channel_id', channel.id)
  await supabase.from('match_group_guests').delete().eq('channel_id', channel.id)
  await supabase.from('match_group_entries').delete().eq('channel_id', channel.id)
  await supabase.from('match_groups').delete().eq('channel_id', channel.id)
  await supabase.from('match_change_logs').delete().eq('channel_id', channel.id)

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

  const { data: teams } = await supabase
    .from('channel_teams_view')
    .select('id,name')
    .eq('channel_id', channel.id)
    .order('name', { ascending: true })
    .limit(3)
    .returns<TeamRow[]>()

  if ((teams ?? []).length >= 3) {
    const [a, b, c] = teams as TeamRow[]
    await supabase.from('matches').insert([
      {
        channel_id: channel.id,
        match_group_id: insertedGroup.id,
        seq: 1,
        team_a_name: a.name,
        team_b_name: b.name,
        status: 'scheduled',
      },
      {
        channel_id: channel.id,
        match_group_id: insertedGroup.id,
        seq: 2,
        team_a_name: a.name,
        team_b_name: c.name,
        status: 'scheduled',
      },
      {
        channel_id: channel.id,
        match_group_id: insertedGroup.id,
        seq: 3,
        team_a_name: b.name,
        team_b_name: c.name,
        status: 'scheduled',
      },
    ])
  }

  return NextResponse.json({ ok: true, channel: channel.slug, playDate })
}
