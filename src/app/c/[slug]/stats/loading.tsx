export default function StatsLoading() {
  return (
    <main className="min-h-screen bg-gray-50 p-4 pb-24 md:p-6">
      <section className="mx-auto max-w-5xl space-y-4 animate-pulse">
        <div className="rounded-2xl border bg-white p-4 space-y-3">
          <div className="h-7 w-52 rounded bg-gray-200" />
          <div className="flex gap-2">
            <div className="h-6 w-12 rounded-full bg-gray-200" />
            <div className="h-6 w-12 rounded-full bg-gray-200" />
            <div className="h-6 w-12 rounded-full bg-gray-200" />
            <div className="h-6 w-12 rounded-full bg-gray-200" />
          </div>
        </div>

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
