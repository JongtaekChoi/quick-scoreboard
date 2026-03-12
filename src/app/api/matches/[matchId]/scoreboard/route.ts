import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase'

type MatchRow = {
  id: string
  team_a_id: string | null
  team_b_id: string | null
  team_a_name: string
  team_b_name: string
  score_a: number
  score_b: number
}

type GoalRow = {
  id: string
  team_side: 'A' | 'B'
  minute: number | null
  scorer_name: string | null
  assist_name: string | null
  created_at: string
}

const SCOREBOARD_TTL_SECONDS = 5

export async function GET(req: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params
  const supabase = getSupabaseServerClient()
  if (!supabase) return NextResponse.json({ error: 'env_missing' }, { status: 500 })

  const [{ data: match }, { data: goals }] = await Promise.all([
    supabase
      .from('matches')
      .select('id,team_a_id,team_b_id,team_a_name,team_b_name,score_a,score_b')
      .eq('id', matchId)
      .maybeSingle<MatchRow>(),
    supabase
      .from('goal_events')
      .select('id,team_side,minute,scorer_name,assist_name,created_at')
      .eq('match_id', matchId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .returns<GoalRow[]>(),
  ])

  if (!match) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const teamIds = [match.team_a_id, match.team_b_id].filter((v): v is string => Boolean(v))
  const { data: teams } = teamIds.length
    ? await supabase.from('teams').select('id,name').in('id', teamIds)
    : { data: [] as { id: string; name: string }[] }

  const teamNameById = new Map((teams ?? []).map((t) => [t.id, t.name]))
  const normalizedMatch = {
    ...match,
    team_a_name: match.team_a_id ? (teamNameById.get(match.team_a_id) ?? match.team_a_name) : match.team_a_name,
    team_b_name: match.team_b_id ? (teamNameById.get(match.team_b_id) ?? match.team_b_name) : match.team_b_name,
  }

  const body = { match: normalizedMatch, goals: goals ?? [] }
  const etag = `W/"${createHash('sha1').update(JSON.stringify(body)).digest('hex')}"`

  if (req.headers.get('if-none-match') === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        'Cache-Control': `public, max-age=0, s-maxage=${SCOREBOARD_TTL_SECONDS}, stale-while-revalidate=5`,
      },
    })
  }

  return NextResponse.json(body, {
    headers: {
      ETag: etag,
      'Cache-Control': `public, max-age=0, s-maxage=${SCOREBOARD_TTL_SECONDS}, stale-while-revalidate=5`,
    },
  })
}
