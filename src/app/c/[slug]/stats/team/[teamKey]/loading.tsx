import UserGNBSkeleton from '@/components/UserGNBSkeleton'

export default function TeamStatsLoading() {
  return (
    <main className="min-h-screen bg-gray-50 p-4 pb-24 md:p-6">
      <section className="mx-auto max-w-5xl space-y-4 animate-pulse">
        <UserGNBSkeleton />

        <div className="h-14 rounded-2xl border bg-white" />
        <div className="h-44 rounded-2xl border bg-white" />
        <div className="h-28 rounded-2xl border bg-white" />
        <div className="h-28 rounded-2xl border bg-white" />
      </section>
    </main>
  )
}
