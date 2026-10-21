import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import {
  connectionUri,
  createTestDatabase,
  createTestRole,
  dropStaleTestObjects,
  dropTestDatabase,
  dropTestRole,
  testServerFromEnv,
  type TestRole,
  type TestServer,
} from '@/lib/backup/test-database'
import { ownHostSet } from './classify'

// Every query this module runs is raw SQL, and no other gate executes raw SQL: tsc
// sees a string, eslint sees a string, the build never runs one. So this suite
// runs them against a real Postgres - the migration (twice, to prove it idempotent),
// a visit, a second page, a second campaign, an order, every report, and the prune.
//
// Gated like the other live suites: needs the OVH server, makes cactus_rt_*
// databases and drops them afterwards.
//   RUN_ANALYTICS_SQL=1 npx vitest run modules/analytics/lib/sql.live.test.ts
const ENABLED = process.env.RUN_ANALYTICS_SQL === '1' || process.env.RUN_BACKUP_ROUNDTRIP === '1'
if (ENABLED) {
  try {
    ;(process as unknown as { loadEnvFile: (path: string) => void }).loadEnvFile('.env')
  } catch {
    // No .env - testServerFromEnv below fails the suite loudly rather than here.
  }
}
const suite = ENABLED ? describe : describe.skip

suite('analytics SQL, against a real database', () => {
  let server: TestServer
  let role: TestRole
  let client: Client
  const databaseName = `cactus_rt_ana_${process.pid}`
  const roleName = `cactus_rt_role_ana_${process.pid}`

  let record: typeof import('./record')
  let reports: typeof import('./reports')
  let settings: typeof import('./settings')

  const ownHosts = ownHostSet('https://shop.example.co.uk', '')
  const visitorId = '11111111-1111-4111-8111-111111111111'
  const base = { title: 'Page', country: 'GB', device: 'mobile', ownHosts, referrer: null as string | null }

  beforeAll(async () => {
    server = testServerFromEnv()
    await dropStaleTestObjects(server)
    role = await createTestRole(server, roleName)
    await createTestDatabase(server, databaseName, role)

    const uri = connectionUri(server, databaseName, role)
    client = new Client({ connectionString: `${uri}&uselibpqcompat=true` })
    await client.connect()

    const directory = join(__dirname, '..', 'migrations')
    const files = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()
    for (const pass of [1, 2]) {
      for (const file of files) await client.query(readFileSync(join(directory, file), 'utf8')).catch((err: unknown) => {
        throw new Error(`${file} (pass ${pass}): ${String(err)}`)
      })
    }
    // Just enough of the shop's table for the order lookup and the coverage count.
    await client.query(`
      CREATE TABLE "shp_orders" (
        "id" TEXT PRIMARY KEY, "order_number" TEXT NOT NULL, "customer_email" TEXT, "customer_name" TEXT,
        "total" NUMERIC(10,2) NOT NULL, "currency" TEXT NOT NULL DEFAULT 'GBP', "payment_status" TEXT NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO "shp_orders" ("id", "order_number", "customer_email", "customer_name", "total", "payment_status")
        VALUES ('o1', 'DW000001', 'ann@example.com', 'Ann Buyer', 249.50, 'PAID'),
               ('o2', 'DW000002', 'bob@example.com', 'Bob', 10, 'PAID');
      INSERT INTO "shp_orders" ("id", "order_number", "customer_email", "customer_name", "total", "payment_status", "created_at")
        VALUES ('o3', 'DW000003', 'old@example.com', 'Old', 10, 'PAID', CURRENT_TIMESTAMP - INTERVAL '10 days');
    `)

    process.env.DATABASE_URL = uri
    record = await import('./record')
    reports = await import('./reports')
    settings = await import('./settings')
  }, 120_000)

  afterAll(async () => {
    await import('@/lib/db/prisma')
      .then((module) => module.prisma.$disconnect())
      .catch(() => undefined)
    await client?.end().catch(() => undefined)
    if (server) {
      await dropTestDatabase(server, databaseName).catch(() => undefined)
      await dropTestRole(server, roleName).catch(() => undefined)
    }
  }, 120_000)

  let first: { visitorId: string; sessionId: string }
  let second: { visitorId: string; sessionId: string }
  let third: { visitorId: string; sessionId: string }

  it('reads the settings row the migration seeds', async () => {
    expect(await settings.getAnalyticsSettings()).toMatchObject({ enabled: true, respectDnt: true, retentionDays: 730 })
    await settings.updateAnalyticsSettings({ retentionDays: 90, ownHosts: 'a.com, b.com', excludeAdmins: false })
    expect(await settings.getAnalyticsSettings()).toMatchObject({ retentionDays: 90, ownHosts: 'a.com, b.com', excludeAdmins: false })
  })

  it('starts a visitor and a visit from a tagged advert, keeping every utm tag', async () => {
    first = await record.recordView({
      ...base, visitorId, sessionId: null, path: '/desks',
      search: '?utm_source=Google&utm_medium=cpc&utm_campaign=spring&utm_id=77&gclid=zzz',
    })
    expect(first.visitorId).toBe(visitorId)
    const rows = await client.query(`SELECT * FROM "ana_sessions" WHERE "id" = $1`, [first.sessionId])
    expect(rows.rows[0]).toMatchObject({
      channel: 'Paid Search', source: 'google', medium: 'cpc', campaign: 'spring', click_id_type: 'gclid', page_views: 1,
    })
    expect(rows.rows[0].utm).toMatchObject({ utm_source: 'Google', utm_id: '77' })
    expect(rows.rows[0].landing_url).toContain('utm_campaign=spring')
    const v = await client.query(`SELECT * FROM "ana_visitors" WHERE "id" = $1`, [visitorId])
    expect(v.rows[0]).toMatchObject({ first_channel: 'Paid Search', sessions: 1 })
  })

  it('carries on the same visit for the next page', async () => {
    const again = await record.recordView({ ...base, visitorId, sessionId: first.sessionId, path: '/desks/oak', search: '' })
    expect(again.sessionId).toBe(first.sessionId)
    const s = await client.query(`SELECT "page_views" FROM "ana_sessions" WHERE "id" = $1`, [first.sessionId])
    expect(s.rows[0].page_views).toBe(2)
    const pv = await client.query(`SELECT COUNT(*)::int AS n FROM "ana_pageviews" WHERE "session_id" = $1`, [first.sessionId])
    expect(pv.rows[0].n).toBe(2)
  })

  it('a different tagged campaign mid-visit starts a new visit, but the visitor keeps its first touch', async () => {
    second = await record.recordView({
      ...base, visitorId, sessionId: first.sessionId, path: '/', search: '?utm_source=newsletter&utm_medium=email&utm_campaign=oct',
    })
    expect(second.sessionId).not.toBe(first.sessionId)
    const v = await client.query(`SELECT * FROM "ana_visitors" WHERE "id" = $1`, [visitorId])
    expect(v.rows[0]).toMatchObject({ first_channel: 'Paid Search', sessions: 2, page_views: 3 })
  })

  it('a quiet visit expires and the next page is a fresh, direct one', async () => {
    await client.query(`UPDATE "ana_sessions" SET "last_seen_at" = CURRENT_TIMESTAMP - INTERVAL '2 hours' WHERE "id" = $1`, [second.sessionId])
    third = await record.recordView({ ...base, visitorId, sessionId: second.sessionId, path: '/basket', search: '' })
    expect(third.sessionId).not.toBe(second.sessionId)
    const s = await client.query(`SELECT "channel" FROM "ana_sessions" WHERE "id" = $1`, [third.sessionId])
    expect(s.rows[0].channel).toBe('Direct')
  })

  it('ties an order to the visitor, crediting the latest non-direct visit and remembering the first', async () => {
    expect(await record.recordOrder(third, 'DW000001')).toBe('recorded')
    const o = await client.query(`SELECT * FROM "ana_orders" WHERE "order_number" = 'DW000001'`)
    expect(o.rows[0]).toMatchObject({
      customer_email: 'ann@example.com', customer_name: 'Ann Buyer', currency: 'GBP',
      channel: 'Email', source: 'newsletter', campaign: 'oct',
      first_channel: 'Paid Search', first_source: 'google', first_campaign: 'spring',
    })
    expect(Number(o.rows[0].total)).toBe(249.5)
    const s = await client.query(`SELECT "ordered" FROM "ana_sessions" WHERE "id" = $1`, [third.sessionId])
    expect(s.rows[0].ordered).toBe(true)
  })

  it('counts an order once, and ignores unknown or stale ones', async () => {
    expect(await record.recordOrder(third, 'DW000001')).toBe('ignored')
    expect(await record.recordOrder(third, 'NOPE')).toBe('ignored')
    expect(await record.recordOrder(third, 'DW000003')).toBe('ignored')
    expect(await record.recordOrder({ visitorId: '22222222-2222-4222-8222-222222222222', sessionId: third.sessionId }, 'DW000002')).toBe('ignored')
  })

  it('every report runs and adds up', async () => {
    const overview = await reports.getOverview(30)
    expect(overview).toMatchObject({ sessions: 3, visitors: 1, newVisitors: 1, orders: 1, revenue: 249.5 })
    expect(overview.daily).toHaveLength(30)
    expect(overview.daily.at(-1)).toMatchObject({ sessions: 3, orders: 1 })

    const byChannel = await reports.getSources(30, 'channel')
    expect(byChannel.map((r) => r.key).sort()).toEqual(['Direct', 'Email', 'Paid Search'])
    expect(byChannel.find((r) => r.key === 'Email')).toMatchObject({ sessions: 1, orders: 1, revenue: 249.5 })
    expect(byChannel.find((r) => r.key === 'Paid Search')).toMatchObject({ sessions: 1, orders: 0, firstTouchOrders: 1 })
    expect((await reports.getSources(30, 'source')).map((r) => r.key)).toContain('google')
    expect((await reports.getSources(30, 'source_medium')).map((r) => r.key)).toContain('newsletter / email')

    const campaigns = await reports.getCampaigns(30)
    expect(campaigns.find((c) => c.campaign === 'oct')).toMatchObject({ source: 'newsletter', medium: 'email', sessions: 1, orders: 1 })

    const pages = await reports.getPages(30)
    expect(pages.landing.map((p) => p.path).sort()).toEqual(['/', '/basket', '/desks'])
    expect(pages.viewed.find((p) => p.path === '/desks/oak')).toMatchObject({ views: 1, sessions: 1 })

    const orders = await reports.getOrders(30)
    expect(orders.orders).toHaveLength(1)
    // o1 and o2 are recent and PAID; o3 is ten days old but still inside 30 days.
    expect(orders.shopOrders).toBe(3)

    const tagged = await reports.getVisits(30, true)
    expect(tagged).toHaveLength(2)
    expect(tagged.flatMap((v) => Object.keys(v.utm))).toContain('utm_id')
    expect(await reports.getVisits(30, false)).toHaveLength(3)
  })

  it('pruning keeps visits that ordered, and what is still fresh', async () => {
    await client.query(`UPDATE "ana_sessions" SET "started_at" = CURRENT_TIMESTAMP - INTERVAL '400 days', "last_seen_at" = CURRENT_TIMESTAMP - INTERVAL '400 days' WHERE "id" = ANY($1)`, [[first.sessionId, third.sessionId]])
    await client.query(`UPDATE "ana_pageviews" SET "viewed_at" = CURRENT_TIMESTAMP - INTERVAL '400 days' WHERE "session_id" = $1`, [first.sessionId])
    const result = await record.pruneOld(365)
    expect(result.pageViews).toBe(2)
    // first never ordered, so it goes; third did, so it stays, and so does second (recent).
    expect(result.sessions).toBe(1)
    expect(result.visitors).toBe(0)
    const left = await client.query(`SELECT "id" FROM "ana_sessions"`)
    expect(left.rows.map((r) => r.id).sort()).toEqual([second.sessionId, third.sessionId].sort())
  })
})
