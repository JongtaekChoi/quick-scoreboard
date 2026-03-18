import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { getSupabaseServerClient } from '@/lib/supabase'
import { isAdminAuthorized } from '@/lib/adminAuth'
import { getAccountInfo, validateManagerAgainstDb } from '@/lib/channelSession'
import PendingSubmitButton from '@/components/PendingSubmitButton'
import TransientToast from '@/components/TransientToast'
import { ensureTeamInChannel } from '@/lib/teamHelpers'

type Channel = { id: string; name: string; slug: string; edit_session_version: number }
type MatchGroup = {
  id: string
  play_date: string
  venue: string | null
  title: string | null
  seq: number
  entry_confirmed_at: string | null
}
type Match = { id: string; seq: number; team_a_id: string | null; team_b_id: string | null; team_a_name: string; team_b_name: string; score_a: number; score_b: number; status: 'scheduled' | 'live' | 'ended'; scheduled_start_at: string | null; period_count: number }
type Team = { id: string; name: string }
type TeamPlayer = { id: string; team_id: string; jersey_no: string; player_name: string; is_active: boolean }
type GroupEntry = { id: string; team_id: string; player_id: string }
type GroupGuest = { id: string; team_id: string; source_team_id: string; source_player_id: string | null; guest_name: string }
type MatchPeriod = { id: string; match_id: string; sequence: number; label: string | null; period_code: string | null }
type MatchPeriodLineup = { match_period_id: string; team_side: 'A' | 'B'; player_id: string | null }

const GROUP_FEEDBACK_COOKIE = 'qsb_group_feedback'

async function setGroupFeedback(code: string) {
  const store = await cookies()
  store.set(GROUP_FEEDBACK_COOKIE, `${code}:${Date.now()}`, {
    path: '/',
    maxAge: 10,
    sameSite: 'lax',
  })
}

async function canManageChannel(channelId: string) {
  const supabase = getSupabaseServerClient()
  if (!supabase) return { allowed: false, channel: null as Channel | null }

  const { data: channel } = await supabase
    .from('channels')
    .select('id,name,slug,edit_session_version')
    .eq('id', channelId)
    .maybeSingle<Channel>()

  if (!channel) return { allowed: false, channel: null as Channel | null }

  const isAdmin = await isAdminAuthorized()
  if (isAdmin) return { allowed: true, channel }

  const account = await getAccountInfo(channel.slug)
  if (account?.role === 'admin') return { allowed: true, channel, managerTeamId: null as string | null }

  const { ok, teamId } = await validateManagerAgainstDb(channel.slug, channel.id)
  return { allowed: ok, channel, managerTeamId: teamId }
}

function toTimeLocalValue(iso: string | null) {
  if (!iso) return ""
  const d = new Date(iso)
  const hh = String(d.getUTCHours()).padStart(2, "0")
  const mm = String(d.getUTCMinutes()).padStart(2, "0")
  return `${hh}:${mm}`
}

async function createMatch(formData: FormData) {
  'use server'
  const channelId = String(formData.get('channelId') || '')
  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }
  const groupId = String(formData.get('groupId') || '')
  if (manage.managerTeamId) {
    await setGroupFeedback('forbidden')
    return
  }
  const teamA = String(formData.get('team_a_name') || '').trim()
  const teamB = String(formData.get('team_b_name') || '').trim()
  const periodCount = Math.max(1, Math.min(12, Number(formData.get('period_count') || 2) || 2))
  if (!channelId || !groupId || !teamA || !teamB) return

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  const { data: lastMatch } = await supabase
    .from('matches')
    .select('seq')
    .eq('match_group_id', groupId)
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle<{ seq: number }>()

  const nextSeq = (lastMatch?.seq ?? 0) + 1

  const [teamAId, teamBId] = await Promise.all([
    ensureTeamInChannel(supabase, channelId, teamA),
    ensureTeamInChannel(supabase, channelId, teamB),
  ])

  const { data: insertedMatch } = await supabase.from('matches').insert({
    channel_id: channelId,
    match_group_id: groupId,
    seq: nextSeq,
    team_a_name: teamA,
    team_b_name: teamB,
    team_a_id: teamAId,
    team_b_id: teamBId,
    score_a: 0,
    score_b: 0,
    status: 'scheduled',
    period_count: periodCount,
  }).select('id').maybeSingle<{ id: string }>()

  if (insertedMatch?.id) {
    await supabase.from('match_periods').insert(
      Array.from({ length: periodCount }, (_, idx) => ({
        match_id: insertedMatch.id,
        sequence: idx + 1,
        period_code: idx + 1 <= 4 ? `Q${idx + 1}` : `P${idx + 1}`,
        label: `${idx + 1}P`,
      })),
    )
  }

  redirect(`/admin/channel/${channelId}/group/${groupId}`)
}

