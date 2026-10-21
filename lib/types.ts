export const ANALYTICS_CATEGORY = 'analytics'

export const VISITOR_COOKIE = 'ana_v'
export const SESSION_COOKIE = 'ana_s'
/** A visit ends after this long without a page view. */
export const SESSION_MINUTES = 30
/** The visitor cookie outlives the session by a lot; browsers cap it at 400 days. */
export const VISITOR_COOKIE_DAYS = 395
/** An order is only attributed within this long of being placed. */
export const ORDER_WINDOW_HOURS = 48
/** How far back "the visit that really brought them" may look. */
export const LAST_TOUCH_DAYS = 30

export type AnalyticsSettings = {
  enabled: boolean
  respectDnt: boolean
  excludeAdmins: boolean
  retentionDays: number
  ownHosts: string
}

export const DEFAULT_SETTINGS: AnalyticsSettings = {
  enabled: true,
  respectDnt: true,
  excludeAdmins: true,
  retentionDays: 730,
  ownHosts: '',
}

export const RETENTION_MIN_DAYS = 30
export const RETENTION_MAX_DAYS = 3650

export function clampRetention(days: number): number {
  if (!Number.isFinite(days)) return DEFAULT_SETTINGS.retentionDays
  return Math.min(RETENTION_MAX_DAYS, Math.max(RETENTION_MIN_DAYS, Math.round(days)))
}

/** What the site's cookie banner currently offers, as far as this module cares. */
export type BannerState = {
  bannerEnabled: boolean
  hasAnalyticsCategory: boolean
}

/** 'category' - wait for a yes on the Analytics switch. 'allowed' - nobody can be asked. */
export type ConsentGate = 'category' | 'allowed'

export const REPORT_VIEWS = ['overview', 'sources', 'campaigns', 'pages', 'orders', 'visits'] as const
export type ReportView = (typeof REPORT_VIEWS)[number]

export const REPORT_DAYS = [7, 30, 90, 365] as const

export const SOURCE_GROUPS = ['channel', 'source', 'source_medium'] as const
export type SourceGroup = (typeof SOURCE_GROUPS)[number]

export type SourceRow = {
  key: string
  sessions: number
  visitors: number
  /** Orders credited to this row by the visitor's latest non-direct visit. */
  orders: number
  revenue: number
  /** Orders from visitors whose very first visit was this row. */
  firstTouchOrders: number
}

export type CampaignRow = {
  campaign: string
  source: string
  medium: string
  sessions: number
  visitors: number
  orders: number
  revenue: number
}

export type DailyPoint = { day: string; sessions: number; orders: number }

export type Overview = {
  sessions: number
  visitors: number
  newVisitors: number
  pageViews: number
  orders: number
  revenue: number
  currency: string
  daily: DailyPoint[]
  channels: SourceRow[]
}

export type LandingRow = { path: string; sessions: number; visitors: number; orders: number }
export type ViewedRow = { path: string; views: number; sessions: number }

export type OrderRow = {
  orderNumber: string
  placedAt: string
  customerName: string | null
  customerEmail: string | null
  total: number
  currency: string
  channel: string
  source: string
  medium: string
  campaign: string | null
  firstChannel: string
  firstSource: string
  firstMedium: string
  firstCampaign: string | null
  landingPath: string | null
  pagesViewed: number
  daysToOrder: number
}

export type VisitRow = {
  id: string
  startedAt: string
  landingUrl: string
  referrer: string | null
  channel: string
  source: string
  medium: string
  campaign: string | null
  utm: Record<string, string>
  clickIdType: string | null
  device: string | null
  country: string | null
  pageViews: number
  ordered: boolean
}
