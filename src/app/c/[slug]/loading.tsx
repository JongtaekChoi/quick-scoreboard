import UserGNBSkeleton from '@/components/UserGNBSkeleton'

export default function ChannelLoading() {
  return (
    <main className="min-h-screen bg-gray-50 p-4 pb-24 md:p-6">
      <section className="max-w-4xl mx-auto space-y-4 animate-pulse">
        <UserGNBSkeleton />

        <div className="rounded-2xl border bg-white p-4 space-y-3">
          <div className="h-4 w-40 rounded bg-gray-200" />
          <div className="h-16 rounded bg-gray-100" />
          <div className="h-16 rounded bg-gray-100" />
          <div className="h-16 rounded bg-gray-100" />
        </div>
      </section>
    </main>
  )
}
