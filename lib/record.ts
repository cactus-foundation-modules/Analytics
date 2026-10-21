import { prisma } from '@/lib/db/prisma'
import {
  attributionSignature,
  classify,
  hasCampaignSignal,
  landingUrl,
  type Attribution,
} from '@/modules/analytics/lib/classify'
import { LAST_TOUCH_DAYS, ORDER_WINDOW_HOURS, SESSION_MINUTES } from '@/modules/analytics/lib/types'

const ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** A cookie value is only ever used as an id when it is exactly the shape we issue. */
export function validId(value: string | undefined | null): string | null {
  return value && ID_SHAPE.test(value) ? value : null
}

export type ViewInput = {
  visitorId: string | null
  sessionId: string | null
  path: string
  title: string | null
  search: string
  referrer: string | null
  device: string
  country: string | null
  ownHosts: Set<string>
}

export type Identity = { visitorId: string; sessionId: string }

type SessionRow = { id: string; source: string; medium: string; campaign: string | null; active: boolean }

async function findSession(visitorId: string, sessionId: string | null): Promise<SessionRow | null> {
  if (!sessionId) return null
  const rows = await prisma.$queryRaw<SessionRow[]>`
    SELECT "id", "source", "medium", "campaign",
           "last_seen_at" > CURRENT_TIMESTAMP - make_interval(mins => ${SESSION_MINUTES}::int) AS "active"
    FROM "ana_sessions" WHERE "id" = ${sessionId} AND "visitor_id" = ${visitorId}
  `
  return rows[0] ?? null
}

/**
 * Count one page view. Returns the ids to put back in the visitor's cookies.
 *
 * A visit carries on while it is quiet for less than half an hour, and starts
 * afresh when a tagged link from a different campaign lands mid-visit - someone
 * who clicks an advert, wanders off, and clicks a newsletter link ten minutes
 * later has been brought by two different things, and the second must not vanish
 * into the first.
 */
export async function recordView(input: ViewInput): Promise<Identity> {
  const visitorId = input.visitorId ?? crypto.randomUUID()
  const existing = await findSession(visitorId, input.sessionId)

  let sessionId = existing?.active ? existing.id : null
  let attribution: Attribution | null = null

  if (sessionId && existing && hasCampaignSignal(input.search)) {
    const candidate = classify({ search: input.search, referrer: input.referrer, ownHosts: input.ownHosts })
    if (attributionSignature(candidate) !== attributionSignature(existing)) {
      attribution = candidate
      sessionId = null
    }
  }

  if (!sessionId) {
    attribution ??= classify({ search: input.search, referrer: input.referrer, ownHosts: input.ownHosts })
    sessionId = crypto.randomUUID()
    const a = attribution
    const url = landingUrl(input.path, input.search)
    const utmJson = JSON.stringify(a.utm)

    await prisma.$executeRaw`
      INSERT INTO "ana_visitors" ("id", "first_channel", "first_source", "first_medium", "first_campaign",
                                  "first_landing_path", "device", "country")
      VALUES (${visitorId}, ${a.channel}, ${a.source}, ${a.medium}, ${a.campaign},
              ${input.path}, ${input.device}, ${input.country})
      ON CONFLICT ("id") DO NOTHING
    `
    await prisma.$executeRaw`
      INSERT INTO "ana_sessions" ("id", "visitor_id", "landing_path", "landing_url", "referrer", "referrer_host",
                                  "channel", "source", "medium", "campaign", "term", "content", "utm",
                                  "click_id_type", "device", "country")
      VALUES (${sessionId}, ${visitorId}, ${input.path}, ${url}, ${input.referrer}, ${a.referrerHost},
              ${a.channel}, ${a.source}, ${a.medium}, ${a.campaign}, ${a.term}, ${a.content}, ${utmJson}::jsonb,
              ${a.clickIdType}, ${input.device}, ${input.country})
    `
    await prisma.$executeRaw`UPDATE "ana_visitors" SET "sessions" = "sessions" + 1 WHERE "id" = ${visitorId}`
  }

  await prisma.$executeRaw`
    INSERT INTO "ana_pageviews" ("session_id", "visitor_id", "path", "title")
    VALUES (${sessionId}, ${visitorId}, ${input.path}, ${input.title})
  `
  await prisma.$executeRaw`
    UPDATE "ana_sessions" SET "page_views" = "page_views" + 1, "last_seen_at" = CURRENT_TIMESTAMP WHERE "id" = ${sessionId}
  `
  await prisma.$executeRaw`
    UPDATE "ana_visitors" SET "page_views" = "page_views" + 1, "last_seen_at" = CURRENT_TIMESTAMP WHERE "id" = ${visitorId}
  `
  return { visitorId, sessionId }
}

type ShopOrderRow = {
  id: string
  order_number: string
  customer_email: string | null
  customer_name: string | null
  total: number
  currency: string
}

