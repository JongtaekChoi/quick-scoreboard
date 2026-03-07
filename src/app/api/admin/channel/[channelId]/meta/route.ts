import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase'
import { isAdminAuthorized } from '@/lib/adminAuth'
import { isEditAuthorized, validateManagerAgainstDb } from '@/lib/channelSession'

export async function GET(_: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params

  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ error: 'env_missing' }, { status: 500 })
  }

  const { data: channel } = await supabase
    .from('channels')
    .select('id,name,slug,edit_session_version')
    .eq('id', channelId)
    .maybeSingle<{ id: string; name: string; slug: string; edit_session_version: number }>()

  if (!channel) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const isAdmin = await isAdminAuthorized()
  if (isAdmin) {
    return NextResponse.json({ id: channel.id, name: channel.name, slug: channel.slug, role: 'admin', managerTeamId: null })
  }

  const canEdit = await isEditAuthorized(channel.slug, channel.edit_session_version)
  if (canEdit) {
    return NextResponse.json({ id: channel.id, name: channel.name, slug: channel.slug, role: 'admin', managerTeamId: null })
  }

  const { ok, teamId } = await validateManagerAgainstDb(channel.slug, channel.id)
  if (!ok) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  return NextResponse.json({ id: channel.id, name: channel.name, slug: channel.slug, role: 'manager', managerTeamId: teamId })
}
