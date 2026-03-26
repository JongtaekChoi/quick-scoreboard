import UserGNBSkeleton from '@/components/UserGNBSkeleton'

export default function AccountLoading() {
  return (
    <main className="min-h-screen bg-gray-50 p-4 pb-24 md:p-6">
      <section className="mx-auto max-w-xl space-y-4 animate-pulse">
        <UserGNBSkeleton />
        <div className="rounded-xl bg-white p-4 shadow-sm space-y-2">
          <div className="h-5 w-32 rounded bg-gray-200" />
          <div className="h-10 rounded bg-gray-100" />
          <div className="h-10 rounded bg-gray-100" />
          <div className="h-9 w-full rounded bg-gray-200" />
        </div>
      </section>
    </main>
  )
}
