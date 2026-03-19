export default function CalendarLoading() {
  return (
    <main className="min-h-screen bg-gray-50 p-3 pb-24 md:p-6">
      <section className="mx-auto max-w-4xl space-y-3 md:space-y-4 animate-pulse">
        <div className="rounded-2xl border bg-white p-4 space-y-3">
          <div className="h-7 w-56 rounded bg-gray-200" />
          <div className="flex gap-2">
            <div className="h-6 w-12 rounded-full bg-gray-200" />
            <div className="h-6 w-12 rounded-full bg-gray-200" />
            <div className="h-6 w-12 rounded-full bg-gray-200" />
            <div className="h-6 w-12 rounded-full bg-gray-200" />
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-3 space-y-3">
          <div className="h-5 w-36 rounded bg-gray-200" />
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 35 }).map((_, i) => (
              <div key={i} className="h-12 rounded bg-gray-100" />
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
