import { SupabaseClient } from '@supabase/supabase-js'

export async function ensureTeamInChannel(
  supabase: SupabaseClient,
  channelId: string,
  teamName: string,
): Promise<string | null> {
  // 1. 현재 채널에서 이름으로 찾기
  const { data: existing } = await supabase
    .from('channel_teams_view')
    .select('id')
    .eq('channel_id', channelId)
    .eq('name', teamName)
    .maybeSingle()

  if (existing) {
    await supabase
      .from('channel_teams')
      .update({ last_used_at: new Date().toISOString() })
      .eq('channel_id', channelId)
      .eq('team_id', existing.id)
    return existing.id
  }

  // 2. 새 팀 생성
  const { data: created } = await supabase
    .from('teams')
    .insert({ name: teamName })
    .select('id')
    .single()
  if (!created) return null

  // 3. junction에 연결
  await supabase.from('channel_teams').insert({
    channel_id: channelId,
    team_id: created.id,
    last_used_at: new Date().toISOString(),
  })

  return created.id
}
