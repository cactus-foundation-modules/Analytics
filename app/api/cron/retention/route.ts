import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/utils'
import { pruneOld } from '@/modules/analytics/lib/record'
import { getAnalyticsSettings } from '@/modules/analytics/lib/settings'

// Vercel Cron invokes via GET with `Authorization: Bearer $CRON_SECRET`; POST is
// accepted for a manual run.
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return errorResponse('CRON_SECRET is not configured', 503)
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return errorResponse('Unauthorized', 401)

  const { retentionDays } = await getAnalyticsSettings()
  return NextResponse.json({ ok: true, ...(await pruneOld(retentionDays)) })
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}
