export default function JerseyBadge({ number, className = '' }: { number?: string | null; className?: string }) {
  if (!number) return null

  return (
    <span className={`inline-flex items-center align-middle ${className}`} aria-label={`등번호 ${number}`}>
      <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="currentColor" className="text-gray-300" />
        <text
          x="8"
          y="8"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="8"
          fontWeight="700"
          fill="#111827"
        >
          {number}
        </text>
      </svg>
    </span>
  )
}
