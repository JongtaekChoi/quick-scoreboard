import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase'

type MatchRow = {
  id: string
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
  scorer_no: string | null
  created_at: string
}

export async function GET(_: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params
  const supabase = getSupabaseServerClient()
  if (!supabase) return NextResponse.json({ error: 'env_missing' }, { status: 500 })

  const [{ data: match }, { data: goals }] = await Promise.all([
    supabase
      .from('matches')
      .select('id,team_a_name,team_b_name,score_a,score_b')
      .eq('id', matchId)
      .maybeSingle<MatchRow>(),
    supabase
      .from('goal_events')
      .select('id,team_side,minute,scorer_name,scorer_no,created_at')
      .eq('match_id', matchId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .returns<GoalRow[]>(),
  ])

  if (!match) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json({ match, goals: goals ?? [] })
}
