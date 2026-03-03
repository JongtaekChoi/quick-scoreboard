import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseServerClient } from '@/lib/supabase'
import { isAdminAuthorized } from '@/lib/adminAuth'
import { isEditAuthorized } from '@/lib/editAuth'

type Channel = { id: string; name: string; slug: string; edit_session_version: number }
type MatchGroup = { id: string; play_date: string; venue: string | null; title: string | null; seq: number }

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

async function createGroup(formData: FormData) {
  'use server'
  const channelId = String(formData.get('channelId') || '')
  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }
  const playDate = String(formData.get('play_date') || '')
  const venue = String(formData.get('venue') || '').trim()
  const title = String(formData.get('title') || '').trim()
  if (!channelId || !playDate) return

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  const { data: lastGroup } = await supabase
    .from('match_groups')
    .select('seq')
    .eq('channel_id', channelId)
    .eq('play_date', playDate)
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle<{ seq: number }>()

  const nextSeq = (lastGroup?.seq ?? 0) + 1

  await supabase.from('match_groups').insert({
    channel_id: channelId,
    play_date: playDate,
    venue: venue || null,
    title: title || null,
    seq: nextSeq,
  })

  redirect(`/admin/channel/${channelId}`)
}

export default async function AdminChannelPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params
  const supabase = getSupabaseServerClient()
  if (!supabase) return <main className="p-6">Supabase env가 필요합니다.</main>

  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }

  const channel = manage.channel
  if (!channel) return <main className="p-6">채널을 찾을 수 없습니다.</main>

  const { data: groups } = await supabase
    .from('match_groups')
    .select('id,play_date,venue,title,seq')
    .eq('channel_id', channelId)
    .order('play_date', { ascending: false })
    .order('seq', { ascending: true })
    .returns<MatchGroup[]>()

  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-5xl mx-auto space-y-5">
        <header className="space-y-1">
          <Link className="underline text-sm" href={`/c/${channel.slug}`}>← 채널 경기목록</Link>
          <h1 className="text-2xl font-semibold">{channel.name} · 경기그룹 관리</h1>
          <p className="text-sm text-gray-600">/{channel.slug}</p>
        </header>

        <section className="rounded border p-4 space-y-2">
          <h2 className="text-sm font-semibold">경기그룹 생성</h2>
          <p className="text-xs text-gray-500">순번(seq)은 같은 날짜 기준으로 자동 부여됩니다.</p>
          <form action={createGroup} className="grid md:grid-cols-4 gap-2">
            <input type="hidden" name="channelId" value={channel.id} />
            <input className="rounded border px-2 py-1.5 text-sm" name="play_date" type="date" required />
            <input className="rounded border px-2 py-1.5 text-sm" name="venue" placeholder="구장(선택)" />
            <input className="rounded border px-2 py-1.5 text-sm" name="title" placeholder="그룹 제목(선택)" />
            <button className="rounded border px-3 py-2 text-sm" type="submit">생성</button>
          </form>
        </section>

        <section className="space-y-3">
          {(groups ?? []).length === 0 ? (
            <p className="text-sm text-gray-500">경기그룹이 없습니다.</p>
          ) : (
            (groups ?? []).map((g) => (
              <div key={g.id} className="rounded border p-3 flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-sm">{g.title ?? `${g.play_date} 그룹 ${g.seq}`}</div>
                  <div className="text-xs text-gray-500">{g.play_date} {g.venue ? `· ${g.venue}` : ''}</div>
                </div>
                <Link className="underline text-sm" href={`/admin/channel/${channel.id}/group/${g.id}`}>
                  경기 관리
                </Link>
              </div>
            ))
          )}
        </section>
      </section>
    </main>
  )
}
