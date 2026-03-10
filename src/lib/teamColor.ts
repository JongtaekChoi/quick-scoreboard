const FALLBACK_PALETTE = [
  '#EF4444', '#F97316', '#F59E0B', '#84CC16', '#22C55E', '#10B981',
  '#14B8A6', '#06B6D4', '#0EA5E9', '#3B82F6', '#6366F1', '#8B5CF6',
  '#A855F7', '#D946EF', '#EC4899', '#F43F5E',
]

function hashString(input: string) {
  let h = 0
  for (let i = 0; i < input.length; i += 1) {
    h = (h << 5) - h + input.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

function normalizeHex(color?: string | null) {
  if (!color) return null
  const c = color.trim()
  if (/^#([0-9a-fA-F]{6})$/.test(c)) return c
  return null
}

export function resolveTeamColor({
  teamId,
  teamName,
  colorHex,
}: {
  teamId?: string | null
  teamName?: string | null
  colorHex?: string | null
}) {
  const explicit = normalizeHex(colorHex)
  if (explicit) return explicit
  const key = teamId || teamName || 'team'
  return FALLBACK_PALETTE[hashString(key) % FALLBACK_PALETTE.length]
}
