import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type {
  CampaignRow,
  DailyPoint,
  LandingRow,
  OrderRow,
  Overview,
  SourceGroup,
  SourceRow,
  ViewedRow,
  VisitRow,
} from '@/modules/analytics/lib/types'

// Every query here is read-only and bounded by a number of days. The grouping
// expressions are chosen from a fixed table below and spliced in with
// Prisma.raw - never built from request input - because a column list cannot be
// a bound parameter.

const SESSION_GROUP: Record<SourceGroup, string> = {
  channel: '"channel"',
  source: '"source"',
  source_medium: `"source" || ' / ' || "medium"`,
}
const FIRST_TOUCH_GROUP: Record<SourceGroup, string> = {
  channel: '"first_channel"',
  source: '"first_source"',
  source_medium: `"first_source" || ' / ' || "first_medium"`,
}

function since(days: number): Prisma.Sql {
  return Prisma.sql`CURRENT_TIMESTAMP - make_interval(days => ${days}::int)`
}

const n = (value: unknown): number => (typeof value === 'number' ? value : Number(value ?? 0))

export async function getOverview(days: number): Promise<Overview> {
  const [totals] = await prisma.$queryRaw<Array<{ sessions: number; visitors: number; page_views: number }>>`
    SELECT COUNT(*)::int AS "sessions", COUNT(DISTINCT "visitor_id")::int AS "visitors",
           COALESCE(SUM("page_views"), 0)::int AS "page_views"
    FROM "ana_sessions" WHERE "started_at" >= ${since(days)}
  `
  const [fresh] = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS "n" FROM "ana_visitors" WHERE "first_seen_at" >= ${since(days)}
  `
  const [orders] = await prisma.$queryRaw<Array<{ orders: number; revenue: number; currency: string | null }>>`
    SELECT COUNT(*)::int AS "orders", COALESCE(SUM("total"), 0)::float8 AS "revenue", MIN("currency") AS "currency"
    FROM "ana_orders" WHERE "placed_at" >= ${since(days)}
  `
  const daily = await prisma.$queryRaw<DailyPoint[]>`
    SELECT to_char(d, 'YYYY-MM-DD') AS "day",
           COALESCE(s."sessions", 0)::int AS "sessions", COALESCE(o."orders", 0)::int AS "orders"
    FROM generate_series(
           date_trunc('day', CURRENT_TIMESTAMP) - make_interval(days => ${days - 1}::int),
           date_trunc('day', CURRENT_TIMESTAMP), interval '1 day') AS d
    LEFT JOIN (
      SELECT date_trunc('day', "started_at") AS "day", COUNT(*) AS "sessions"
      FROM "ana_sessions" WHERE "started_at" >= ${since(days)} GROUP BY 1
    ) s ON s."day" = d
    LEFT JOIN (
      SELECT date_trunc('day', "placed_at") AS "day", COUNT(*) AS "orders"
      FROM "ana_orders" WHERE "placed_at" >= ${since(days)} GROUP BY 1
    ) o ON o."day" = d
    ORDER BY d
  `
  return {
    sessions: n(totals?.sessions),
    visitors: n(totals?.visitors),
    newVisitors: n(fresh?.n),
    pageViews: n(totals?.page_views),
    orders: n(orders?.orders),
    revenue: n(orders?.revenue),
    currency: orders?.currency ?? 'GBP',
    daily,
    channels: await getSources(days, 'channel'),
  }
}

export async function getSources(days: number, group: SourceGroup): Promise<SourceRow[]> {
  const sessionKey = Prisma.raw(SESSION_GROUP[group])
  const firstKey = Prisma.raw(FIRST_TOUCH_GROUP[group])

  const visits = await prisma.$queryRaw<Array<{ key: string; sessions: number; visitors: number }>>`
    SELECT ${sessionKey} AS "key", COUNT(*)::int AS "sessions", COUNT(DISTINCT "visitor_id")::int AS "visitors"
    FROM "ana_sessions" WHERE "started_at" >= ${since(days)} GROUP BY 1
  `
  const credited = await prisma.$queryRaw<Array<{ key: string; orders: number; revenue: number }>>`
    SELECT ${sessionKey} AS "key", COUNT(*)::int AS "orders", COALESCE(SUM("total"), 0)::float8 AS "revenue"
    FROM "ana_orders" WHERE "placed_at" >= ${since(days)} GROUP BY 1
  `
  const first = await prisma.$queryRaw<Array<{ key: string; orders: number }>>`
    SELECT ${firstKey} AS "key", COUNT(*)::int AS "orders"
    FROM "ana_orders" WHERE "placed_at" >= ${since(days)} GROUP BY 1
  `

  const rows = new Map<string, SourceRow>()
  const row = (key: string): SourceRow => {
    let r = rows.get(key)
    if (!r) {
      r = { key, sessions: 0, visitors: 0, orders: 0, revenue: 0, firstTouchOrders: 0 }
      rows.set(key, r)
    }
    return r
  }
  for (const v of visits) Object.assign(row(v.key), { sessions: n(v.sessions), visitors: n(v.visitors) })
  for (const c of credited) Object.assign(row(c.key), { orders: n(c.orders), revenue: n(c.revenue) })
  for (const f of first) row(f.key).firstTouchOrders = n(f.orders)

  return [...rows.values()].sort((a, b) => b.sessions - a.sessions || b.orders - a.orders)
}

export async function getCampaigns(days: number): Promise<CampaignRow[]> {
  const visits = await prisma.$queryRaw<Array<{ campaign: string; source: string; medium: string; sessions: number; visitors: number }>>`
    SELECT "campaign", "source", "medium", COUNT(*)::int AS "sessions", COUNT(DISTINCT "visitor_id")::int AS "visitors"
    FROM "ana_sessions" WHERE "started_at" >= ${since(days)} AND "campaign" IS NOT NULL
    GROUP BY 1, 2, 3
  `
  const credited = await prisma.$queryRaw<Array<{ campaign: string; source: string; medium: string; orders: number; revenue: number }>>`
    SELECT "campaign", "source", "medium", COUNT(*)::int AS "orders", COALESCE(SUM("total"), 0)::float8 AS "revenue"
    FROM "ana_orders" WHERE "placed_at" >= ${since(days)} AND "campaign" IS NOT NULL
    GROUP BY 1, 2, 3
  `
  const rows = new Map<string, CampaignRow>()
  const row = (campaign: string, source: string, medium: string): CampaignRow => {
    const key = `${campaign}\u0000${source}\u0000${medium}`
    let r = rows.get(key)
    if (!r) {
      r = { campaign, source, medium, sessions: 0, visitors: 0, orders: 0, revenue: 0 }
      rows.set(key, r)
    }
    return r
  }
  for (const v of visits) Object.assign(row(v.campaign, v.source, v.medium), { sessions: n(v.sessions), visitors: n(v.visitors) })
  for (const c of credited) Object.assign(row(c.campaign, c.source, c.medium), { orders: n(c.orders), revenue: n(c.revenue) })
  return [...rows.values()].sort((a, b) => b.sessions - a.sessions)
}

export async function getPages(days: number): Promise<{ landing: LandingRow[]; viewed: ViewedRow[] }> {
  const landing = await prisma.$queryRaw<LandingRow[]>`
    SELECT "landing_path" AS "path", COUNT(*)::int AS "sessions", COUNT(DISTINCT "visitor_id")::int AS "visitors",
           COUNT(*) FILTER (WHERE "ordered")::int AS "orders"
    FROM "ana_sessions" WHERE "started_at" >= ${since(days)}
    GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 100
  `
  const viewed = await prisma.$queryRaw<ViewedRow[]>`
    SELECT "path", COUNT(*)::int AS "views", COUNT(DISTINCT "session_id")::int AS "sessions"
    FROM "ana_pageviews" WHERE "viewed_at" >= ${since(days)}
    GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 100
  `
  return { landing, viewed }
}

type OrderDbRow = {
  order_number: string
  placed_at: Date
  customer_name: string | null
  customer_email: string | null
  total: number
  currency: string
  channel: string
  source: string
  medium: string
  campaign: string | null
  first_channel: string
  first_source: string
  first_medium: string
  first_campaign: string | null
  landing_path: string | null
  pages_viewed: number
  days_to_order: number
}

export async function getOrders(days: number): Promise<{ orders: OrderRow[]; shopOrders: number | null }> {
  const rows = await prisma.$queryRaw<OrderDbRow[]>`
    SELECT "order_number", "placed_at", "customer_name", "customer_email", "total"::float8 AS "total", "currency",
           "channel", "source", "medium", "campaign", "first_channel", "first_source", "first_medium", "first_campaign",
           "landing_path", "pages_viewed", "days_to_order"
    FROM "ana_orders" WHERE "placed_at" >= ${since(days)}
    ORDER BY "placed_at" DESC LIMIT 500
  `
  // How many orders the shop itself took in the same window, so the page can say
  // how many it could not link to a visit (declined cookies, blocked scripts,
  // phone orders). Best effort: no shop, no figure.
  let shopOrders: number | null = null
  try {
    const [r] = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS "n" FROM "shp_orders"
      WHERE "created_at" >= ${since(days)} AND "payment_status" IN ('PAID', 'AWAITING_CONFIRMATION')
    `
    shopOrders = n(r?.n)
  } catch {
    shopOrders = null
  }
  return {
    shopOrders,
    orders: rows.map((r) => ({
      orderNumber: r.order_number,
      placedAt: new Date(r.placed_at).toISOString(),
      customerName: r.customer_name,
      customerEmail: r.customer_email,
      total: n(r.total),
      currency: r.currency,
      channel: r.channel,
      source: r.source,
      medium: r.medium,
      campaign: r.campaign,
      firstChannel: r.first_channel,
      firstSource: r.first_source,
      firstMedium: r.first_medium,
      firstCampaign: r.first_campaign,
      landingPath: r.landing_path,
      pagesViewed: n(r.pages_viewed),
      daysToOrder: n(r.days_to_order),
    })),
  }
}

