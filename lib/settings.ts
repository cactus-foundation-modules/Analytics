import { prisma } from '@/lib/db/prisma'
import {
  ANALYTICS_CATEGORY,
  clampRetention,
  DEFAULT_SETTINGS,
  type AnalyticsSettings,
  type BannerState,
  type ConsentGate,
} from '@/modules/analytics/lib/types'

type SettingsRow = {
  enabled: boolean
  respect_dnt: boolean
  exclude_admins: boolean
  retention_days: number
  own_hosts: string
}

export async function getAnalyticsSettings(): Promise<AnalyticsSettings> {
  const rows = await prisma.$queryRaw<SettingsRow[]>`
    SELECT "enabled", "respect_dnt", "exclude_admins", "retention_days", "own_hosts"
    FROM "ana_settings" WHERE "id" = 'singleton'
  `.catch(() => [] as SettingsRow[])
  const row = rows[0]
  // A half-installed module (migration not run yet) must record nothing.
  if (!row) return { ...DEFAULT_SETTINGS, enabled: false }
  return {
    enabled: row.enabled,
    respectDnt: row.respect_dnt,
    excludeAdmins: row.exclude_admins,
    retentionDays: clampRetention(row.retention_days),
    ownHosts: row.own_hosts ?? '',
  }
}

export async function updateAnalyticsSettings(patch: Partial<AnalyticsSettings>): Promise<void> {
  if (patch.enabled !== undefined) {
    await prisma.$executeRaw`UPDATE "ana_settings" SET "enabled" = ${patch.enabled}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'singleton'`
  }
  if (patch.respectDnt !== undefined) {
    await prisma.$executeRaw`UPDATE "ana_settings" SET "respect_dnt" = ${patch.respectDnt}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'singleton'`
  }
  if (patch.excludeAdmins !== undefined) {
    await prisma.$executeRaw`UPDATE "ana_settings" SET "exclude_admins" = ${patch.excludeAdmins}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'singleton'`
  }
  if (patch.retentionDays !== undefined) {
    const days = clampRetention(patch.retentionDays)
    await prisma.$executeRaw`UPDATE "ana_settings" SET "retention_days" = ${days}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'singleton'`
  }
  if (patch.ownHosts !== undefined) {
    const hosts = patch.ownHosts.trim().slice(0, 500)
    await prisma.$executeRaw`UPDATE "ana_settings" SET "own_hosts" = ${hosts}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = 'singleton'`
  }
}

type StoredBanner = { enabled?: boolean; categories?: Array<{ key?: string }> } | null

/** What the site's cookie banner offers, read from core's config rather than assumed. */
export async function getBannerState(): Promise<BannerState> {
  const config = await prisma.siteConfig
    .findUnique({ where: { id: 'singleton' }, select: { consentBannerConfig: true } })
    .catch(() => null)
  const banner = config?.consentBannerConfig as StoredBanner
  const keys = new Set((banner?.categories ?? []).map((c) => c?.key).filter(Boolean) as string[])
  return { bannerEnabled: banner?.enabled === true, hasAnalyticsCategory: keys.has(ANALYTICS_CATEGORY) }
}

/**
 * You can only gate on a switch that exists. With the banner off, or with no
 * Analytics category on it, there is nothing for a visitor to grant, so waiting
 * for a grant would mean counting nobody for ever. It counts instead, and the
 * settings tab says so in words. The owner decides what to ask; silence is the
 * one answer a module must never invent on their behalf.
 */
export function gateFromBanner(banner: BannerState): ConsentGate {
  return banner.bannerEnabled && banner.hasAnalyticsCategory ? 'category' : 'allowed'
}
