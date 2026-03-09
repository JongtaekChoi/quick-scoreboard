import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase'
import { isAdminAuthorized } from '@/lib/adminAuth'
import { getAccountInfo, validateManagerAgainstDb } from '@/lib/channelSession'

type Channel = { id: string; name: string; slug: string }
type MatchChangeLog = {
  id: string
  match_id: string
  action_type: string
  actor_login_id: string | null
  actor_role: string | null
  payload: Record<string, unknown> | null
  created_at: string
  matches: { seq: number; team_a_name: string; team_b_name: string } | null
}

async function canManageChannel(channelId: string) {
  const supabase = getSupabaseServerClient()
  if (!supabase) return { allowed: false, channel: null as Channel | null }

  const { data: channel } = await supabase
    .from('channels')
    .select('id,name,slug')
    .eq('id', channelId)
    .maybeSingle<Channel>()

  if (!channel) return { allowed: false, channel: null as Channel | null }

  const isAdmin = await isAdminAuthorized()
  if (isAdmin) return { allowed: true, channel }

  const account = await getAccountInfo(channel.slug)
  if (account?.role === 'admin') return { allowed: true, channel }

  const { ok } = await validateManagerAgainstDb(channel.slug, channel.id)
  return { allowed: ok, channel }
}

export default async function MatchLogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ channelId: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const { channelId } = await params
  const { page } = await searchParams

  const supabase = getSupabaseServerClient()
  if (!supabase) return <main className="p-6">Supabase env가 필요합니다.</main>

  const manage = await canManageChannel(channelId)
  if (!manage.allowed) {
    if (manage.channel) redirect(`/c/${manage.channel.slug}`)
    redirect('/admin/login')
  }

  const channel = manage.channel
  if (!channel) return <main className="p-6">리그를 찾을 수 없습니다.</main>

  const pageSize = 30
  const currentPage = Math.max(1, Number(page) || 1)
  const from = (currentPage - 1) * pageSize

  const { data: logs, count } = await supabase
    .from('match_change_logs')
    .select('id,match_id,action_type,actor_login_id,actor_role,payload,created_at,matches(seq,team_a_name,team_b_name)', { count: 'exact' })
    .eq('channel_id', channel.id)
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1)
    .returns<MatchChangeLog[]>()

  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-5xl mx-auto space-y-4">
        <header className="space-y-1">
          <div className="text-xs text-gray-500 flex items-center gap-1">
            <Link className="underline" href={`/admin/channel/${channel.id}`}>경기그룹 관리</Link>
            <span>›</span>
            <span>변경 이력</span>
          </div>
          <h1 className="text-2xl font-semibold">변경 이력</h1>
          <p className="text-sm text-gray-600">{channel.name} · 총 {count ?? 0}건</p>
        </header>

        {(logs ?? []).length === 0 ? (
          <p className="text-sm text-gray-500">기록된 이력이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {(logs ?? []).map((l) => (
              <li key={l.id} className="rounded border p-3 text-sm space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">{l.action_type}</div>
                  <div className="text-xs text-gray-500">{new Date(l.created_at).toLocaleString('ko-KR')}</div>
                </div>
                <div className="text-xs text-gray-600">
                  경기: {l.matches ? `${l.matches.seq}경기 ${l.matches.team_a_name} vs ${l.matches.team_b_name}` : l.match_id}
                </div>
                <div className="text-xs text-gray-600">변경자: {l.actor_login_id ?? 'unknown'} ({l.actor_role ?? '-'})</div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500">페이지 {currentPage}</span>
          <div className="flex gap-3">
            {currentPage > 1 ? (
              <Link className="underline" href={`/admin/channel/${channel.id}/logs?page=${currentPage - 1}`}>이전</Link>
            ) : (
              <span className="text-gray-300">이전</span>
            )}
            {(count ?? 0) > currentPage * pageSize ? (
              <Link className="underline" href={`/admin/channel/${channel.id}/logs?page=${currentPage + 1}`}>다음</Link>
            ) : (
              <span className="text-gray-300">다음</span>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}
