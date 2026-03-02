import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseServerClient } from '@/lib/supabase'
import { isAdminAuthorized } from '@/lib/adminAuth'

type Channel = { id: string; name: string; slug: string }
type MatchGroup = { id: string; play_date: string; venue: string | null; title: string | null; seq: number }
type Match = { id: string; match_group_id: string | null; seq: number; team_a_name: string; team_b_name: string; score_a: number; score_b: number; status: string }

async function createGroup(formData: FormData) {
  'use server'
  const authorized = await isAdminAuthorized()
  if (!authorized) redirect('/admin/login')

  const channelId = String(formData.get('channelId') || '')
  const playDate = String(formData.get('play_date') || '')
  const venue = String(formData.get('venue') || '').trim()
  const title = String(formData.get('title') || '').trim()
  const seq = Number(formData.get('seq') || 1)
  if (!channelId || !playDate) return

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  await supabase.from('match_groups').insert({
    channel_id: channelId,
    play_date: playDate,
    venue: venue || null,
    title: title || null,
    seq: Number.isFinite(seq) ? seq : 1,
  })

  redirect(`/admin/channel/${channelId}`)
}

async function createMatch(formData: FormData) {
  'use server'
  const authorized = await isAdminAuthorized()
  if (!authorized) redirect('/admin/login')

  const channelId = String(formData.get('channelId') || '')
  const groupId = String(formData.get('groupId') || '')
  const seq = Number(formData.get('seq') || 1)
  const teamA = String(formData.get('team_a_name') || '').trim()
  const teamB = String(formData.get('team_b_name') || '').trim()
  if (!channelId || !groupId || !teamA || !teamB) return

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  await supabase.from('matches').insert({
    channel_id: channelId,
    match_group_id: groupId,
    seq: Number.isFinite(seq) ? seq : 1,
    team_a_name: teamA,
    team_b_name: teamB,
    score_a: 0,
    score_b: 0,
    status: 'scheduled',
  })

  redirect(`/admin/channel/${channelId}`)
}

export default async function AdminChannelPage({ params }: { params: Promise<{ channelId: string }> }) {
  const authorized = await isAdminAuthorized()
  if (!authorized) redirect('/admin/login')

  const { channelId } = await params
  const supabase = getSupabaseServerClient()
  if (!supabase) return <main className="p-6">Supabase env가 필요합니다.</main>

  const { data: channel } = await supabase
    .from('channels')
    .select('id,name,slug')
    .eq('id', channelId)
    .maybeSingle<Channel>()

  if (!channel) return <main className="p-6">채널을 찾을 수 없습니다.</main>

  const { data: groups } = await supabase
    .from('match_groups')
    .select('id,play_date,venue,title,seq')
    .eq('channel_id', channelId)
    .order('play_date', { ascending: false })
    .order('seq', { ascending: true })
    .returns<MatchGroup[]>()

  const groupIds = (groups ?? []).map((g) => g.id)
  const { data: matches } = groupIds.length
    ? await supabase
        .from('matches')
        .select('id,match_group_id,seq,team_a_name,team_b_name,score_a,score_b,status')
        .in('match_group_id', groupIds)
        .order('seq', { ascending: true })
        .returns<Match[]>()
    : { data: [] as Match[] }

  const matchesByGroup = new Map<string, Match[]>()
  for (const m of matches ?? []) {
    if (!m.match_group_id) continue
    const arr = matchesByGroup.get(m.match_group_id) ?? []
    arr.push(m)
    matchesByGroup.set(m.match_group_id, arr)
  }

  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-5xl mx-auto space-y-5">
        <header className="space-y-1">
          <Link className="underline text-sm" href="/admin">← Admin</Link>
          <h1 className="text-2xl font-semibold">{channel.name} 운영</h1>
          <p className="text-sm text-gray-600">/{channel.slug}</p>
        </header>

        <section className="rounded border p-4 space-y-2">
          <h2 className="text-sm font-semibold">경기그룹 생성</h2>
          <form action={createGroup} className="grid md:grid-cols-5 gap-2">
            <input type="hidden" name="channelId" value={channel.id} />
            <input className="rounded border px-2 py-1.5 text-sm" name="play_date" type="date" required />
            <input className="rounded border px-2 py-1.5 text-sm" name="venue" placeholder="구장(선택)" />
            <input className="rounded border px-2 py-1.5 text-sm" name="title" placeholder="그룹 제목(선택)" />
            <input className="rounded border px-2 py-1.5 text-sm" name="seq" type="number" min={1} defaultValue={1} />
            <button className="rounded border px-3 py-2 text-sm" type="submit">생성</button>
          </form>
        </section>

        <section className="space-y-3">
          {(groups ?? []).map((g) => {
            const list = matchesByGroup.get(g.id) ?? []
            return (
              <div key={g.id} className="rounded border p-3 space-y-2">
                <div>
                  <div className="font-medium text-sm">{g.title ?? `${g.play_date} 그룹 ${g.seq}`}</div>
                  <div className="text-xs text-gray-500">{g.play_date} {g.venue ? `· ${g.venue}` : ''}</div>
                </div>

                <form action={createMatch} className="grid md:grid-cols-5 gap-2">
                  <input type="hidden" name="channelId" value={channel.id} />
                  <input type="hidden" name="groupId" value={g.id} />
                  <input className="rounded border px-2 py-1.5 text-sm" name="team_a_name" placeholder="A팀명" required />
                  <input className="rounded border px-2 py-1.5 text-sm" name="team_b_name" placeholder="B팀명" required />
                  <input className="rounded border px-2 py-1.5 text-sm" name="seq" type="number" min={1} defaultValue={(list.length || 0) + 1} />
                  <button className="rounded border px-3 py-2 text-sm" type="submit">경기 추가</button>
                </form>

                {list.length === 0 ? (
                  <p className="text-xs text-gray-500">등록된 경기가 없습니다.</p>
                ) : (
                  <ul className="space-y-1">
                    {list.map((m) => (
                      <li key={m.id} className="text-sm flex items-center justify-between border rounded px-2 py-1.5">
                        <span>{m.seq}경기 · {m.team_a_name} vs {m.team_b_name}</span>
                        <span className="tabular-nums">{m.score_a}:{m.score_b}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </section>
      </section>
    </main>
  )
}
