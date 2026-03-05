import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase'
import { isAdminAuthorized } from '@/lib/adminAuth'

export async function GET(_: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params

  const isAdmin = await isAdminAuthorized()
  if (!isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ error: 'env_missing' }, { status: 500 })
  }

  const { data: channel } = await supabase
    .from('channels')
    .select('id,name,slug')
    .eq('id', channelId)
    .maybeSingle<{ id: string; name: string; slug: string }>()

  if (!channel) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  return NextResponse.json({ id: channel.id, name: channel.name, slug: channel.slug })
}
