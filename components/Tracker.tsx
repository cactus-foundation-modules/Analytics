'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { onConversion } from '@/lib/analytics/conversion'
import { CONSENT_CHANGE_EVENT } from '@/lib/consent/gate'
import { ANALYTICS_CATEGORY, type ConsentGate } from '@/modules/analytics/lib/types'

// The browser half of Analytics: report each page, and report an order when the
// shop announces one.
//
// Two copies of the block (header and footer) must not count a page twice, so
// every claim is made on `window` rather than in component state.

const ENDPOINT = '/api/m/analytics/collect'

type TrackerWindow = {
  __cactusConsent?: Record<string, boolean>
  /** The last path reported, so two copies and a re-render count it once. */
  __anaLastPath?: string
  /** Held by whichever copy is listening for orders. */
  __anaOrders?: boolean
  /** document.referrer belongs to the first page of the load only. */
  __anaReferrerSent?: boolean
  /** Reports are sent one after another: an order must follow the view that sets the cookies. */
  __anaQueue?: Promise<unknown>
  __anaPendingOrders?: string[]
  /** True once a page view has gone out, which is what puts the cookies in place. */
  __anaViewSent?: boolean
}

const w = () => window as unknown as TrackerWindow

function privacySignal(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string }
  return navigator.doNotTrack === '1' || nav.msDoNotTrack === '1' || nav.globalPrivacyControl === true
}

function allowed(gate: ConsentGate, respectDnt: boolean): boolean {
  if (respectDnt && privacySignal()) return false
  if (gate === 'allowed') return true
  return w().__cactusConsent?.[ANALYTICS_CATEGORY] === true
}

function send(body: Record<string, unknown>): void {
  const win = w()
  const post = () =>
    fetch(ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null)
  win.__anaQueue = (win.__anaQueue ?? Promise.resolve()).then(post, post)
}

export function Tracker({ gate, respectDnt }: { gate: ConsentGate; respectDnt: boolean }) {
  const pathname = usePathname()
  const gateRef = useRef({ gate, respectDnt })

  useEffect(() => {
    gateRef.current = { gate, respectDnt }
  }, [gate, respectDnt])

  const report = () => {
    const win = w()
    const { gate: g, respectDnt: r } = gateRef.current
    if (!allowed(g, r)) return
    const path = window.location.pathname
    if (win.__anaLastPath === path) return
    win.__anaLastPath = path
    // Only a full page load has a meaningful referrer; later navigations stay
    // inside the site, and the server treats a missing one as "same visit".
    const referrer = win.__anaReferrerSent ? '' : document.referrer
    win.__anaReferrerSent = true
    // Titles on client-side navigations update a moment after the route does.
    window.setTimeout(() => {
      send({ type: 'view', path, title: document.title, search: window.location.search, referrer })
      win.__anaViewSent = true
      const pending = win.__anaPendingOrders ?? []
      win.__anaPendingOrders = []
      for (const orderNumber of pending) send({ type: 'order', orderNumber })
    }, 250)
  }

  // Every route change, plus the first load.
  useEffect(() => {
    report()
  }, [pathname])

  // A yes given after the page loaded counts that page from then on.
  useEffect(() => {
    const onConsent = () => {
      w().__anaLastPath = undefined
      report()
    }
    window.addEventListener(CONSENT_CHANGE_EVENT, onConsent)
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, onConsent)
  }, [])

  // Orders, announced by the shop through core's conversion seam.
  useEffect(() => {
    const win = w()
    if (win.__anaOrders) return
    win.__anaOrders = true
    const unsubscribe = onConversion((c) => {
      if (c.type !== 'purchase' || !c.transactionId) return
      const { gate: g, respectDnt: r } = gateRef.current
      // An order only means something once a page view has set the visitor's
      // cookies, so until then (no yes yet, or the view is still on its short
      // timer) it is held and sent straight behind that view.
      if (allowed(g, r) && win.__anaViewSent) send({ type: 'order', orderNumber: c.transactionId })
      else (win.__anaPendingOrders ??= []).push(c.transactionId)
    })
    return () => {
      win.__anaOrders = false
      unsubscribe()
    }
  }, [])

  return null
}
