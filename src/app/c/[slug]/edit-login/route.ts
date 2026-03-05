import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase'
import { hashEditPassword } from '@/lib/passwordHash'
import { createEditSession, destroyChannelSession } from '@/lib/channelSession'

type Channel = {
  id: string
  slug: string
  edit_password_hash: string
  edit_session_version: number
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const form = await req.formData()
  const password = String(form.get('password') || '')
  const action = String(form.get('action') || 'login')

  const supabase = getSupabaseServerClient()
  if (!supabase) return NextResponse.redirect(new URL(`/c/${slug}?err=env`, req.url))

  if (action === 'logout') {
    await destroyChannelSession(slug)
    return NextResponse.redirect(new URL(`/c/${slug}`, req.url))
  }

  const { data: channel } = await supabase
    .from('channels')
    .select('id,slug,edit_password_hash,edit_session_version')
    .eq('slug', slug)
    .maybeSingle<Channel>()

  if (!channel) return NextResponse.redirect(new URL(`/c/${slug}?err=notfound`, req.url))

  if (hashEditPassword(password) !== channel.edit_password_hash) {
    return NextResponse.redirect(new URL(`/c/${slug}?err=password`, req.url))
  }

  await createEditSession(slug, channel.edit_session_version)
  return NextResponse.redirect(new URL(`/c/${slug}?edit=1`, req.url))
}
