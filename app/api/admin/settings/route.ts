// GET/PATCH /api/m/analytics/admin/settings
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { prisma } from '@/lib/db/prisma'
import { errorResponse } from '@/lib/utils'
import { getAnalyticsSettings, getBannerState, updateAnalyticsSettings } from '@/modules/analytics/lib/settings'
import { RETENTION_MAX_DAYS, RETENTION_MIN_DAYS } from '@/modules/analytics/lib/types'

async function view() {
  const [settings, banner, config] = await Promise.all([
    getAnalyticsSettings(),
    getBannerState(),
    prisma.siteConfig.findUnique({ where: { id: 'singleton' }, select: { adminPath: true } }).catch(() => null),
  ])
  return { ...settings, banner, adminPath: config?.adminPath ?? 'cactus-admin' }
}

export async function GET() {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'analytics.manage')) return errorResponse('Forbidden', 403)
  return NextResponse.json(await view())
}

const Body = z.object({
  enabled: z.boolean().optional(),
  respectDnt: z.boolean().optional(),
  excludeAdmins: z.boolean().optional(),
  retentionDays: z.number().int().min(RETENTION_MIN_DAYS).max(RETENTION_MAX_DAYS).optional(),
  ownHosts: z.string().max(500).optional(),
})

export async function PATCH(request: NextRequest) {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'analytics.manage')) return errorResponse('Forbidden', 403)

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Invalid settings', 400)

  await updateAnalyticsSettings(parsed.data)
  return NextResponse.json(await view())
}