async function updateMatch(formData: FormData) {
  'use server'
  const channelId = String(formData.get('channelId') || '')
  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }
  const groupId = String(formData.get('groupId') || '')
  if (manage.managerTeamId) {
    await setGroupFeedback('forbidden')
    return
  }
  const matchId = String(formData.get('matchId') || '')
  const teamA = String(formData.get('team_a_name') || '').trim()
  const teamB = String(formData.get('team_b_name') || '').trim()
  const status = String(formData.get('status') || 'scheduled') as 'scheduled' | 'live' | 'ended'
  const periodCount = Math.max(1, Math.min(12, Number(formData.get('period_count') || 2) || 2))
  const groupPlayDate = String(formData.get('group_play_date') || '').trim()
  const scheduledStartRaw = String(formData.get('scheduled_start_time') || '').trim()
  const scheduledStartAt =
    scheduledStartRaw && groupPlayDate
      ? new Date(`${groupPlayDate}T${scheduledStartRaw}:00+09:00`).toISOString()
      : null
  if (!channelId || !groupId || !matchId || !teamA || !teamB) return

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  const [teamAId, teamBId] = await Promise.all([
    ensureTeamInChannel(supabase, channelId, teamA),
    ensureTeamInChannel(supabase, channelId, teamB),
  ])

  await supabase
    .from('matches')
    .update({
      team_a_name: teamA,
      team_b_name: teamB,
      team_a_id: teamAId,
      team_b_id: teamBId,
      status,
      period_count: periodCount,
      scheduled_start_at: status === 'ended' ? null : scheduledStartAt,
    })
    .eq('id', matchId)

  const { data: periodRows } = await supabase
    .from('match_periods')
    .select('id,sequence,status')
    .eq('match_id', matchId)
    .is('deleted_at', null)
    .returns<{ id: string; sequence: number; status: 'pending' | 'live' | 'ended' }[]>()

  const existing = periodRows ?? []
  const maxSeq = existing.reduce((max, row) => Math.max(max, row.sequence), 0)
  if (maxSeq < periodCount) {
    await supabase.from('match_periods').insert(
      Array.from({ length: periodCount - maxSeq }, (_, i) => {
        const seq = maxSeq + i + 1
        return {
          match_id: matchId,
          sequence: seq,
          period_code: seq <= 4 ? `Q${seq}` : `P${seq}`,
          label: `${seq}P`,
        }
      }),
    )
  }

  redirect(`/admin/channel/${channelId}/group/${groupId}`)
}

async function deleteMatch(formData: FormData) {
  'use server'
  const channelId = String(formData.get('channelId') || '')
  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }
  const groupId = String(formData.get('groupId') || '')
  if (manage.managerTeamId) {
    await setGroupFeedback('forbidden')
    return
  }
  const matchId = String(formData.get('matchId') || '')
  if (!channelId || !groupId || !matchId) return

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  await supabase.from('goal_events').update({ deleted_at: new Date().toISOString() }).eq('match_id', matchId)
  await supabase.from('matches').delete().eq('id', matchId)

  redirect(`/admin/channel/${channelId}/group/${groupId}`)
}

async function applyForfeitResult(formData: FormData) {
  'use server'
  const channelId = String(formData.get('channelId') || '')
  const groupId = String(formData.get('groupId') || '')
  const matchId = String(formData.get('matchId') || '')
  const winnerSide = String(formData.get('winnerSide') || '') as 'A' | 'B'

  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }
  if (manage.managerTeamId) {
    await setGroupFeedback('forbidden')
    return
  }

  if (!channelId || !groupId || !matchId || (winnerSide !== 'A' && winnerSide !== 'B')) return

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  const now = new Date().toISOString()

  await supabase
    .from('matches')
    .update({
      status: 'ended',
      period_state: 'ended',
      score_a: winnerSide === 'A' ? 3 : 0,
      score_b: winnerSide === 'B' ? 3 : 0,
      ended_at: now,
      scheduled_start_at: null,
    })
    .eq('id', matchId)

  await supabase
    .from('match_periods')
    .update({ status: 'ended', ended_at: now })
    .eq('match_id', matchId)
    .is('deleted_at', null)

  redirect(`/admin/channel/${channelId}/group/${groupId}`)
}

