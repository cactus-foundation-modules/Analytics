'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { TabStrip } from '@/components/admin/TabStrip'
import { useTabParam } from '@/components/admin/useTabParam'
import { InfoTip } from '@/components/admin/InfoTip'
import { REPORT_DAYS, SOURCE_GROUPS } from '@/modules/analytics/lib/types'
import type {
  CampaignRow, LandingRow, OrderRow, Overview, SourceGroup, SourceRow, ViewedRow, VisitRow,
} from '@/modules/analytics/lib/types'
import LinkBuilder from './LinkBuilder'
import { downloadCsv, money, percent, when, whole } from './format'

const API = '/api/m/analytics/admin/report'

const TABS = ['overview', 'sources', 'campaigns', 'pages', 'orders', 'visits', 'links'] as const
type Tab = (typeof TABS)[number]
const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview',
  sources: 'Where from',
  campaigns: 'Campaigns',
  pages: 'Pages',
  orders: 'Orders',
  visits: 'Visits & links',
  links: 'Link builder',
}

const GROUP_LABELS: Record<SourceGroup, string> = {
  channel: 'Channel',
  source: 'Source',
  source_medium: 'Source / medium',
}

function useReport<T>(view: string, days: number, extra: Record<string, string> = {}) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const key = JSON.stringify(extra)

  const load = useCallback(async () => {
    setError('')
    try {
      const params = new URLSearchParams({ view, days: String(days), ...(JSON.parse(key) as Record<string, string>) })
      const res = await fetch(`${API}?${params}`)
      if (!res.ok) {
        setError('Could not load that report.')
        return
      }
      setData(await res.json() as T)
    } catch {
      setError('Could not reach the site.')
    }
  }, [view, days, key])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await Promise.resolve()
      if (!cancelled) await load()
    })()
    return () => { cancelled = true }
  }, [load])

  return { data, error }
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: ReactNode }) {
  return (
    <div className="card" style={{ flex: '1 1 9rem', minWidth: 0 }}>
      <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>{label}{hint}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.25rem' }}>{value}</div>
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p style={{ color: 'var(--color-text-muted)', padding: '1.5rem 0' }}>{children}</p>
}

function Chart({ data }: { data: Overview['daily'] }) {
  const max = Math.max(1, ...data.map((d) => d.sessions))
  return (
    <div role="img" aria-label="Visits per day" style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: '8rem' }}>
      {data.map((d) => (
        <div
          key={d.day}
          title={`${d.day}: ${d.sessions} ${d.sessions === 1 ? 'visit' : 'visits'}, ${d.orders} ${d.orders === 1 ? 'order' : 'orders'}`}
          style={{
            flex: '1 1 0', minWidth: 1,
            height: `${Math.max(2, (d.sessions / max) * 100)}%`,
            background: d.orders > 0 ? 'var(--color-primary)' : 'var(--color-border)',
            borderRadius: '2px 2px 0 0',
          }}
        />
      ))}
    </div>
  )
}

function OverviewTab({ days }: { days: number }) {
  const { data, error } = useReport<Overview>('overview', days)
  if (error) return <div className="alert alert-danger">{error}</div>
  if (!data) return <p className="field-hint">Loading…</p>
  const noData = data.sessions === 0

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
        <Stat label="Visitors" value={whole(data.visitors)} hint={<InfoTip>Different browsers seen in this period. Someone on a phone and a laptop counts twice.</InfoTip>} />
        <Stat label="New visitors" value={whole(data.newVisitors)} />
        <Stat label="Visits" value={whole(data.sessions)} hint={<InfoTip>A visit ends after 30 quiet minutes, or when the same person arrives from a different tagged link.</InfoTip>} />
        <Stat label="Page views" value={whole(data.pageViews)} />
        <Stat label="Orders" value={whole(data.orders)} />
        <Stat label="Order value" value={money(data.revenue, data.currency)} />
        <Stat label="Visits ending in an order" value={percent(data.orders, data.sessions)} />
      </div>
      {noData ? (
        <Empty>
          Nothing counted yet. Visits appear here once the Analytics block is on your header layout and visitors have
          agreed to the Analytics cookie. (Your own visits while signed in are left out on purpose.)
        </Empty>
      ) : (
        <>
          <div className="card" style={{ marginBottom: '1rem' }}>
            <div className="card-title">Visits per day <span className="field-hint">- darker days had an order</span></div>
            <Chart data={data.daily} />
          </div>
          <div className="card">
            <div className="card-title">Where visitors came from</div>
            <SourceTable rows={data.channels} label="Channel" />
          </div>
        </>
      )}
    </div>
  )
}

