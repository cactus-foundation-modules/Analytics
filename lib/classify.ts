// Turning "how did this visit arrive" into a channel, a source and a medium.
//
// Pure on purpose - no database, no request - so every rule below is covered by a
// plain unit test. The order of the rules is the whole design and is deliberate:
//
//   1. Tags the owner put on the link (utm_*) beat everything. They are the only
//      thing in this file that is a statement of intent rather than a guess.
//   2. An ad platform's click id (gclid, msclkid...) beats the referrer, because
//      auto-tagging is routinely switched on without anyone adding utm_* and the
//      referrer on such a click is often missing or is the ad network itself.
//   3. The referrer is the fallback: search engine, social network or, failing
//      both, "some other website".
//   4. No referrer at all is Direct.

export const CHANNELS = [
  'Paid Search',
  'Organic Search',
  'Paid Social',
  'Organic Social',
  'Email',
  'Affiliate',
  'Display',
  'Video',
  'Referral',
  'Other',
  'Direct',
] as const
export type Channel = (typeof CHANNELS)[number]

export type Attribution = {
  channel: Channel
  source: string
  medium: string
  campaign: string | null
  term: string | null
  content: string | null
  /** Every utm_* parameter on the landing address, keys lower-cased. */
  utm: Record<string, string>
  clickIdType: string | null
  /** Hostname of the referring page when there was an outside one. */
  referrerHost: string | null
}

export const DIRECT_SOURCE = '(direct)'
export const DIRECT_MEDIUM = '(none)'

const MAX_VALUE = 200
const MAX_UTM_KEYS = 20

/** Ad platforms' click ids, and what each one means. */
const CLICK_IDS: Array<{ param: string; source: string; medium: string; channel: Channel }> = [
  { param: 'gclid', source: 'google', medium: 'cpc', channel: 'Paid Search' },
  { param: 'gbraid', source: 'google', medium: 'cpc', channel: 'Paid Search' },
  { param: 'wbraid', source: 'google', medium: 'cpc', channel: 'Paid Search' },
  { param: 'dclid', source: 'google', medium: 'display', channel: 'Display' },
  { param: 'msclkid', source: 'bing', medium: 'cpc', channel: 'Paid Search' },
  { param: 'yclid', source: 'yandex', medium: 'cpc', channel: 'Paid Search' },
  { param: 'fbclid', source: 'facebook', medium: 'social', channel: 'Organic Social' },
  { param: 'ttclid', source: 'tiktok', medium: 'paid-social', channel: 'Paid Social' },
  { param: 'twclid', source: 'twitter', medium: 'paid-social', channel: 'Paid Social' },
  { param: 'li_fat_id', source: 'linkedin', medium: 'paid-social', channel: 'Paid Social' },
  { param: 'epik', source: 'pinterest', medium: 'paid-social', channel: 'Paid Social' },
]

/** Hostname fragments that name a search engine, mapped to a tidy source name. */
const SEARCH_ENGINES: Array<[RegExp, string]> = [
  [/(^|\.)google\./, 'google'],
  [/(^|\.)bing\.com$/, 'bing'],
  [/(^|\.)duckduckgo\.com$/, 'duckduckgo'],
  [/(^|\.)yahoo\./, 'yahoo'],
  [/(^|\.)ecosia\.org$/, 'ecosia'],
  [/(^|\.)baidu\.com$/, 'baidu'],
  [/(^|\.)yandex\./, 'yandex'],
  [/(^|\.)brave\.com$/, 'brave'],
  [/(^|\.)qwant\.com$/, 'qwant'],
  [/(^|\.)startpage\.com$/, 'startpage'],
  [/(^|\.)ask\.com$/, 'ask'],
  [/(^|\.)aol\./, 'aol'],
]

const SOCIAL_NETWORKS: Array<[RegExp, string]> = [
  [/(^|\.)(facebook|fb)\.com$|(^|\.)fb\.me$/, 'facebook'],
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)(twitter|x)\.com$|(^|\.)t\.co$/, 'twitter'],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'linkedin'],
  [/(^|\.)pinterest\./, 'pinterest'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)reddit\.com$/, 'reddit'],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, 'whatsapp'],
  [/(^|\.)(threads\.net|bsky\.app|mastodon\.[a-z]+)$/, 'social'],
]

/**
 * Where a shopper is sent to pay and then returned from. Landing back from one
 * of these is the same visit carrying on, not a new source, so it must never be
 * read as "a referral from stripe.com" and take the credit for an order.
 */
const PAYMENT_HOSTS =
  /(^|\.)(paypal\.com|paypal\.me|stripe\.com|checkout\.stripe\.com|worldpay\.com|worldfirst\.com|atoa\.me|atoa\.co\.uk|gocardless\.com|klarna\.com|clearpay\.co\.uk|sumup\.com|squareup\.com|square\.link|adyen\.com|sagepay\.com|opayo\.co\.uk|barclaycard\.co\.uk|3dsecure\.io|revolut\.com|trustly\.com|truelayer\.com|yapily\.com|apple\.com|pay\.google\.com)$/