async function saveGroupEntries(formData: FormData) {
  'use server'
  const channelId = String(formData.get('channelId') || '')
  const groupId = String(formData.get('groupId') || '')
  const teamId = String(formData.get('teamId') || '')
  const playerIds = formData.getAll('playerIds').map((v) => String(v)).filter(Boolean)
  const sourcePlayer = String(formData.get('sourcePlayer') || '')
  const confirmCleanup = String(formData.get('confirm_cleanup') || '0') === '1'

  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }

  if (!channelId || !groupId || !teamId) return
  if (manage.managerTeamId && manage.managerTeamId !== teamId) {
    await setGroupFeedback('team_scope')
    return
  }

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  if (manage.managerTeamId) {
    const [{ data: ownTeam }, { data: groupMatches }] = await Promise.all([
      supabase.from('teams').select('name').eq('id', manage.managerTeamId).maybeSingle<{ name: string }>(),
      supabase
        .from('matches')
        .select('team_a_id,team_b_id,team_a_name,team_b_name')
        .eq('match_group_id', groupId)
        .returns<{ team_a_id: string | null; team_b_id: string | null; team_a_name: string; team_b_name: string }[]>(),
    ])

    const participates = (groupMatches ?? []).some((m) => {
      const byId = m.team_a_id === manage.managerTeamId || m.team_b_id === manage.managerTeamId
      const byName = ownTeam?.name ? m.team_a_name === ownTeam.name || m.team_b_name === ownTeam.name : false
      return byId || byName
    })

    if (!participates) {
      await setGroupFeedback('team_not_in_group')
      return
    }
  }

  const { data: team } = await supabase
    .from('teams')
    .select('id,name')
    .eq('id', teamId)
    .maybeSingle<{ id: string; name: string }>()

  const { data: matches } = await supabase
    .from('matches')
    .select('id,team_a_id,team_b_id,team_a_name,team_b_name')
    .eq('match_group_id', groupId)
    .returns<{ id: string; team_a_id: string | null; team_b_id: string | null; team_a_name: string; team_b_name: string }[]>()

  const affectedMatchSides = (matches ?? [])
    .map((m) => {
      const asA = m.team_a_id === teamId || (team?.name ? m.team_a_name === team.name : false)
      const asB = m.team_b_id === teamId || (team?.name ? m.team_b_name === team.name : false)
      if (asA) return { matchId: m.id, side: 'A' as const }
      if (asB) return { matchId: m.id, side: 'B' as const }
      return null
    })
    .filter((v): v is { matchId: string; side: 'A' | 'B' } => Boolean(v))

  if (!confirmCleanup && affectedMatchSides.length > 0) {
    const { data: existingLineups } = await supabase
      .from('match_period_lineups')
      .select('id,match_id,team_side')
      .in('match_id', affectedMatchSides.map((x) => x.matchId))
      .is('deleted_at', null)
      .returns<{ id: string; match_id: string; team_side: 'A' | 'B' }[]>()

    const sideKey = new Set(affectedMatchSides.map((x) => `${x.matchId}:${x.side}`))
    const hasStarterChanges = (existingLineups ?? []).some((r) => sideKey.has(`${r.match_id}:${r.team_side}`))
    if (hasStarterChanges) {
      await setGroupFeedback('entry_affects_starters')
      return
    }
  }

  await supabase
    .from('match_group_entries')
    .delete()
    .eq('match_group_id', groupId)
    .eq('team_id', teamId)

  if (playerIds.length > 0) {
    await supabase.from('match_group_entries').insert(
      playerIds.map((playerId) => ({
        channel_id: channelId,
        match_group_id: groupId,
        team_id: teamId,
        player_id: playerId,
      })),
    )
  }

  if (affectedMatchSides.length > 0) {
    for (const target of affectedMatchSides) {
      let q = supabase
        .from('match_period_lineups')
        .update({ deleted_at: new Date().toISOString() })
        .eq('match_id', target.matchId)
        .eq('team_side', target.side)
        .is('deleted_at', null)
      if (playerIds.length > 0) q = q.not('player_id', 'in', `(${playerIds.map((id) => `"${id}"`).join(',')})`)
      await q
    }
  }

  if (sourcePlayer === '__NONE__') {
    await supabase
      .from('match_group_guests')
      .delete()
      .eq('match_group_id', groupId)
      .eq('team_id', teamId)
  } else if (sourcePlayer) {
    const [sourceTeamId, sourcePlayerId, guestName] = sourcePlayer.split('|')
    if (sourceTeamId && sourcePlayerId && guestName && sourceTeamId !== teamId) {
      await supabase
        .from('match_group_guests')
        .upsert(
          {
            channel_id: channelId,
            match_group_id: groupId,
            team_id: teamId,
            source_team_id: sourceTeamId,
            source_player_id: sourcePlayerId,
            guest_name: guestName,
          },
          { onConflict: 'match_group_id,team_id' },
        )
    }
  }

  revalidatePath(`/admin/channel/${channelId}/group/${groupId}`)
  return
}

async function saveMatchStarters(formData: FormData) {
  'use server'
  const channelId = String(formData.get('channelId') || '')
  const groupId = String(formData.get('groupId') || '')
  const matchId = String(formData.get('matchId') || '')
  const teamId = String(formData.get('teamId') || '')
  const teamSide = String(formData.get('teamSide') || '') as 'A' | 'B'
  const periodSequence = Number(formData.get('periodSequence') || 1)
  const playerIds = formData.getAll('playerIds').map((v) => String(v)).filter(Boolean)

  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }

  if (!channelId || !groupId || !matchId || !teamId || (teamSide !== 'A' && teamSide !== 'B')) return
  if (manage.managerTeamId && manage.managerTeamId !== teamId) {
    await setGroupFeedback('team_scope')
    return
  }
  if (!Number.isFinite(periodSequence) || periodSequence < 1) {
    await setGroupFeedback('starter_period')
    return
  }

  if (playerIds.length === 0) {
    await setGroupFeedback('starter_count')
    return
  }

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  if (manage.managerTeamId) {
    const [{ data: ownTeam }, { data: groupMatches }] = await Promise.all([
      supabase.from('teams').select('name').eq('id', manage.managerTeamId).maybeSingle<{ name: string }>(),
      supabase
        .from('matches')
        .select('team_a_id,team_b_id,team_a_name,team_b_name')
        .eq('match_group_id', groupId)
        .returns<{ team_a_id: string | null; team_b_id: string | null; team_a_name: string; team_b_name: string }[]>(),
    ])

    const participates = (groupMatches ?? []).some((m) => {
      const byId = m.team_a_id === manage.managerTeamId || m.team_b_id === manage.managerTeamId
      const byName = ownTeam?.name ? m.team_a_name === ownTeam.name || m.team_b_name === ownTeam.name : false
      return byId || byName
    })

    if (!participates) {
      await setGroupFeedback('team_not_in_group')
      return
    }
  }

  const { data: period } = await supabase
    .from('match_periods')
    .select('id')
    .eq('match_id', matchId)
    .eq('sequence', periodSequence)
    .is('deleted_at', null)
    .maybeSingle<{ id: string }>()

  if (!period) {
    await setGroupFeedback('starter_period')
    return
  }

  await supabase
    .from('match_period_lineups')
    .update({ deleted_at: new Date().toISOString() })
    .eq('match_id', matchId)
    .eq('match_period_id', period.id)
    .eq('team_side', teamSide)
    .is('deleted_at', null)

  await supabase.from('match_period_lineups').insert(
    playerIds.map((playerId) => ({
      match_id: matchId,
      match_period_id: period.id,
      team_side: teamSide,
      player_id: playerId,
      is_starter: true,
    })),
  )

  revalidatePath(`/admin/channel/${channelId}/group/${groupId}`)
  return
}