type VisitDbRow = {
  id: string
  started_at: Date
  landing_url: string
  referrer: string | null
  channel: string
  source: string
  medium: string
  campaign: string | null
  utm: Record<string, string> | null
  click_id_type: string | null
  device: string | null
  country: string | null
  page_views: number
  ordered: boolean
}

export async function getVisits(days: number, taggedOnly: boolean): Promise<VisitRow[]> {
  const filter = taggedOnly
    ? Prisma.sql`AND ("utm" <> '{}'::jsonb OR "click_id_type" IS NOT NULL)`
    : Prisma.empty
  const rows = await prisma.$queryRaw<VisitDbRow[]>`
    SELECT "id", "started_at", "landing_url", "referrer", "channel", "source", "medium", "campaign", "utm",
           "click_id_type", "device", "country", "page_views", "ordered"
    FROM "ana_sessions" WHERE "started_at" >= ${since(days)} ${filter}
    ORDER BY "started_at" DESC LIMIT 300
  `
  return rows.map((r) => ({
    id: r.id,
    startedAt: new Date(r.started_at).toISOString(),
    landingUrl: r.landing_url,
    referrer: r.referrer,
    channel: r.channel,
    source: r.source,
    medium: r.medium,
    campaign: r.campaign,
    utm: r.utm ?? {},
    clickIdType: r.click_id_type,
    device: r.device,
    country: r.country,
    pageViews: n(r.page_views),
    ordered: r.ordered,
  }))
}
