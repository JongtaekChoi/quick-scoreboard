import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import UserGNB from '@/components/UserGNB'
import { getSupabaseServerClient } from '@/lib/supabase'
import { getAccountInfo, createAccountSession } from '@/lib/channelSession'
import { hashAccountPassword } from '@/lib/passwordHash'
import PendingSubmitButton from '@/components/PendingSubmitButton'

type Channel = { id: string; slug: string; name: string; edit_session_version: number }
type AccountRow = { id: string; role: 'admin' | 'manager' | 'player'; login_id: string; team_id: string | null; session_version: number; must_change_password: boolean }

const ACCOUNT_FEEDBACK_COOKIE = 'qsb_account_feedback'

async function setAccountFeedback(code: string) {
  const store = await cookies()
  store.set(ACCOUNT_FEEDBACK_COOKIE, code, { path: '/', maxAge: 10, sameSite: 'lax' })
}

async function changePassword(formData: FormData) {
  'use server'
  const slug = String(formData.get('slug') || '')
  const next = String(formData.get('next') || '').trim()
  const newPassword = String(formData.get('newPassword') || '').trim()
  const confirmPassword = String(formData.get('confirmPassword') || '').trim()

  if (!slug || !newPassword || newPassword.length < 4 || newPassword !== confirmPassword) {
    await setAccountFeedback('password')
    redirect(`/c/${slug}/account`)
  }

  const supabase = getSupabaseServerClient()
  if (!supabase) {
    await setAccountFeedback('env')
    redirect(`/c/${slug}/account`)
  }

  const account = await getAccountInfo(slug)
  if (!account) redirect(`/c/${slug}`)

  const { data: channel } = await supabase
    .from('channels')
    .select('id,slug,edit_session_version')
    .eq('slug', slug)
    .maybeSingle<{ id: string; slug: string; edit_session_version: number }>()

  if (!channel) redirect(`/c/${slug}`)

  const { data: updated } = await supabase
    .from('channel_accounts')
    .update({
      password_hash: hashAccountPassword(newPassword),
      must_change_password: false,
      session_version: account.version + 1,
    })
    .eq('channel_id', channel.id)
    .eq('login_id', account.loginId)
    .select('role,team_id,session_version')
    .maybeSingle<{ role: 'admin' | 'manager' | 'player'; team_id: string | null; session_version: number }>()

  if (!updated) {
    await setAccountFeedback('update')
    redirect(`/c/${slug}/account`)
  }

  await createAccountSession(slug, {
    loginId: account.loginId,
    role: updated.role,
    teamId: updated.team_id,
    version: updated.session_version,
    editVersion: channel.edit_session_version,
    mustChangePassword: false,
  })

  if (next && next.startsWith('/')) redirect(next)
  redirect(`/c/${slug}?pw=1`)
}

export default async function ChannelAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ force?: string; err?: string; next?: string }>
}) {
  const { slug } = await params
  const { force, err, next } = await searchParams
  const store = await cookies()
  const feedback = err ?? store.get(ACCOUNT_FEEDBACK_COOKIE)?.value ?? null

  const supabase = getSupabaseServerClient()
  if (!supabase) return <main className="p-6">Supabase env가 필요합니다.</main>

  const { data: channel } = await supabase
    .from('channels')
    .select('id,slug,name,edit_session_version')
    .eq('slug', slug)
    .maybeSingle<Channel>()

  if (!channel) return <main className="p-6">리그를 찾을 수 없습니다.</main>

  const account = await getAccountInfo(slug)
  if (!account) redirect(`/c/${slug}`)

  const { data: row } = await supabase
    .from('channel_accounts')
    .select('id,role,login_id,team_id,session_version,must_change_password')
    .eq('channel_id', channel.id)
    .eq('login_id', account.loginId)
    .maybeSingle<AccountRow>()

  if (!row) redirect(`/c/${slug}`)

  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-xl mx-auto space-y-4">
        <UserGNB
          slug={channel.slug}
          channelName={channel.name}
          current="account"
          subtitle={`${row.login_id} (${row.role})`}
          isLoggedIn
          currentPath={`/c/${encodeURIComponent(channel.slug)}/account${next ? `?next=${encodeURIComponent(next)}` : ""}`}
        />
        <header className="space-y-1">
          <h1 className="text-xl font-semibold">비밀번호 변경</h1>
          {force === '1' || row.must_change_password ? (
            <p className="text-xs text-amber-700">초기 비밀번호를 변경해 주세요.</p>
          ) : null}
          {feedback === 'password' ? <p className="text-xs text-red-600">비밀번호 확인이 일치하지 않거나 너무 짧습니다.</p> : null}
          {feedback === 'update' ? <p className="text-xs text-red-600">비밀번호 변경에 실패했습니다.</p> : null}
          {feedback === 'env' ? <p className="text-xs text-red-600">서버 환경 설정 문제로 처리에 실패했습니다.</p> : null}
        </header>

        <form action={changePassword} className="rounded border p-4 space-y-2">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="next" value={next ?? ''} />
          <input className="w-full rounded border px-3 py-2 text-sm" name="newPassword" type="password" placeholder="새 비밀번호 (최소 4자)" required minLength={4} />
          <input className="w-full rounded border px-3 py-2 text-sm" name="confirmPassword" type="password" placeholder="새 비밀번호 확인" required minLength={4} />
          <PendingSubmitButton className="rounded border px-3 py-2 text-sm" pendingText="변경중...">비밀번호 변경</PendingSubmitButton>
        </form>
      </section>
    </main>
  )
}
