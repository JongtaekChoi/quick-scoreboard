import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseServerClient } from '@/lib/supabase'
import { isAdminAuthorized } from '@/lib/adminAuth'
import { isEditAuthorized } from '@/lib/editAuth'

type Channel = { id: string; name: string; slug: string; edit_session_version: number }
type MatchGroup = { id: string; play_date: string; venue: string | null; title: string | null; seq: number }
type Match = { id: string; seq: number; team_a_name: string; team_b_name: string; score_a: number; score_b: number; status: 'scheduled' | 'live' | 'ended'; scheduled_start_at: string | null }
type Team = { id: string; name: string }

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

  const isEditor = await isEditAuthorized(channel.slug, channel.edit_session_version)
  return { allowed: isEditor, channel }
}

function toDateTimeLocalValue(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 16)
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
  const teamA = String(formData.get('team_a_name') || '').trim()
  const teamB = String(formData.get('team_b_name') || '').trim()
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

  await supabase.from('matches').insert({
    channel_id: channelId,
    match_group_id: groupId,
    seq: nextSeq,
    team_a_name: teamA,
    team_b_name: teamB,
    score_a: 0,
    score_b: 0,
    status: 'scheduled',
  })

  await supabase.from('teams').upsert(
    [
      { channel_id: channelId, name: teamA, last_used_at: new Date().toISOString() },
      { channel_id: channelId, name: teamB, last_used_at: new Date().toISOString() },
    ],
    { onConflict: 'channel_id,name' },
  )

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
  const matchId = String(formData.get('matchId') || '')
  const teamA = String(formData.get('team_a_name') || '').trim()
  const teamB = String(formData.get('team_b_name') || '').trim()
  const status = String(formData.get('status') || 'scheduled') as 'scheduled' | 'live' | 'ended'
  const scheduledStartRaw = String(formData.get('scheduled_start_at') || '').trim()
  const scheduledStartAt = scheduledStartRaw ? new Date(`${scheduledStartRaw}:00+09:00`).toISOString() : null
  if (!channelId || !groupId || !matchId || !teamA || !teamB) return

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  await supabase
    .from('matches')
    .update({
      team_a_name: teamA,
      team_b_name: teamB,
      status,
      scheduled_start_at: status === 'ended' ? null : scheduledStartAt,
    })
    .eq('id', matchId)

  await supabase.from('teams').upsert(
    [
      { channel_id: channelId, name: teamA, last_used_at: new Date().toISOString() },
      { channel_id: channelId, name: teamB, last_used_at: new Date().toISOString() },
    ],
    { onConflict: 'channel_id,name' },
  )

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
  const matchId = String(formData.get('matchId') || '')
  if (!channelId || !groupId || !matchId) return

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  await supabase.from('goal_events').update({ deleted_at: new Date().toISOString() }).eq('match_id', matchId)
  await supabase.from('matches').delete().eq('id', matchId)

  redirect(`/admin/channel/${channelId}/group/${groupId}`)
}

export default async function AdminGroupPage({ params }: { params: Promise<{ channelId: string; groupId: string }> }) {
  const { channelId, groupId } = await params
  const supabase = getSupabaseServerClient()
  if (!supabase) return <main className="p-6">Supabase env가 필요합니다.</main>

  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }

  const channel = manage.channel
  const [{ data: group }, { data: matches }, { data: teams }] = await Promise.all([
    supabase.from('match_groups').select('id,play_date,venue,title,seq').eq('id', groupId).maybeSingle<MatchGroup>(),
    supabase.from('matches').select('id,seq,team_a_name,team_b_name,score_a,score_b,status,scheduled_start_at').eq('match_group_id', groupId).order('seq', { ascending: true }).returns<Match[]>(),
    supabase.from('teams').select('id,name').eq('channel_id', channelId).order('last_used_at', { ascending: false }).limit(30).returns<Team[]>(),
  ])

  if (!channel || !group) return <main className="p-6">채널/그룹을 찾을 수 없습니다.</main>

  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-5xl mx-auto space-y-5">
        <header className="space-y-1">
          <Link className="underline text-sm" href={`/admin/channel/${channel.id}`}>← 경기그룹 목록</Link>
          <h1 className="text-2xl font-semibold">경기 관리</h1>
          <p className="text-sm text-gray-600">{group.title ?? `${group.play_date} 그룹 ${group.seq}`} · {group.play_date} {group.venue ? `· ${group.venue}` : ''}</p>
        </header>

        <datalist id="team-suggestions">
          {(teams ?? []).map((t) => (
            <option key={t.id} value={t.name} />
          ))}
        </datalist>

        <section className="rounded border p-4 space-y-2">
          <h2 className="text-sm font-semibold">경기 추가</h2>
          <form action={createMatch} className="grid md:grid-cols-4 gap-2">
            <input type="hidden" name="channelId" value={channel.id} />
            <input type="hidden" name="groupId" value={group.id} />
            <input className="rounded border px-2 py-1.5 text-sm" list="team-suggestions" name="team_a_name" placeholder="A팀명" required />
            <input className="rounded border px-2 py-1.5 text-sm" list="team-suggestions" name="team_b_name" placeholder="B팀명" required />
            <button className="rounded border px-3 py-2 text-sm" type="submit">경기 추가</button>
          </form>
        </section>

        <section className="space-y-2">
          {(matches ?? []).length === 0 ? (
            <p className="text-sm text-gray-500">등록된 경기가 없습니다.</p>
          ) : (
            (matches ?? []).map((m) => (
              <div key={m.id} className="rounded border p-3 space-y-2">
                <div className="text-sm font-medium">{m.seq}경기 · {m.score_a}:{m.score_b}</div>
                <form action={updateMatch} className="grid md:grid-cols-6 gap-2 items-center">
                  <input type="hidden" name="channelId" value={channel.id} />
                  <input type="hidden" name="groupId" value={group.id} />
                  <input type="hidden" name="matchId" value={m.id} />
                  <input className="rounded border px-2 py-1.5 text-sm" list="team-suggestions" name="team_a_name" defaultValue={m.team_a_name} required />
                  <input className="rounded border px-2 py-1.5 text-sm" list="team-suggestions" name="team_b_name" defaultValue={m.team_b_name} required />
                  <select className="rounded border px-2 py-1.5 text-sm" name="status" defaultValue={m.status}>
                    <option value="scheduled">scheduled</option>
                    <option value="live">live</option>
                    <option value="ended">ended</option>
                  </select>
                  <input className="rounded border px-2 py-1.5 text-sm" type="datetime-local" name="scheduled_start_at" defaultValue={toDateTimeLocalValue(m.scheduled_start_at)} />
                  <button className="rounded border px-2 py-1.5 text-xs" type="submit">수정 저장</button>
                </form>

                <div className="flex items-center justify-between">
                  <Link className="underline text-xs" href={`/m/${m.id}`}>경기 화면</Link>
                  <form action={deleteMatch}>
                    <input type="hidden" name="channelId" value={channel.id} />
                    <input type="hidden" name="groupId" value={group.id} />
                    <input type="hidden" name="matchId" value={m.id} />
                    <button className="rounded border border-red-300 text-red-700 px-2 py-1 text-xs" type="submit">경기 삭제</button>
                  </form>
                </div>
              </div>
            ))
          )}
        </section>
      </section>
    </main>
  )
}