async function toggleEntryConfirm(formData: FormData) {
  'use server'
  const channelId = String(formData.get('channelId') || '')
  const groupId = String(formData.get('groupId') || '')
  const next = String(formData.get('next') || '')

  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }

  if (!channelId || !groupId) return
  if (manage.managerTeamId) {
    await setGroupFeedback('forbidden')
    return
  }

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  await supabase
    .from('match_groups')
    .update({ entry_confirmed_at: next === '1' ? new Date().toISOString() : null })
    .eq('id', groupId)

  revalidatePath(`/admin/channel/${channelId}/group/${groupId}`)
  return
}

export default async function AdminGroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ channelId: string; groupId: string }>
  searchParams: Promise<{ from?: string; err?: string; tab?: string; warn_team?: string }>
}) {
  const { channelId, groupId } = await params
  const { from, err, tab: tabParam, warn_team: warnTeam } = await searchParams
  const tab = tabParam === 'entries' ? 'entries' : 'matches'
  const fromChannel = from === 'channel'
  const store = await cookies()
  const rawFeedback = err ?? store.get(GROUP_FEEDBACK_COOKIE)?.value ?? null
  const feedbackCode = rawFeedback ? rawFeedback.split(':', 1)[0] : null
  const toastMessageMap: Record<string, string> = {
    forbidden: '권한이 없습니다.',
    team_scope: '본인 팀만 제출할 수 있습니다.',
    team_not_in_group: '이 경기그룹 참여팀만 엔트리 제출할 수 있습니다.',
    starter_count: '선발을 1명 이상 선택해 주세요.',
    starter_period: '선발 period를 확인해 주세요.',
    entry_affects_starters: '엔트리 변경 시 기존 선발이 정리됩니다. 다시 제출해 주세요.',
    guest_source: '용병 소속팀은 동일 팀으로 선택할 수 없습니다.',
  }
  const toastMessage = feedbackCode ? toastMessageMap[feedbackCode] : null
  const supabase = getSupabaseServerClient()
  if (!supabase) return <main className="p-6">Supabase env가 필요합니다.</main>

  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) {
      const next = encodeURIComponent(`/admin/channel/${channelId}/group/${groupId}?from=${from ?? ''}&tab=${tab}`)
      redirect(`/c/${manage.channel.slug}?mgr=expired&next=${next}`)
    }
    redirect('/admin/login')
  }

  const channel = manage.channel
  const managerTeamId = manage.managerTeamId
  const [{ data: group }, { data: matches }, { data: teams }, { data: players }, { data: entries }, { data: guests }] = await Promise.all([
    supabase.from('match_groups').select('id,play_date,venue,title,seq,entry_confirmed_at').eq('id', groupId).maybeSingle<MatchGroup>(),
    supabase.from('matches').select('id,seq,team_a_id,team_b_id,team_a_name,team_b_name,score_a,score_b,status,scheduled_start_at,period_count').eq('match_group_id', groupId).order('seq', { ascending: true }).returns<Match[]>(),
    supabase.from('channel_teams_view').select('id,name').eq('channel_id', channelId).order('last_used_at', { ascending: false }).limit(50).returns<Team[]>(),
    supabase.from('team_players').select('id,team_id,jersey_no,player_name,is_active').eq('channel_id', channelId).eq('is_active', true).order('jersey_no', { ascending: true }).returns<TeamPlayer[]>(),
    supabase.from('match_group_entries').select('id,team_id,player_id').eq('match_group_id', groupId).returns<GroupEntry[]>(),
    supabase.from('match_group_guests').select('id,team_id,source_team_id,source_player_id,guest_name').eq('match_group_id', groupId).returns<GroupGuest[]>(),
  ])

  if (!channel || !group) return <main className="p-6">리그/그룹을 찾을 수 없습니다.</main>

  const matchIds = (matches ?? []).map((m) => m.id)

  const [{ data: matchPeriods }, { data: periodLineups }] = await Promise.all([
    matchIds.length
      ? supabase
          .from('match_periods')
          .select('id,match_id,sequence,label,period_code')
          .in('match_id', matchIds)
          .is('deleted_at', null)
          .order('sequence', { ascending: true })
          .returns<MatchPeriod[]>()
      : Promise.resolve({ data: [] as MatchPeriod[] }),
    matchIds.length
      ? supabase
          .from('match_period_lineups')
          .select('match_period_id,team_side,player_id')
          .in('match_id', matchIds)
          .is('deleted_at', null)
          .returns<MatchPeriodLineup[]>()
      : Promise.resolve({ data: [] as MatchPeriodLineup[] })
  ])

  const playersByTeam = new Map<string, TeamPlayer[]>()
  const playersById = new Map<string, TeamPlayer>()
  for (const p of players ?? []) {
    const arr = playersByTeam.get(p.team_id) ?? []
    arr.push(p)
    playersByTeam.set(p.team_id, arr)
    playersById.set(p.id, p)
  }

  const entriesByTeam = new Map<string, GroupEntry[]>()
  for (const e of entries ?? []) {
    const arr = entriesByTeam.get(e.team_id) ?? []
    arr.push(e)
    entriesByTeam.set(e.team_id, arr)
  }

  const guestByTeam = new Map<string, GroupGuest>()
  for (const g of guests ?? []) {
    guestByTeam.set(g.team_id, g)
  }

  const teamNameMap = new Map((teams ?? []).map((t) => [t.id, t.name]))
  const teamIdByName = new Map((teams ?? []).map((t) => [t.name, t.id]))

  const periodsByMatch = new Map<string, MatchPeriod[]>()
  for (const p of matchPeriods ?? []) {
    const arr = periodsByMatch.get(p.match_id) ?? []
    arr.push(p)
    periodsByMatch.set(p.match_id, arr)
  }
  for (const [, arr] of periodsByMatch) {
    arr.sort((a, b) => a.sequence - b.sequence)
  }

  const lineupPlayersByPeriodSide = new Map<string, Set<string>>()
  for (const row of periodLineups ?? []) {
    if (!row.player_id) continue
    const key = `${row.match_period_id}:${row.team_side}`
    const set = lineupPlayersByPeriodSide.get(key) ?? new Set<string>()
    set.add(row.player_id)
    lineupPlayersByPeriodSide.set(key, set)
  }

  const matchTeamNames = new Set<string>()
  for (const m of matches ?? []) {
    matchTeamNames.add(m.team_a_name)
    matchTeamNames.add(m.team_b_name)
  }
  const matchTeams = (teams ?? []).filter((t) => matchTeamNames.has(t.name))
  const managerTeamName = managerTeamId ? teamNameMap.get(managerTeamId) ?? null : null
  const managerParticipatesInGroup = managerTeamId
    ? (matches ?? []).some((m) => {
        const byId = m.team_a_id === managerTeamId || m.team_b_id === managerTeamId
        const byName = managerTeamName ? m.team_a_name === managerTeamName || m.team_b_name === managerTeamName : false
        return byId || byName
      })
    : false

  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-5xl mx-auto space-y-5">
        {toastMessage ? <TransientToast key={rawFeedback ?? toastMessage} message={toastMessage} tone="error" /> : null}
        <header className="space-y-1">
          <div className="text-xs text-gray-500 flex items-center gap-1">
            <Link className="underline" href={fromChannel ? `/c/${channel.slug}` : '/admin'}>
              {fromChannel ? '리그 경기목록' : '관리자 홈'}
            </Link>
            <span>›</span>
            <Link className="underline" href={`/admin/channel/${channel.id}?from=${fromChannel ? 'channel' : 'admin'}`}>
              경기그룹 관리
            </Link>
            <span>›</span>
            <span>경기 관리</span>
          </div>
          <h1 className="text-2xl font-semibold">경기 관리</h1>
          <p className="text-sm text-gray-600">
            {group.title
              ? `${group.title} · ${group.play_date}${group.venue ? ` · ${group.venue}` : ''}`
              : `${group.play_date}${group.venue ? ` · ${group.venue}` : ''}`}
          </p>
          {managerTeamId ? <p className="text-xs text-blue-700">팀장 모드: 자기 팀 엔트리만 관리할 수 있습니다.</p> : null}
          {err === 'forbidden' ? <p className="text-xs text-red-600">해당 작업 권한이 없습니다.</p> : null}
          {err === 'guest_source' ? <p className="text-xs text-red-600">용병 소속팀은 동일 팀으로 선택할 수 없습니다.</p> : null}
          {err === 'entry_affects_starters' ? <p className="text-xs text-amber-700">이 팀은 이미 경기별 선발 제출 이력이 있어요. 엔트리 변경 시 해당 선발명단에서 제외 선수가 정리됩니다. 같은 팀에서 다시 제출하면 진행됩니다.</p> : null}
          {err === 'starter_count' ? <p className="text-xs text-red-600">선발을 1명 이상 선택해 주세요.</p> : null}
          {err === 'starter_period' ? <p className="text-xs text-red-600">선발 period를 확인해 주세요.</p> : null}
          {err === 'starter_copy' ? <p className="text-xs text-red-600">이전 period 선발 복사에 실패했습니다.</p> : null}
          {err === 'team_not_in_group' ? <p className="text-xs text-red-600">이 경기그룹에 참여하는 팀만 엔트리를 제출할 수 있습니다.</p> : null}
        </header>

        {!managerTeamId && (
          <nav className="flex gap-4 border-b">
            <Link
              className={`pb-2 text-sm ${tab === 'matches' ? 'border-b-2 border-black font-semibold' : 'text-gray-500'}`}
              href={`/admin/channel/${channelId}/group/${groupId}?from=${from ?? ''}`}
            >
              경기
            </Link>
            <Link
              className={`pb-2 text-sm ${tab === 'entries' ? 'border-b-2 border-black font-semibold' : 'text-gray-500'}`}
              href={`/admin/channel/${channelId}/group/${groupId}?from=${from ?? ''}&tab=entries`}
            >
              엔트리
            </Link>
          </nav>
        )}

        {managerTeamId && !managerParticipatesInGroup ? (
          <section className="rounded border p-4">
            <p className="text-xs text-gray-600">이 경기그룹에 참여하지 않는 팀은 엔트리를 제출할 수 없습니다.</p>
          </section>
        ) : null}

        {((managerTeamId && managerParticipatesInGroup) || tab === 'entries') && (<section className="rounded border p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">출전 엔트리 선택</h2>
            {!managerTeamId && (
              <form action={toggleEntryConfirm}>
                <input type="hidden" name="channelId" value={channel.id} />
                <input type="hidden" name="groupId" value={group.id} />
                <input type="hidden" name="next" value={group.entry_confirmed_at ? '0' : '1'} />
                <PendingSubmitButton className="rounded border px-3 py-1.5 text-xs" pendingText="처리중...">
                  {group.entry_confirmed_at ? '엔트리 확정 해제' : '엔트리 확정'}
                </PendingSubmitButton>
              </form>
            )}
          </div>
          <p className="text-xs text-gray-500">
            상태: {group.entry_confirmed_at ? `확정됨 (${new Date(group.entry_confirmed_at).toLocaleString('ko-KR')})` : '미확정'}
          </p>

          {(() => {
            const entryTeams = managerTeamId ? (teams ?? []).filter((t) => t.id === managerTeamId) : matchTeams
            if ((matches ?? []).length === 0 && !managerTeamId) return <p className="text-xs text-gray-500">경기를 먼저 추가해 주세요.</p>
            if (entryTeams.length === 0) return <p className="text-xs text-gray-500">팀이 없습니다. 먼저 경기를 추가해 팀을 생성해 주세요.</p>
            return (
            <div className="space-y-3">
              {entryTeams.map((t) => {
                const teamPlayers = playersByTeam.get(t.id) ?? []
                const teamEntries = entriesByTeam.get(t.id) ?? []
                return (
                  <div key={t.id} className="rounded bg-white p-2 space-y-2 ring-1 ring-gray-200">
                    <div className="font-medium text-sm">{t.name}</div>
                    {(() => {
                      const guest = guestByTeam.get(t.id)
                      const totalCount = teamEntries.length + (guest ? 1 : 0)
                      if (totalCount === 0) return <div className="text-xs text-gray-400 bg-gray-50 rounded px-2 py-1.5">저장된 엔트리 없음</div>
                      const names = teamEntries.map((e) => {
                        const p = teamPlayers.find((pl) => pl.id === e.player_id)
                        return p ? `#${p.jersey_no} ${p.player_name}` : null
                      }).filter(Boolean)
                      if (guest) names.push(`${guest.guest_name}(용병)`)
                      return (
                        <div className="text-xs text-gray-600 bg-gray-50 rounded px-2 py-1.5">
                          <span className="font-semibold">저장된 엔트리({totalCount}명):</span>{' '}
                          {names.join(', ')}
                        </div>
                      )
                    })()}
                    <div className="space-y-2">
                      <div className="text-xs text-gray-500">엔트리 선택 (여러 명 선택 가능)</div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {teamPlayers.map((p) => {
                          const checked = teamEntries.some((e) => e.player_id === p.id)
                          return (
                            <label key={p.id} className="rounded px-2 py-1 text-xs flex items-center gap-1 ring-1 ring-gray-200 bg-white">
                              <input type="checkbox" name="playerIds" value={p.id} defaultChecked={checked} form={`entry-form-${t.id}`} />
                              <span>#{p.jersey_no} {p.player_name}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>

                    <section className="rounded bg-gray-50 p-2 space-y-2">
                      <div className="text-xs font-semibold text-gray-700">용병 (팀당 1명)</div>
                      <select className="rounded border px-2 py-1.5 text-xs w-full" name="sourcePlayer" form={`entry-form-${t.id}`} defaultValue="">
                        <option value="">변경 없음</option>
                        <option value="__NONE__">용병 없음(해제)</option>
                        {(teams ?? []).filter((x) => !matchTeamNames.has(x.name)).map((teamOption) => {
                          const sourcePlayers = playersByTeam.get(teamOption.id) ?? []
                          if (sourcePlayers.length === 0) return null
                          return (
                            <optgroup key={teamOption.id} label={teamOption.name}>
                              {sourcePlayers.map((p) => (
                                <option key={`${teamOption.id}-${p.id}`} value={`${teamOption.id}|${p.id}|${p.player_name}`}>
                                  #{p.jersey_no} {p.player_name}
                                </option>
                              ))}
                            </optgroup>
                          )
                        })}
                      </select>

                      {guestByTeam.get(t.id) ? (
                        <div className="text-xs text-gray-700">
                          현재 용병: {guestByTeam.get(t.id)?.guest_name} (소속: {teamNameMap.get(guestByTeam.get(t.id)!.source_team_id) ?? '알 수 없음'})
                        </div>
                      ) : (
                        <p className="text-xs text-gray-500">등록된 용병이 없습니다.</p>
                      )}
                    </section>

                    <form id={`entry-form-${t.id}`} action={saveGroupEntries}>
                      <input type="hidden" name="channelId" value={channel.id} />
                      <input type="hidden" name="groupId" value={group.id} />
                      <input type="hidden" name="teamId" value={t.id} />
                      <input type="hidden" name="confirm_cleanup" value={warnTeam === t.id ? '1' : '0'} />
                      <PendingSubmitButton
                        className="rounded border px-2 py-1.5 text-xs"
                        pendingText="제출중..."
                        confirmMessage={warnTeam === t.id ? '이미 선발로 제출된 선수 중 엔트리에서 제외되는 선수가 있습니다. 해당 선수는 경기별 선발명단에서도 제거됩니다. 계속할까요?' : undefined}
                      >
                        제출
                      </PendingSubmitButton>
                    </form>
                  </div>
                )
              })}
            </div>
            )
          })()}
        </section>)}

        {((managerTeamId && managerParticipatesInGroup) || tab === 'entries') && (matches ?? []).length > 0 ? (
          <section className="rounded border p-4 space-y-3">
            <h2 className="text-sm font-semibold">경기별 선발 제출</h2>
            <p className="text-xs text-gray-500">선발은 경기 시작 전 미리 제출하고, 필요 시 다시 저장해 수정할 수 있습니다.</p>
            {(matches ?? []).map((m) => {
              const teamAId = m.team_a_id ?? teamIdByName.get(m.team_a_name) ?? null
              const teamBId = m.team_b_id ?? teamIdByName.get(m.team_b_name) ?? null
              const periods = periodsByMatch.get(m.id) ?? []
              const periodCount = Math.max(1, m.period_count || periods.length || 1)
              const periodSequences = Array.from({ length: periodCount }, (_, i) => i + 1)

              const sides: Array<{ teamSide: 'A' | 'B'; teamId: string | null; teamName: string }> = [
                { teamSide: 'A', teamId: teamAId, teamName: m.team_a_name },
                { teamSide: 'B', teamId: teamBId, teamName: m.team_b_name },
              ]

              return (
                <div key={`starter-${m.id}`} className="rounded border p-3 space-y-3 bg-white">
                  <div className="text-sm font-medium">{m.seq}경기 · {m.team_a_name} vs {m.team_b_name}</div>
                  <div className="space-y-3">
                    {periodSequences.map((seq) => {
                      const period = periods.find((p) => p.sequence === seq) ?? null
                      const periodLabel = period?.label || period?.period_code || `${seq}P`
                      return (
                        <div key={`${m.id}-period-panel-${seq}`} className="rounded bg-gray-50/70 p-2 space-y-2">
                          <div className="text-xs font-medium text-gray-700">{periodLabel} 선발</div>
                          <div className="grid md:grid-cols-2 gap-3">
                            {sides.map((side) => {
                              if (!side.teamId) return null
                              if (managerTeamId && managerTeamId !== side.teamId) return null

                              const teamPlayers = playersByTeam.get(side.teamId) ?? []
                              const teamEntries = entriesByTeam.get(side.teamId) ?? []
                              const entryPlayerIds = new Set(teamEntries.map((e) => e.player_id))
                              const candidates = teamPlayers.filter((p) => entryPlayerIds.has(p.id))
                              const guest = guestByTeam.get(side.teamId)
                              if (guest?.source_player_id) {
                                const guestSource = playersById.get(guest.source_player_id)
                                const alreadyIncluded = candidates.some((p) => p.id === guest.source_player_id)
                                if (!alreadyIncluded) {
                                  candidates.push({
                                    id: guest.source_player_id,
                                    team_id: side.teamId,
                                    jersey_no: guestSource?.jersey_no ?? '',
                                    player_name: `${guest.guest_name} (용병)`,
                                    is_active: true,
                                  })
                                }
                              }
                              const lineupSelected = period
                                ? lineupPlayersByPeriodSide.get(`${period.id}:${side.teamSide}`) ?? new Set<string>()
                                : new Set<string>()
                              const selected = lineupSelected

                              return (
                                <form key={`${m.id}-${seq}-${side.teamSide}`} action={saveMatchStarters} className="rounded bg-white p-2 space-y-2 ring-1 ring-gray-200">
                                  <input type="hidden" name="channelId" value={channel.id} />
                                  <input type="hidden" name="groupId" value={group.id} />
                                  <input type="hidden" name="matchId" value={m.id} />
                                  <input type="hidden" name="teamId" value={side.teamId} />
                                  <input type="hidden" name="teamSide" value={side.teamSide} />
                                  <input type="hidden" name="periodSequence" value={seq} />
                                  <div className="text-xs font-medium text-gray-700">{side.teamName} ({side.teamSide}) · 현재 {selected.size}명</div>
                                  <div className="max-h-40 overflow-auto rounded bg-gray-50 p-2 grid grid-cols-1 gap-1 text-xs">
                                    {candidates.map((p) => (
                                      <label key={`${m.id}-${seq}-${side.teamSide}-${p.id}`} className="flex items-center gap-2">
                                        <input type="checkbox" name="playerIds" value={p.id} defaultChecked={selected.has(p.id)} />
                                        <span>{p.jersey_no ? `#${p.jersey_no} ` : ''}{p.player_name}</span>
                                      </label>
                                    ))}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <PendingSubmitButton className="rounded border px-2 py-1 text-xs" pendingText="저장중...">선발 제출</PendingSubmitButton>
                                  </div>
                                </form>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </section>
        ) : null}

        <datalist id="team-suggestions">
          {(teams ?? []).map((t) => (
            <option key={t.id} value={t.name} />
          ))}
        </datalist>

        {!managerTeamId && tab === 'matches' && (
          <>
            <section className="rounded border p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">경기 추가</h2>
                <Link className="text-xs underline" href={`/admin/channel/${channel.id}/teams`}>팀 관리는 별도 화면에서</Link>
              </div>
              <form action={createMatch} className="grid md:grid-cols-12 gap-2 items-end">
                <input type="hidden" name="channelId" value={channel.id} />
                <input type="hidden" name="groupId" value={group.id} />
                <div className="md:col-span-3 space-y-1">
                  <label className="block text-xs text-gray-600">A팀명</label>
                  <input className="rounded border px-2 py-1.5 text-sm w-full" list="team-suggestions" name="team_a_name" placeholder="A팀명" required />
                </div>
                <div className="md:col-span-3 space-y-1">
                  <label className="block text-xs text-gray-600">B팀명</label>
                  <input className="rounded border px-2 py-1.5 text-sm w-full" list="team-suggestions" name="team_b_name" placeholder="B팀명" required />
                </div>
                <div className="md:col-span-3 space-y-1">
                  <label className="block text-xs text-gray-600">경기구간수</label>
                  <input className="rounded border px-2 py-1.5 text-sm w-full" type="number" name="period_count" min={1} max={12} defaultValue={2} />
                  <div className="text-[11px] text-gray-500">예: 2=전/후반, 4=1~4쿼터</div>
                </div>
                <PendingSubmitButton className="md:col-span-3 rounded border px-3 py-2 text-sm h-10" pendingText="추가중...">경기 추가</PendingSubmitButton>
              </form>
            </section>

            <section className="space-y-2">
              {(matches ?? []).length === 0 ? (
                <p className="text-sm text-gray-500">등록된 경기가 없습니다.</p>
              ) : (
                (matches ?? []).map((m) => (
              <div key={m.id} className="rounded border p-3 space-y-2">
                <div className="text-sm font-medium">{m.seq}경기 · {m.score_a}:{m.score_b}</div>
                <form action={updateMatch} className="grid md:grid-cols-12 gap-2 items-end">
                  <input type="hidden" name="channelId" value={channel.id} />
                  <input type="hidden" name="groupId" value={group.id} />
                  <input type="hidden" name="matchId" value={m.id} />
                  <div className="md:col-span-2 space-y-1">
                    <label className="block text-[11px] text-gray-600">A팀명</label>
                    <input className="rounded border px-2 py-1.5 text-sm w-full" list="team-suggestions" name="team_a_name" defaultValue={m.team_a_name} required />
                  </div>
                  <div className="md:col-span-2 space-y-1">
                    <label className="block text-[11px] text-gray-600">B팀명</label>
                    <input className="rounded border px-2 py-1.5 text-sm w-full" list="team-suggestions" name="team_b_name" defaultValue={m.team_b_name} required />
                  </div>
                  <div className="md:col-span-2 space-y-1">
                    <label className="block text-[11px] text-gray-600">상태</label>
                    <select className="rounded border px-2 py-1.5 text-sm w-full" name="status" defaultValue={m.status}>
                      <option value="scheduled">scheduled</option>
                      <option value="live">live</option>
                      <option value="ended">ended</option>
                    </select>
                  </div>
                  <div className="md:col-span-2 space-y-1">
                    <label className="block text-[11px] text-gray-600">경기구간수</label>
                    <input className="rounded border px-2 py-1.5 text-sm w-full" type="number" name="period_count" min={1} max={12} defaultValue={m.period_count ?? 2} />
                  </div>
                  <input type="hidden" name="group_play_date" value={group.play_date} />
                  <div className="md:col-span-2 space-y-1">
                    <label className="block text-[11px] text-gray-600">시작시간</label>
                    <input className="rounded border px-2 py-1.5 text-sm w-full" type="time" name="scheduled_start_time" defaultValue={toTimeLocalValue(m.scheduled_start_at)} />
                  </div>
                  <PendingSubmitButton className="md:col-span-2 rounded border px-2 py-1.5 text-xs h-9" pendingText="저장중...">수정 저장</PendingSubmitButton>
                </form>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link className="underline text-xs" href={`/m/${m.id}`}>경기 화면</Link>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <form action={applyForfeitResult}>
                      <input type="hidden" name="channelId" value={channel.id} />
                      <input type="hidden" name="groupId" value={group.id} />
                      <input type="hidden" name="matchId" value={m.id} />
                      <input type="hidden" name="winnerSide" value="A" />
                      <PendingSubmitButton className="rounded border border-amber-300 text-amber-800 px-2 py-1 text-xs" pendingText="처리중..." confirmMessage="A팀 몰수승(3:0)으로 처리하시겠습니까?">A팀 몰수승(3:0)</PendingSubmitButton>
                    </form>
                    <form action={applyForfeitResult}>
                      <input type="hidden" name="channelId" value={channel.id} />
                      <input type="hidden" name="groupId" value={group.id} />
                      <input type="hidden" name="matchId" value={m.id} />
                      <input type="hidden" name="winnerSide" value="B" />
                      <PendingSubmitButton className="rounded border border-amber-300 text-amber-800 px-2 py-1 text-xs" pendingText="처리중..." confirmMessage="B팀 몰수승(3:0)으로 처리하시겠습니까?">B팀 몰수승(3:0)</PendingSubmitButton>
                    </form>
                    <form action={deleteMatch}>
                      <input type="hidden" name="channelId" value={channel.id} />
                      <input type="hidden" name="groupId" value={group.id} />
                      <input type="hidden" name="matchId" value={m.id} />
                      <PendingSubmitButton className="rounded border border-red-300 text-red-700 px-2 py-1 text-xs" pendingText="삭제중..." confirmMessage="정말 경기 삭제하시겠습니까?">경기 삭제</PendingSubmitButton>
                    </form>
                  </div>
                </div>
              </div>
                ))
              )}
            </section>
          </>
        )}
      </section>
    </main>
  )
}
