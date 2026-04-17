import { NextResponse } from 'next/server'

function check(key: string) {
  const value = process.env[key]
  return {
    present: Boolean(value && value.trim().length > 0),
    length: value?.length ?? 0,
  }
}

export async function GET() {
  const checks = {
    NEXT_PUBLIC_SUPABASE_URL: check('NEXT_PUBLIC_SUPABASE_URL'),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: check('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    SUPABASE_SERVICE_ROLE_KEY: check('SUPABASE_SERVICE_ROLE_KEY'),
    SESSION_SECRET: check('SESSION_SECRET'),
    NODE_ENV: process.env.NODE_ENV ?? null,
    VERCEL_ENV: process.env.VERCEL_ENV ?? null,
    VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    VERCEL_URL: process.env.VERCEL_URL ?? null,
  }

  return NextResponse.json({ ok: true, checks })
}
