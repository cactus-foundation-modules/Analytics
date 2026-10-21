// GET /api/m/analytics/admin/report?view=overview&days=30
import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { getCampaigns, getOrders, getOverview, getPages, getSources, getVisits } from '@/modules/analytics/lib/reports'
import { REPORT_DAYS, REPORT_VIEWS, SOURCE_GROUPS, type SourceGroup } from '@/modules/analytics/lib/types'

export async function GET(request: NextRequest) {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'analytics.view')) return errorResponse('Forbidden', 403)

  const params = request.nextUrl.searchParams
  const view = REPORT_VIEWS.find((v) => v === params.get('view'))
  if (!view) return errorResponse('Unknown report', 400)
  const requested = Number(params.get('days'))
  const days = REPORT_DAYS.find((d) => d === requested) ?? 30
  const group = SOURCE_GROUPS.find((g) => g === params.get('group')) ?? ('channel' as SourceGroup)

  switch (view) {
    case 'overview':
      return NextResponse.json(await getOverview(days))
    case 'sources':
      return NextResponse.json({ rows: await getSources(days, group) })
    case 'campaigns':
      return NextResponse.json({ rows: await getCampaigns(days) })
    case 'pages':
      return NextResponse.json(await getPages(days))
    case 'orders':
      return NextResponse.json(await getOrders(days))
    case 'visits':
      return NextResponse.json({ rows: await getVisits(days, params.get('tagged') === '1') })
  }
}
