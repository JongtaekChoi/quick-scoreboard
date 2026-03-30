import Link from 'next/link'

type TeamStat = {
  key: string
  team: string
  played: number
  win: number
  draw: number
  loss: number
  gf: number
  ga: number
  gd: number
  pts: number
}

export default function TeamRankingWithDetailModal({
  slug,
  teamStats,
  teamColorById,
}: {
  slug: string
  teamStats: TeamStat[]
  teamColorById: Record<string, string>
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left border-b border-gray-100 text-xs text-gray-500">
            <th className="py-1 pr-2">순위</th>
            <th className="py-1 pr-2">팀</th>
            <th className="py-1 pr-2">경기</th>
            <th className="py-1 pr-2">승</th>
            <th className="py-1 pr-2">무</th>
            <th className="py-1 pr-2">패</th>
            <th className="py-1 pr-2">득점</th>
            <th className="py-1 pr-2">실점</th>
            <th className="py-1 pr-2">득실</th>
            <th className="py-1 pr-2">승점</th>
          </tr>
        </thead>
        <tbody>
          {teamStats.map((t, i) => (
            <tr key={t.key} className="border-b border-gray-100 last:border-0">
              <td className="py-1 pr-2">{i + 1}</td>
              <td className="py-1 pr-2">
                <Link href={`/c/${encodeURIComponent(slug)}/stats/team/${encodeURIComponent(t.key)}`} className="inline-flex max-w-[120px] items-center gap-1.5 hover:underline">
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm border border-black/10"
                    style={{ backgroundColor: t.key.startsWith('name:') ? '#D1D5DB' : (teamColorById[t.key] ?? '#D1D5DB') }}
                  />
                  <span className="truncate">{t.team}</span>
                </Link>
              </td>
              <td className="py-1 pr-2">{t.played}</td>
              <td className="py-1 pr-2">{t.win}</td>
              <td className="py-1 pr-2">{t.draw}</td>
              <td className="py-1 pr-2">{t.loss}</td>
              <td className="py-1 pr-2">{t.gf}</td>
              <td className="py-1 pr-2">{t.ga}</td>
              <td className="py-1 pr-2">{t.gd}</td>
              <td className="py-1 pr-2 font-semibold">{t.pts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
