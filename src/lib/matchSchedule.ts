import { getSupabaseServerClient } from './supabase'

export async function autoStartDueMatches(supabase: ReturnType<typeof getSupabaseServerClient>, matchId?: string) {
  if (!supabase) return

  const nowIso = new Date().toISOString()

  let query = supabase
    .from('matches')
    .update({ status: 'live', started_at: nowIso })
    .eq('status', 'scheduled')
    .is('started_at', null)
    .not('scheduled_start_at', 'is', null)
    .lte('scheduled_start_at', nowIso)

  if (matchId) query = query.eq('id', matchId)

  await query
}
