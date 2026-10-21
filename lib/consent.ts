import type { NextRequest } from 'next/server'
import { ANALYTICS_CATEGORY, type ConsentGate } from '@/modules/analytics/lib/types'

// The server's half of the Analytics cookie category. The tracker already waits
// for a yes in the browser, but a gate that only lives in the browser is one
// request away from not existing, so the collect route checks again here.
//
// Core's cookie is only ever read, and only its `decision` map is looked at;
// anything unreadable counts as "no decision", which denies.

const CONSENT_COOKIE = 'cactus-consent'

export function readConsentDecision(request: NextRequest): Record<string, boolean> | null {
  const raw = request.cookies.get(CONSENT_COOKIE)?.value
  if (!raw) return null
  try {
    const payload = JSON.parse(decodeURIComponent(raw)) as { decision?: Record<string, boolean> } | null
    if (!payload || typeof payload !== 'object' || !payload.decision) return null
    return payload.decision
  } catch {
    return null
  }
}

export function mayRecord(request: NextRequest, gate: ConsentGate): boolean {
  if (gate === 'allowed') return true
  return readConsentDecision(request)?.[ANALYTICS_CATEGORY] === true
}

/** Do Not Track, or its successor Global Privacy Control, asked not to be counted. */
export function privacySignalSet(request: NextRequest): boolean {
  return request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1'
}
