import Link from 'next/link'
import { cookies } from 'next/headers'

const ADMIN_LOGIN_FEEDBACK_COOKIE = 'qsb_admin_login_feedback'

export default async function AdminLoginPage() {
  const store = await cookies()
  const feedback = store.get(ADMIN_LOGIN_FEEDBACK_COOKIE)?.value ?? null

  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-md mx-auto space-y-4 rounded border p-4">
        <h1 className="text-xl font-semibold">Admin 로그인</h1>
        <p className="text-sm text-gray-600">운영용 비밀번호를 입력하세요.</p>
        <form action="/admin/auth" method="post" className="space-y-2">
          <input className="w-full rounded border px-3 py-2 text-sm" type="password" name="password" placeholder="admin password" required />
          <button className="w-full rounded bg-black text-white px-3 py-2 text-sm" type="submit">로그인</button>
        </form>
        {feedback === 'invalid_password' ? <p className="text-sm text-red-600">비밀번호가 올바르지 않습니다.</p> : null}
        <Link className="underline text-sm" href="/">홈으로</Link>
      </section>
    </main>
  )
}