const EMAIL_SOURCES = /^(email|e-mail|newsletter|mailchimp|brevo|sendinblue|klaviyo|mailerlite|campaign-monitor|constant-contact|hubspot)$/

function clean(value: string | null | undefined): string | null {
  const v = (value ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_VALUE)
  return v === '' ? null : v
}

/** Lower-case hostname without a leading "www.", or null when it is not a URL. */
export function hostOf(url: string | null | undefined): string | null {
  const raw = clean(url)
  if (!raw) return null
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '') || null
  } catch {
    return null
  }
}

/** The hostnames that mean "this site": the live one, plus any the owner listed. */
export function ownHostSet(siteUrl: string | null, extra: string): Set<string> {
  const hosts = new Set<string>()
  const add = (h: string | null) => {
    if (h) hosts.add(h.toLowerCase().replace(/^www\./, ''))
  }
  add(hostOf(siteUrl))
  for (const part of extra.split(/[\s,]+/)) {
    const trimmed = part.trim()
    if (!trimmed) continue
    add(hostOf(trimmed.includes('://') ? trimmed : `https://${trimmed}`))
  }
  return hosts
}

/** Every utm_* parameter in a query string, keys lower-cased, values trimmed. */
export function parseUtm(search: string): Record<string, string> {
  const out: Record<string, string> = {}
  let params: URLSearchParams
  try {
    params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  } catch {
    return out
  }
  for (const [key, value] of params) {
    const k = key.toLowerCase()
    if (!k.startsWith('utm_') || k.length > 40) continue
    const v = clean(value)
    if (!v) continue
    if (Object.keys(out).length >= MAX_UTM_KEYS && !(k in out)) continue
    // First one wins: a link tagged twice means the first tag was the owner's.
    if (!(k in out)) out[k] = v
  }
  return out
}

/** Which ad-platform click id, if any, is on the address. */
export function findClickId(search: string): (typeof CLICK_IDS)[number] | null {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  } catch {
    return null
  }
  for (const entry of CLICK_IDS) {
    if (params.has(entry.param)) return entry
  }
  return null
}

/** True when the address carries anything that says where the visitor came from. */
export function hasCampaignSignal(search: string): boolean {
  return Object.keys(parseUtm(search)).length > 0 || findClickId(search) !== null
}

function socialName(source: string): string | null {
  const s = source.toLowerCase()
  for (const [re, name] of SOCIAL_NETWORKS) {
    if (re.test(s) || re.test(`${s}.com`)) return name
  }
  return null
}

const SOURCE_ALIASES: Record<string, string> = {
  fb: 'facebook',
  ig: 'instagram',
  li: 'linkedin',
  yt: 'youtube',
  tw: 'twitter',
  x: 'twitter',
  'google.com': 'google',
  'bing.com': 'bing',
}

/** One spelling per source, so "Facebook", "fb" and "m.facebook.com" are one row. */
export function normaliseSource(raw: string): string {
  const s = raw.trim().toLowerCase()
  if (SOURCE_ALIASES[s]) return SOURCE_ALIASES[s]
  const host = s.replace(/^www\./, '')
  for (const [re, name] of SEARCH_ENGINES) if (re.test(host)) return name
  for (const [re, name] of SOCIAL_NETWORKS) if (re.test(host)) return name
  return host
}

function channelFromMedium(medium: string, source: string): Channel {
  const m = medium.toLowerCase()
  const social = socialName(source) !== null
  if (/^(cpc|ppc|paidsearch|paid-search|paid_search|paid search|sem|search-paid)$/.test(m)) {
    return social ? 'Paid Social' : 'Paid Search'
  }
  if (/paid[-_ ]?social|social[-_ ]?paid|^(cpv|paidsocial)$/.test(m)) return 'Paid Social'
  if (/^(social|social-network|social-media|sm|organic-social|organic_social)$/.test(m)) return 'Organic Social'
  if (/^(email|e-mail|e_mail|newsletter|mail)$/.test(m)) return 'Email'
  if (/^affiliate/.test(m)) return 'Affiliate'
  if (/^(display|banner|cpm|retargeting|remarketing|programmatic)$/.test(m)) return 'Display'
  if (/^(video|youtube-ads)$/.test(m)) return 'Video'
  if (/^organic/.test(m)) return 'Organic Search'
  if (/^referral$/.test(m)) return 'Referral'
  // A medium nobody recognises still gets reported - under its own name, in
  // the Other channel - rather than being thrown away or guessed at.
  return 'Other'
}

