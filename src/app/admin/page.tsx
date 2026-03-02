import Link from 'next/link'
import { redirect } from 'next/navigation'
import { hashEditPassword } from '@/lib/editAuth'
import { getSupabaseServerClient } from '@/lib/supabase'
import { isAdminAuthorized } from '@/lib/adminAuth'

type Channel = { id: string; name: string; slug: string; created_at: string }

async function createChannel(formData: FormData) {
  'use server'

  const authorized = await isAdminAuthorized()
  if (!authorized) redirect('/admin/login')

  const name = String(formData.get('name') || '').trim()
  const slug = String(formData.get('slug') || '').trim().toLowerCase()
  const password = String(formData.get('password') || '').trim()
  if (!name || !slug || !password) return

  const supabase = getSupabaseServerClient()
  if (!supabase) return

  await supabase.from('channels').insert({
    name,
    slug,
    edit_password_hash: hashEditPassword(password),
  })

  redirect('/admin')
}

export default async function AdminPage() {
  const authorized = await isAdminAuthorized()
  if (!authorized) redirect('/admin/login')

  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return <main className="p-6">Supabase env가 필요합니다.</main>
  }

  const { data: channels } = await supabase
    .from('channels')
    .select('id,name,slug,created_at')
    .order('created_at', { ascending: false })
    .returns<Channel[]>()

  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-5xl mx-auto space-y-6">
        <header className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold">Admin</h1>
            <p className="text-sm text-gray-600">채널/그룹/경기 운영</p>
          </div>
          <form action="/admin/auth" method="post">
            <input type="hidden" name="action" value="logout" />
            <button className="text-xs underline" type="submit">로그아웃</button>
          </form>
        </header>

        <section className="rounded border p-4 space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">채널 생성</h2>
          <form action={createChannel} className="grid md:grid-cols-4 gap-2">
            <input className="rounded border px-3 py-2 text-sm" name="name" placeholder="채널명" required />
            <input className="rounded border px-3 py-2 text-sm" name="slug" placeholder="slug (예: bulamsan)" required />
            <input className="rounded border px-3 py-2 text-sm" type="password" name="password" placeholder="채널 편집 비밀번호" required />
            <button className="rounded bg-black text-white px-3 py-2 text-sm" type="submit">생성</button>
          </form>
        </section>

        <section className="rounded border p-4 space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">채널 목록</h2>
          {(channels ?? []).length === 0 ? (
            <p className="text-sm text-gray-500">채널이 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {(channels ?? []).map((c) => (
                <li key={c.id} className="rounded border px-3 py-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="font-medium text-sm">{c.name}</div>
                    <div className="text-xs text-gray-500">/{c.slug} · {new Date(c.created_at).toLocaleString()}</div>
                  </div>
                  <div className="text-xs flex gap-2">
                    <Link className="underline" href={`/c/${c.slug}`}>사용자 화면</Link>
                    <Link className="underline" href={`/admin/channel/${c.id}`}>운영</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
    </main>
  )
}
