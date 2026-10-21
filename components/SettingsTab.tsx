'use client'

import { useCallback, useEffect, useState } from 'react'
import { SettingsHeaderActions, SettingsHeaderStatus } from '@/components/admin/SettingsHeaderActions'
import { InfoTip } from '@/components/admin/InfoTip'
import { RETENTION_MAX_DAYS, RETENTION_MIN_DAYS } from '@/modules/analytics/lib/types'

const API_BASE = '/api/m/analytics'

type Banner = { bannerEnabled: boolean; hasAnalyticsCategory: boolean }

type Settings = {
  enabled: boolean
  respectDnt: boolean
  excludeAdmins: boolean
  retentionDays: number
  ownHosts: string
  banner: Banner
  adminPath: string
}

type Draft = Omit<Settings, 'banner' | 'adminPath'>

const draftOf = (s: Settings): Draft => ({
  enabled: s.enabled,
  respectDnt: s.respectDnt,
  excludeAdmins: s.excludeAdmins,
  retentionDays: s.retentionDays,
  ownHosts: s.ownHosts,
})

function advice(saved: Settings): Array<{ tone: 'danger' | 'info'; text: string }> {
  if (!saved.enabled) return []
  const { bannerEnabled, hasAnalyticsCategory } = saved.banner
  if (!bannerEnabled) {
    return [{
      tone: 'danger',
      text: 'Your cookie banner is switched off, so nobody is asked anything and every visitor is counted. That is yours to decide, but in the UK and the EU it is the sort of decision that wants deliberating over rather than drifting into.',
    }]
  }
  if (!hasAnalyticsCategory) {
    return [{
      tone: 'danger',
      text: 'Your cookie banner asks about cookies but has no Analytics switch on it, so there is nothing for a visitor to agree to and every one of them is counted regardless. Add the Analytics category on Settings > General > GDPR & Legal - the module offers it as a one-click suggestion there.',
    }]
  }
  return [{
    tone: 'info',
    text: 'Nobody is counted until they agree to the Analytics cookie on your banner, and a visitor who changes their mind is forgotten straight away.',
  }]
}

export function AnalyticsSettingsTab() {
  const [saved, setSaved] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/settings`)
      if (!res.ok) return
      const s = await res.json() as Settings
      setSaved(s)
      setDraft(draftOf(s))
    } catch { /* retry on next open */ }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await Promise.resolve()
      if (!cancelled) await load()
    })()
    return () => { cancelled = true }
  }, [load])

  const save = useCallback(async () => {
    if (!draft) return
    setBusy(true)
    setMsg('')
    setErr('')
    try {
      const res = await fetch(`${API_BASE}/admin/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const body = await res.json().catch(() => null) as (Settings & { error?: string }) | null
      if (!res.ok) {
        setErr(body?.error ?? 'Could not save those settings.')
        return
      }
      if (body) {
        setSaved(body)
        setDraft(draftOf(body))
      }
      setMsg('Saved.')
    } catch {
      setErr('Could not reach the site to save those settings.')
    } finally {
      setBusy(false)
    }
  }, [draft])

  if (!saved || !draft) return <p className="field-hint">Loading…</p>
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value })

  return (
    <div>
      <p className="field-hint" style={{ marginBottom: '1rem' }}>
        Counts visits to your site, where each one came from (including every <code>utm_</code> tag), and which visits
        ended in an order. Everything stays on your own site. It needs the <strong>Analytics</strong> block on your header
        layout, where it shows nothing - it just does the counting.
      </p>

      {advice(saved).map((note, i) => (
        <div key={i} className={`alert alert-${note.tone}`}>
          {note.text}
          {note.tone === 'danger' && (
            <>{' '}<a href={`/${saved.adminPath}/config?tab=gdpr#gdpr-banner`}>Open GDPR &amp; Legal</a>.</>
          )}
        </div>
      ))}

      <SettingsHeaderActions>
        <SettingsHeaderStatus message={msg} error={err} />
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </SettingsHeaderActions>

      <div className="settings-cols">
        <div className="card">
          <div className="card-title">Counting</div>
          <div className="field field--beside-input">
            <label className="settings-check">
              <input type="checkbox" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} />
              <span>Count visitors</span>
            </label>
          </div>
          <div className="field">
            <label className="settings-check">
              <input type="checkbox" checked={draft.respectDnt} onChange={(e) => set('respectDnt', e.target.checked)} />
              <span>Leave out browsers that ask not to be tracked</span>
              <InfoTip>Honours Do Not Track and Global Privacy Control. On is the polite setting, and costs you a few per cent of visitors.</InfoTip>
            </label>
          </div>
          <div className="field">
            <label className="settings-check">
              <input type="checkbox" checked={draft.excludeAdmins} onChange={(e) => set('excludeAdmins', e.target.checked)} />
              <span>Leave out anyone signed in to the admin</span>
              <InfoTip>Otherwise you, clicking round your own site, become its most loyal visitor.</InfoTip>
            </label>
          </div>
        </div>
        <div className="card">
          <div className="card-title">Housekeeping</div>
          <div className="field">
            <label>
              Keep page-by-page history for (days)
              <InfoTip>Visits and orders are kept after this; only the list of individual pages each visit looked at is cleared. Visits that never led to an order are cleared with it.</InfoTip>
            </label>
            <input
              type="number"
              min={RETENTION_MIN_DAYS}
              max={RETENTION_MAX_DAYS}
              value={draft.retentionDays}
              onChange={(e) => set('retentionDays', Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label>
              Other addresses that are this site
              <InfoTip>Hostnames, separated by commas. A visit arriving from one of these is the same visit carrying on, not a referral. Your main address is always included.</InfoTip>
            </label>
            <input type="text" value={draft.ownHosts} placeholder="shop.example.com, example.org" onChange={(e) => set('ownHosts', e.target.value)} />
          </div>
        </div>
      </div>
    </div>
  )
}
