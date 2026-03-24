"use client";

function Pulse({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-gray-200 ${className ?? ""}`} />
  );
}

export default function MatchDetailSkeleton() {
  return (
    <main className="min-h-screen p-4 md:p-6 bg-white">
      <section className="max-w-3xl mx-auto space-y-4">
        {/* GNB skeleton */}
        <div className="flex items-center justify-between gap-2">
          <Pulse className="h-5 w-32" />
          <Pulse className="h-5 w-20" />
        </div>

        {/* Scoreboard skeleton */}
        <div className="rounded-xl border border-gray-200 p-4 space-y-3 bg-white/95 shadow-sm">
          <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3">
            <Pulse className="h-6 w-24 ml-auto" />
            <Pulse className="h-10 w-20" />
            <Pulse className="h-6 w-24" />
          </div>
          <div className="space-y-2">
            <Pulse className="h-4 w-full" />
            <Pulse className="h-4 w-full" />
            <Pulse className="h-4 w-3/4" />
          </div>
        </div>

        {/* Actions area skeleton */}
        <div className="space-y-2">
          <Pulse className="h-12 w-full" />
          <Pulse className="h-8 w-48" />
        </div>
      </section>
    </main>
  );
}