function SourceTable({ rows, label }: { rows: SourceRow[]; label: string }) {
  if (rows.length === 0) return <Empty>Nothing in this period.</Empty>
  const hasOrders = rows.some((r) => r.orders > 0 || r.firstTouchOrders > 0)
  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>{label}</th>
            <th style={{ textAlign: 'right' }}>Visits</th>
            <th style={{ textAlign: 'right' }}>Visitors</th>
            {hasOrders && (
              <>
                <th style={{ textAlign: 'right' }}>
                  Orders
                  <InfoTip>Credited to the latest way the customer arrived that was not simply typing the address - so an advert on Monday still gets the credit for an order paid for direct on Friday.</InfoTip>
                </th>
                <th style={{ textAlign: 'right' }}>Order value</th>
                <th style={{ textAlign: 'right' }}>
                  First found us
                  <InfoTip>Orders from customers whose very first visit, ever, was this one.</InfoTip>
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.key}</td>
              <td style={{ textAlign: 'right' }}>{whole(r.sessions)}</td>
              <td style={{ textAlign: 'right' }}>{whole(r.visitors)}</td>
              {hasOrders && (
                <>
                  <td style={{ textAlign: 'right' }}>{whole(r.orders)}</td>
                  <td style={{ textAlign: 'right' }}>{r.revenue ? money(r.revenue, 'GBP') : '-'}</td>
                  <td style={{ textAlign: 'right' }}>{whole(r.firstTouchOrders)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SourcesTab({ days }: { days: number }) {
  const [group, setGroup] = useState<SourceGroup>('channel')
  const { data, error } = useReport<{ rows: SourceRow[] }>('sources', days, { group })
  return (
    <div>
      <div className="field" style={{ maxWidth: '16rem' }}>
        <label>Group by</label>
        <select value={group} onChange={(e) => setGroup(e.target.value as SourceGroup)}>
          {SOURCE_GROUPS.map((g) => <option key={g} value={g}>{GROUP_LABELS[g]}</option>)}
        </select>
      </div>
      {error ? <div className="alert alert-danger">{error}</div> : !data ? <p className="field-hint">Loading…</p> : (
        <SourceTable rows={data.rows} label={GROUP_LABELS[group]} />
      )}
    </div>
  )
}

function CampaignsTab({ days }: { days: number }) {
  const { data, error } = useReport<{ rows: CampaignRow[] }>('campaigns', days)
  if (error) return <div className="alert alert-danger">{error}</div>
  if (!data) return <p className="field-hint">Loading…</p>
  if (data.rows.length === 0) {
    return <Empty>No tagged campaigns yet. Make a link on the Link builder tab, use it somewhere, and visits through it show up here under the campaign name.</Empty>
  }
  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Campaign</th><th>Source</th><th>Medium</th>
            <th style={{ textAlign: 'right' }}>Visits</th><th style={{ textAlign: 'right' }}>Visitors</th>
            <th style={{ textAlign: 'right' }}>Orders</th><th style={{ textAlign: 'right' }}>Order value</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={`${r.campaign}|${r.source}|${r.medium}`}>
              <td>{r.campaign}</td><td>{r.source}</td><td>{r.medium}</td>
              <td style={{ textAlign: 'right' }}>{whole(r.sessions)}</td>
              <td style={{ textAlign: 'right' }}>{whole(r.visitors)}</td>
              <td style={{ textAlign: 'right' }}>{whole(r.orders)}</td>
              <td style={{ textAlign: 'right' }}>{r.revenue ? money(r.revenue, 'GBP') : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PagesTab({ days }: { days: number }) {
  const { data, error } = useReport<{ landing: LandingRow[]; viewed: ViewedRow[] }>('pages', days)
  if (error) return <div className="alert alert-danger">{error}</div>
  if (!data) return <p className="field-hint">Loading…</p>
  if (data.landing.length === 0) return <Empty>Nothing in this period.</Empty>
  return (
    <div className="settings-cols">
      <div className="card">
        <div className="card-title">Where visits start</div>
        <div className="table-wrapper">
          <table>
            <thead><tr><th>Page</th><th style={{ textAlign: 'right' }}>Visits</th><th style={{ textAlign: 'right' }}>Orders</th></tr></thead>
            <tbody>
              {data.landing.map((r) => (
                <tr key={r.path}><td>{r.path}</td><td style={{ textAlign: 'right' }}>{whole(r.sessions)}</td><td style={{ textAlign: 'right' }}>{whole(r.orders)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <div className="card-title">Most viewed</div>
        <div className="table-wrapper">
          <table>
            <thead><tr><th>Page</th><th style={{ textAlign: 'right' }}>Views</th><th style={{ textAlign: 'right' }}>Visits</th></tr></thead>
            <tbody>
              {data.viewed.map((r) => (
                <tr key={r.path}><td>{r.path}</td><td style={{ textAlign: 'right' }}>{whole(r.views)}</td><td style={{ textAlign: 'right' }}>{whole(r.sessions)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function describe(source: string, medium: string, campaign: string | null): string {
  const base = source === '(direct)' ? 'Direct' : `${source} / ${medium}`
  return campaign ? `${base} - ${campaign}` : base
}

function OrdersTab({ days }: { days: number }) {
  const { data, error } = useReport<{ orders: OrderRow[]; shopOrders: number | null }>('orders', days)
  if (error) return <div className="alert alert-danger">{error}</div>
  if (!data) return <p className="field-hint">Loading…</p>
  const missing = data.shopOrders !== null ? Math.max(0, data.shopOrders - data.orders.length) : 0

  return (
    <div>
      {data.shopOrders !== null && (
        <p className="field-hint" style={{ marginBottom: '0.75rem' }}>
          {whole(data.orders.length)} of {whole(data.shopOrders)} paid or awaiting-payment {data.shopOrders === 1 ? 'order' : 'orders'} in this period could be
          linked to a visit.{missing > 0 && ' The rest came from visitors who did not accept the Analytics cookie, blocked it, or ordered some other way, so there is nothing to say about where they came from.'}
        </p>
      )}
      {data.orders.length === 0 ? (
        <Empty>No orders linked to a visit yet. This needs the Shop module, and only counts customers who accepted the Analytics cookie.</Empty>
      ) : (
        <>
          <div style={{ marginBottom: '0.75rem' }}>
            <button
              type="button"
              className="btn"
              onClick={() => downloadCsv(
                `analytics-orders-${days}d.csv`,
                ['Order', 'Placed', 'Customer', 'Email', 'Total', 'Currency', 'Came from', 'Channel', 'Campaign', 'First found us via', 'Landing page', 'Pages viewed', 'Days from first visit'],
                data.orders.map((o) => [
                  o.orderNumber, o.placedAt, o.customerName, o.customerEmail, o.total, o.currency,
                  describe(o.source, o.medium, null), o.channel, o.campaign,
                  describe(o.firstSource, o.firstMedium, o.firstCampaign), o.landingPath, o.pagesViewed, o.daysToOrder,
                ]),
              )}
            >
              Download CSV
            </button>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Order</th><th>Customer</th><th style={{ textAlign: 'right' }}>Total</th>
                  <th>Came from</th><th>First found us via</th><th>Landed on</th>
                  <th style={{ textAlign: 'right' }}>Pages</th><th style={{ textAlign: 'right' }}>Days</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o) => (
                  <tr key={o.orderNumber}>
                    <td>{o.orderNumber}<div className="field-hint">{when(o.placedAt)}</div></td>
                    <td>{o.customerName ?? '-'}<div className="field-hint">{o.customerEmail}</div></td>
                    <td style={{ textAlign: 'right' }}>{money(o.total, o.currency)}</td>
                    <td><span className="badge badge-info">{o.channel}</span><div className="field-hint">{describe(o.source, o.medium, o.campaign)}</div></td>
                    <td><span className="badge badge-gray">{o.firstChannel}</span><div className="field-hint">{describe(o.firstSource, o.firstMedium, o.firstCampaign)}</div></td>
                    <td>{o.landingPath ?? '-'}</td>
                    <td style={{ textAlign: 'right' }}>{o.pagesViewed}</td>
                    <td style={{ textAlign: 'right' }}>{o.daysToOrder}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function VisitsTab({ days }: { days: number }) {
  const [tagged, setTagged] = useState(true)
  const { data, error } = useReport<{ rows: VisitRow[] }>('visits', days, { tagged: tagged ? '1' : '0' })
  return (
    <div>
      <div className="field">
        <label className="settings-check">
          <input type="checkbox" checked={tagged} onChange={(e) => setTagged(e.target.checked)} />
          <span>Only visits that arrived on a tagged link or an ad click</span>
        </label>
      </div>
      {error ? <div className="alert alert-danger">{error}</div> : !data ? <p className="field-hint">Loading…</p> : data.rows.length === 0 ? (
        <Empty>{tagged ? 'No tagged visits in this period.' : 'No visits in this period.'}</Empty>
      ) : (
        <>
          <div style={{ marginBottom: '0.75rem' }}>
            <button
              type="button"
              className="btn"
              onClick={() => downloadCsv(
                `analytics-visits-${days}d.csv`,
                ['Started', 'Landing address', 'Referrer', 'Channel', 'Source', 'Medium', 'Campaign', 'All utm tags', 'Click id', 'Device', 'Country', 'Pages', 'Ordered'],
                data.rows.map((v) => [
                  v.startedAt, v.landingUrl, v.referrer, v.channel, v.source, v.medium, v.campaign,
                  Object.entries(v.utm).map(([k, val]) => `${k}=${val}`).join('&'),
                  v.clickIdType, v.device, v.country, v.pageViews, v.ordered ? 'yes' : 'no',
                ]),
              )}
            >
              Download CSV
            </button>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr><th>When</th><th>Landing address</th><th>Came from</th><th>Tags</th><th style={{ textAlign: 'right' }}>Pages</th><th>Ordered</th></tr>
              </thead>
              <tbody>
                {data.rows.map((v) => (
                  <tr key={v.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{when(v.startedAt)}<div className="field-hint">{[v.device, v.country].filter(Boolean).join(' · ')}</div></td>
                    <td style={{ wordBreak: 'break-all', maxWidth: '24rem' }}>{v.landingUrl}</td>
                    <td><span className="badge badge-info">{v.channel}</span><div className="field-hint">{describe(v.source, v.medium, v.campaign)}</div></td>
                    <td className="field-hint" style={{ wordBreak: 'break-all' }}>
                      {Object.entries(v.utm).map(([k, val]) => <div key={k}>{k}={val}</div>)}
                      {v.clickIdType && <div>{v.clickIdType}</div>}
                    </td>
                    <td style={{ textAlign: 'right' }}>{v.pageViews}</td>
                    <td>{v.ordered ? <span className="badge badge-success">Yes</span> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

export default function AnalyticsScreen() {
  const [tab, setTab] = useTabParam<Tab>('tab', 'overview', TABS)
  const [days, setDays] = useState<number>(30)

  return (
    <div>
      <TabStrip
        items={TABS.map((t) => ({ key: t, label: TAB_LABELS[t], active: tab === t, onClick: () => setTab(t) }))}
        trailing={tab === 'links' ? undefined : (
          <select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {REPORT_DAYS.map((d) => <option key={d} value={d}>{d === 365 ? 'Last year' : `Last ${d} days`}</option>)}
          </select>
        )}
      />
      <div style={{ marginTop: '1rem' }}>
        {tab === 'overview' && <OverviewTab days={days} />}
        {tab === 'sources' && <SourcesTab days={days} />}
        {tab === 'campaigns' && <CampaignsTab days={days} />}
        {tab === 'pages' && <PagesTab days={days} />}
        {tab === 'orders' && <OrdersTab days={days} />}
        {tab === 'visits' && <VisitsTab days={days} />}
        {tab === 'links' && <LinkBuilder />}
      </div>
    </div>
  )
}
