'use client'

import { useMemo, useState } from 'react'

// Builds a link carrying utm_* tags. Entirely in the browser: nothing here is
// saved, because the tags only mean anything once they are on a link somewhere.

const MEDIUMS = ['cpc', 'email', 'social', 'paid-social', 'affiliate', 'display', 'referral', 'organic']

type Fields = { url: string; source: string; medium: string; campaign: string; term: string; content: string }

const BLANK: Fields = { url: '', source: '', medium: '', campaign: '', term: '', content: '' }

const tidy = (v: string) => v.trim().toLowerCase().replace(/\s+/g, '-')

export function buildLink(f: Fields): { link: string | null; problem: string | null } {
  const base = f.url.trim()
  if (!base) return { link: null, problem: null }
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(base) ? base : `https://${base}`)
  } catch {
    return { link: null, problem: 'That does not look like a web address.' }
  }
  const tags: Array<[string, string]> = [
    ['utm_source', tidy(f.source)],
    ['utm_medium', tidy(f.medium)],
    ['utm_campaign', tidy(f.campaign)],
    ['utm_term', tidy(f.term)],
    ['utm_content', tidy(f.content)],
  ]
  for (const [k, v] of tags) {
    if (v) url.searchParams.set(k, v)
    else url.searchParams.delete(k)
  }
  if (!tidy(f.source) || !tidy(f.medium)) {
    return { link: url.toString(), problem: 'Source and medium are the two that matter - without both, the visit is hard to sort.' }
  }
  return { link: url.toString(), problem: null }
}

export default function LinkBuilder() {
  const [f, setF] = useState<Fields>(BLANK)
  const [copied, setCopied] = useState(false)
  const { link, problem } = useMemo(() => buildLink(f), [f])
  const set = (key: keyof Fields, value: string) => {
    setCopied(false)
    setF({ ...f, [key]: value })
  }

  return (
    <div className="card" style={{ maxWidth: '44rem' }}>
      <div className="card-title">Campaign link builder</div>
      <p className="field-hint" style={{ marginBottom: '1rem' }}>
        Put these tags on any link you share - an advert, a newsletter, a social post - and every visit that comes through
        it is filed under the names you choose. They are lower-cased and tidied so &ldquo;Spring Sale&rdquo; and
        &ldquo;spring-sale&rdquo; do not become two campaigns.
      </p>
      <div className="field">
        <label>Page to link to</label>
        <input type="text" value={f.url} placeholder="https://www.yoursite.co.uk/offers" onChange={(e) => set('url', e.target.value)} />
      </div>
      <div className="settings-cols">
        <div className="field">
          <label>Source <span className="field-hint">(who sent them)</span></label>
          <input type="text" value={f.source} placeholder="newsletter, google, facebook" onChange={(e) => set('source', e.target.value)} />
        </div>
        <div className="field">
          <label>Medium <span className="field-hint">(how)</span></label>
          <input type="text" list="ana-mediums" value={f.medium} placeholder="email, cpc, social" onChange={(e) => set('medium', e.target.value)} />
          <datalist id="ana-mediums">{MEDIUMS.map((m) => <option key={m} value={m} />)}</datalist>
        </div>
      </div>
      <div className="field">
        <label>Campaign <span className="field-hint">(which one)</span></label>
        <input type="text" value={f.campaign} placeholder="spring-sale" onChange={(e) => set('campaign', e.target.value)} />
      </div>
      <div className="settings-cols">
        <div className="field">
          <label>Term <span className="field-hint">(optional - the keyword)</span></label>
          <input type="text" value={f.term} onChange={(e) => set('term', e.target.value)} />
        </div>
        <div className="field">
          <label>Content <span className="field-hint">(optional - which advert or button)</span></label>
          <input type="text" value={f.content} onChange={(e) => set('content', e.target.value)} />
        </div>
      </div>
      {problem && <div className="alert alert-warning">{problem}</div>}
      {link && (
        <div className="field">
          <label>Your link</label>
          <textarea readOnly rows={3} value={link} onFocus={(e) => e.currentTarget.select()} />
          <div style={{ marginTop: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => { void navigator.clipboard?.writeText(link).then(() => setCopied(true)).catch(() => setCopied(false)) }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
