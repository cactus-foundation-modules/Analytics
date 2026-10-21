// POST /api/m/analytics/collect - the browser reporting a page view or an order.
import { NextRequest, NextResponse } from 'next/server'
import { getSiteUrlOrNull } from '@/lib/config/env'
import { getSessionFromCookie } from '@/lib/auth/session'
import { errorResponse } from '@/lib/utils'
import {
  cleanPath,
  cleanReferrer,
  cleanSearch,
  cleanTitle,
  deviceFrom,
  isBotUserAgent,
  ownHostSet,
} from '@/modules/analytics/lib/classify'
import { mayRecord, privacySignalSet } from '@/modules/analytics/lib/consent'
import { recordOrder, recordView, validId } from '@/modules/analytics/lib/record'
import { gateFromBanner, getAnalyticsSettings, getBannerState } from '@/modules/analytics/lib/settings'
import { SESSION_COOKIE, SESSION_MINUTES, VISITOR_COOKIE, VISITOR_COOKIE_DAYS } from '@/modules/analytics/lib/types'

const MAX_BODY_BYTES = 4 * 1024
const noStore = { 'Cache-Control': 'no-store' }

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  }
}

/** Somebody who said no, or withdrew a yes, keeps none of our cookies. */
function declined(request: NextRequest, reason: string) {
  const res = NextResponse.json({ tracking: false, reason }, { headers: noStore })
  if (request.cookies.has(VISITOR_COOKIE)) res.cookies.set(VISITOR_COOKIE, '', cookieOptions(0))
  if (request.cookies.has(SESSION_COOKIE)) res.cookies.set(SESSION_COOKIE, '', cookieOptions(0))
  return res
}

export async function POST(request: NextRequest) {
  const settings = await getAnalyticsSettings()
  if (!settings.enabled) return NextResponse.json({ tracking: false, reason: 'off' }, { headers: noStore })

  const gate = gateFromBanner(await getBannerState())
  if (!mayRecord(request, gate)) return declined(request, 'consent')
  if (settings.respectDnt && privacySignalSet(request)) return declined(request, 'privacy-signal')

  const userAgent = request.headers.get('user-agent')
  if (isBotUserAgent(userAgent)) return NextResponse.json({ tracking: false, reason: 'bot' }, { headers: noStore })

  // The owner clicking round their own site is not a visitor. Only look the
  // session up when the cookie exists, so an ordinary visitor costs nothing.
  if (settings.excludeAdmins && request.cookies.has('cactus_session')) {
    const admin = await getSessionFromCookie().catch(() => null)
    if (admin) return NextResponse.json({ tracking: false, reason: 'admin' }, { headers: noStore })
  }

  const text = await request.text().catch(() => '')
  if (text.length > MAX_BODY_BYTES) return errorResponse('That is rather a lot.', 413)
  let input: Record<string, unknown>
  try {
    input = JSON.parse(text || '{}') as Record<string, unknown>
  } catch {
    return errorResponse('That could not be read.', 400)
  }

  const visitorId = validId(request.cookies.get(VISITOR_COOKIE)?.value)
  const sessionId = validId(request.cookies.get(SESSION_COOKIE)?.value)

  let identity: { visitorId: string; sessionId: string } | null = null

  if (input.type === 'order') {
    const orderNumber = typeof input.orderNumber === 'string' ? input.orderNumber.trim().slice(0, 60) : ''
    if (!orderNumber || !visitorId || !sessionId) return NextResponse.json({ tracking: true, recorded: false }, { headers: noStore })
    const outcome = await recordOrder({ visitorId, sessionId }, orderNumber).catch(() => 'ignored' as const)
    return NextResponse.json({ tracking: true, recorded: outcome === 'recorded' }, { headers: noStore })
  }

  const path = cleanPath(input.path)
  if (!path) return errorResponse('That page could not be read.', 400)

  const country = (request.headers.get('x-vercel-ip-country') ?? request.headers.get('cf-ipcountry') ?? '').toUpperCase()
  identity = await recordView({
    visitorId,
    sessionId,
    path,
    title: cleanTitle(input.title),
    search: cleanSearch(input.search),
    referrer: cleanReferrer(input.referrer),
    device: deviceFrom(userAgent),
    country: /^[A-Z]{2}$/.test(country) ? country : null,
    ownHosts: ownHostSet(getSiteUrlOrNull(), settings.ownHosts),
  })

  const res = NextResponse.json({ tracking: true }, { headers: noStore })
  res.cookies.set(VISITOR_COOKIE, identity.visitorId, cookieOptions(VISITOR_COOKIE_DAYS * 86400))
  res.cookies.set(SESSION_COOKIE, identity.sessionId, cookieOptions(SESSION_MINUTES * 60))
  return res
}
