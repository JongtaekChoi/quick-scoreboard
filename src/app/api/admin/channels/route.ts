import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase'
import { isAdminAuthorized } from '@/lib/adminAuth'

type Channel = { id: string; name: string }

export async function GET() {
  const authorized = await isAdminAuthorized()
  if (!authorized) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ error: 'env_missing' }, { status: 500 })
  }

  const { data: channels, error } = await supabase
    .from('channels')
    .select('id,name')
    .order('name', { ascending: true })
    .returns<Channel[]>()

  if (error) {
    return NextResponse.json({ error: 'query_failed', detail: error.message }, { status: 500 })
  }

  return NextResponse.json({ channels: channels ?? [] })
}