/** The shop's own record of the order, or null when there is no shop, or no such recent order. */
async function findShopOrder(orderNumber: string): Promise<ShopOrderRow | null> {
  try {
    const rows = await prisma.$queryRaw<ShopOrderRow[]>`
      SELECT "id", "order_number", "customer_email", "customer_name", "total"::float8 AS "total", "currency"
      FROM "shp_orders"
      WHERE "order_number" = ${orderNumber}
        AND "created_at" > CURRENT_TIMESTAMP - make_interval(hours => ${ORDER_WINDOW_HOURS}::int)
    `
    return rows[0] ?? null
  } catch {
    // No shop installed, or not migrated: there is simply nothing to attribute.
    return null
  }
}

type VisitorRow = {
  first_channel: string
  first_source: string
  first_medium: string
  first_campaign: string | null
  days_known: number
}

type TouchRow = { channel: string; source: string; medium: string; campaign: string | null }
type SessionFacts = { id: string; landing_path: string; page_views: number; channel: string; source: string; medium: string; campaign: string | null }

/**
 * Tie an order the shop has confirmed to the visitor who placed it.
 *
 * What the browser sends is only a claim ("this was my order"), so everything
 * that matters is read from the shop's own table instead: the total, the
 * customer, whether it exists at all. The claim is also only honoured for an
 * order placed in the last two days and only once - the first to claim wins, and
 * the first to claim is the browser that was actually on the confirmation page.
 */
export async function recordOrder(identity: Identity, orderNumber: string): Promise<'recorded' | 'ignored'> {
  const order = await findShopOrder(orderNumber)
  if (!order) return 'ignored'

  const taken = await prisma.$queryRaw<Array<{ one: number }>>`
    SELECT 1 AS "one" FROM "ana_orders" WHERE "order_number" = ${order.order_number}
  `
  if (taken.length > 0) return 'ignored'

  const visitors = await prisma.$queryRaw<VisitorRow[]>`
    SELECT "first_channel", "first_source", "first_medium", "first_campaign",
           GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - "first_seen_at")) / 86400))::int AS "days_known"
    FROM "ana_visitors" WHERE "id" = ${identity.visitorId}
  `
  const visitor = visitors[0]
  if (!visitor) return 'ignored'

  const sessions = await prisma.$queryRaw<SessionFacts[]>`
    SELECT "id", "landing_path", "page_views", "channel", "source", "medium", "campaign"
    FROM "ana_sessions" WHERE "id" = ${identity.sessionId} AND "visitor_id" = ${identity.visitorId}
  `
  const session = sessions[0]
  if (!session) return 'ignored'

  // The credit: the latest visit that was not simply typing the address in.
  const touches = await prisma.$queryRaw<TouchRow[]>`
    SELECT "channel", "source", "medium", "campaign" FROM "ana_sessions"
    WHERE "visitor_id" = ${identity.visitorId}
      AND "channel" <> 'Direct'
      AND "started_at" > CURRENT_TIMESTAMP - make_interval(days => ${LAST_TOUCH_DAYS}::int)
    ORDER BY "started_at" DESC LIMIT 1
  `
  const credit: TouchRow = touches[0] ?? session

  const inserted = await prisma.$executeRaw`
    INSERT INTO "ana_orders" ("order_number", "order_id", "visitor_id", "session_id", "customer_email", "customer_name",
                              "total", "currency", "channel", "source", "medium", "campaign",
                              "first_channel", "first_source", "first_medium", "first_campaign",
                              "landing_path", "pages_viewed", "days_to_order")
    VALUES (${order.order_number}, ${order.id}, ${identity.visitorId}, ${identity.sessionId},
            ${order.customer_email}, ${order.customer_name}, ${order.total}, ${order.currency},
            ${credit.channel}, ${credit.source}, ${credit.medium}, ${credit.campaign},
            ${visitor.first_channel}, ${visitor.first_source}, ${visitor.first_medium}, ${visitor.first_campaign},
            ${session.landing_path}, ${session.page_views}, ${visitor.days_known})
    ON CONFLICT ("order_number") DO NOTHING
  `
  if (inserted > 0) {
    await prisma.$executeRaw`UPDATE "ana_sessions" SET "ordered" = true WHERE "id" = ${identity.sessionId}`
  }
  return inserted > 0 ? 'recorded' : 'ignored'
}

/** Page-by-page history is the bulk of the data; sessions and orders outlive it. */
export async function pruneOld(retentionDays: number): Promise<{ pageViews: number; sessions: number; visitors: number }> {
  const pageViews = await prisma.$executeRaw`
    DELETE FROM "ana_pageviews" WHERE "viewed_at" < CURRENT_TIMESTAMP - make_interval(days => ${retentionDays}::int)
  `
  // A visit that never led to an order goes with its history. One that did is
  // kept, because the order row points at it.
  const sessions = await prisma.$executeRaw`
    DELETE FROM "ana_sessions"
    WHERE "started_at" < CURRENT_TIMESTAMP - make_interval(days => ${retentionDays}::int) AND "ordered" = false
  `
  const visitors = await prisma.$executeRaw`
    DELETE FROM "ana_visitors" v
    WHERE v."last_seen_at" < CURRENT_TIMESTAMP - make_interval(days => ${retentionDays}::int)
      AND NOT EXISTS (SELECT 1 FROM "ana_sessions" s WHERE s."visitor_id" = v."id")
      AND NOT EXISTS (SELECT 1 FROM "ana_orders" o WHERE o."visitor_id" = v."id")
  `
  return { pageViews, sessions, visitors }
}
