import UserGNBSkeleton from '@/components/UserGNBSkeleton'

export default function StatsLoading() {
  return (
    <main className="min-h-screen bg-gray-50 p-4 pb-24 md:p-6">
      <section className="mx-auto max-w-5xl space-y-4 animate-pulse">
        <UserGNBSkeleton />

        <div className="grid gap-3 md:grid-cols-2">
          <div className="h-40 rounded-2xl border bg-white" />
          <div className="h-40 rounded-2xl border bg-white" />
          <div className="h-40 rounded-2xl border bg-white" />
          <div className="h-40 rounded-2xl border bg-white" />
        </div>
      </section>
    </main>
  )
}