export type ClassifyInput = {
  /** The landing address's query string, with or without the leading "?". */
  search: string
  /** document.referrer, verbatim. */
  referrer: string | null | undefined
  ownHosts: Set<string>
}

/** How a visit arrived. Never throws; the worst case is Direct. */
export function classify(input: ClassifyInput): Attribution {
  const utm = parseUtm(input.search)
  const click = findClickId(input.search)
  const referrerHost = hostOf(input.referrer)
  const outsideHost =
    referrerHost && !input.ownHosts.has(referrerHost) && !PAYMENT_HOSTS.test(referrerHost) ? referrerHost : null

  const base = {
    campaign: clean(utm.utm_campaign),
    term: clean(utm.utm_term),
    content: clean(utm.utm_content),
    utm,
    referrerHost: outsideHost,
  }

  // 1. The owner's own tags.
  const taggedSource = clean(utm.utm_source)
  const taggedMedium = clean(utm.utm_medium)
  if (taggedSource || taggedMedium) {
    const source = taggedSource ? normaliseSource(taggedSource) : click?.source ?? outsideHost ?? DIRECT_SOURCE
    let medium = taggedMedium ? taggedMedium.toLowerCase() : click?.medium ?? null
    let channel: Channel
    if (medium) {
      channel = channelFromMedium(medium, source)
    } else if (EMAIL_SOURCES.test(source)) {
      medium = 'email'
      channel = 'Email'
    } else if (socialName(source)) {
      medium = 'social'
      channel = 'Organic Social'
    } else if (click) {
      medium = click.medium
      channel = click.channel
    } else {
      medium = DIRECT_MEDIUM
      channel = 'Other'
    }
    return { ...base, channel, source, medium, clickIdType: click?.param ?? null }
  }

  // 2. An ad platform's click id with no tags.
  if (click) {
    return {
      ...base,
      channel: click.channel,
      source: click.source,
      medium: click.medium,
      clickIdType: click.param,
    }
  }

  // 3. The referrer.
  if (outsideHost) {
    for (const [re, name] of SEARCH_ENGINES) {
      if (re.test(outsideHost)) {
        return { ...base, channel: 'Organic Search', source: name, medium: 'organic', clickIdType: null }
      }
    }
    for (const [re, name] of SOCIAL_NETWORKS) {
      if (re.test(outsideHost)) {
        return { ...base, channel: 'Organic Social', source: name, medium: 'social', clickIdType: null }
      }
    }
    return { ...base, channel: 'Referral', source: outsideHost, medium: 'referral', clickIdType: null }
  }

  // 4. Nothing to go on.
  return { ...base, channel: 'Direct', source: DIRECT_SOURCE, medium: DIRECT_MEDIUM, clickIdType: null }
}

/** One string that changes whenever the campaign does, to spot a new tagged click mid-visit. */
export function attributionSignature(a: Pick<Attribution, 'source' | 'medium' | 'campaign'>): string {
  return `${a.source}|${a.medium}|${a.campaign ?? ''}`
}

// ---------------------------------------------------------------------------
// The visitor's device, and the visitors who are not people.
// ---------------------------------------------------------------------------

const BOT_UA =
  /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|pingdom|uptime|monitor|curl\/|wget|python-requests|gtmetrix|bytespider|amazonbot|semrush|ahrefs|mj12|dotbot|petalbot|vercel|node-fetch|axios|go-http|java\/|okhttp|scrapy/i

export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua || ua.length < 10) return true
  return BOT_UA.test(ua)
}

export type Device = 'mobile' | 'tablet' | 'desktop'

export function deviceFrom(ua: string | null | undefined): Device {
  const s = ua ?? ''
  if (/ipad|tablet|(android(?!.*mobile))/i.test(s)) return 'tablet'
  if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(s)) return 'mobile'
  return 'desktop'
}

// ---------------------------------------------------------------------------
// Cleaning what a browser tells us. Everything from the request body is
// untrusted; these keep each field to a sensible shape and size.
// ---------------------------------------------------------------------------

export function cleanPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().slice(0, 500)
  if (!v.startsWith('/') || v.startsWith('//')) return null
  // The query string is carried separately and only for the landing page, so a
  // path stored against a page view never holds one (reset links, search terms).
  return v.split('?')[0]?.split('#')[0] || '/'
}

export function cleanTitle(value: unknown): string | null {
  return typeof value === 'string' ? clean(value) : null
}

export function cleanSearch(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.slice(0, 1500)
}

export function cleanReferrer(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().slice(0, 500)
  return /^https?:\/\//i.test(v) ? v : null
}

/** The landing address as stored: path plus a trimmed query string. */
export function landingUrl(path: string, search: string): string {
  const q = search.startsWith('?') ? search : search ? `?${search}` : ''
  return `${path}${q}`.slice(0, 2000)
}
