import { describe, it, expect } from 'vitest'
import {
  classify,
  deviceFrom,
  hasCampaignSignal,
  hostOf,
  isBotUserAgent,
  normaliseSource,
  ownHostSet,
  parseUtm,
  cleanPath,
} from './classify'

const own = ownHostSet('https://www.example.co.uk', 'shop.example.com, example.org')
const run = (search: string, referrer: string | null = null) => classify({ search, referrer, ownHosts: own })

describe('ownHostSet', () => {
  it('strips www and merges the listed hosts', () => {
    expect([...own].sort()).toEqual(['example.co.uk', 'example.org', 'shop.example.com'])
  })
})

describe('parseUtm', () => {
  it('keeps every utm_* parameter, lower-cased, and nothing else', () => {
    expect(parseUtm('?UTM_Source=News&utm_medium=email&utm_id=42&page=2&utm_source_platform=brevo')).toEqual({
      utm_source: 'News',
      utm_medium: 'email',
      utm_id: '42',
      utm_source_platform: 'brevo',
    })
  })
  it('takes the first of a repeated tag and ignores empties', () => {
    expect(parseUtm('utm_source=a&utm_source=b&utm_term=')).toEqual({ utm_source: 'a' })
  })
})

describe('classify - owner tags', () => {
  it('google cpc is paid search', () => {
    const a = run('?utm_source=Google&utm_medium=cpc&utm_campaign=Spring%20Sale&utm_term=desk&utm_content=ad1')
    expect(a).toMatchObject({ channel: 'Paid Search', source: 'google', medium: 'cpc', campaign: 'Spring Sale', term: 'desk', content: 'ad1' })
  })
  it('facebook with cpc is paid social, not paid search', () => {
    expect(run('?utm_source=facebook&utm_medium=cpc').channel).toBe('Paid Social')
  })
  it('newsletter source with no medium is email', () => {
    expect(run('?utm_source=newsletter&utm_campaign=oct')).toMatchObject({ channel: 'Email', medium: 'email' })
  })
  it('an unrecognised medium is kept, under Other', () => {
    expect(run('?utm_source=podcast&utm_medium=audio')).toMatchObject({ channel: 'Other', source: 'podcast', medium: 'audio' })
  })
  it('tags beat the referrer', () => {
    expect(run('?utm_source=news&utm_medium=email', 'https://www.google.com/').channel).toBe('Email')
  })
  it('a campaign alone rides along on whatever the referrer says', () => {
    expect(run('?utm_campaign=launch', 'https://www.bing.com/')).toMatchObject({ campaign: 'launch', channel: 'Organic Search', source: 'bing' })
  })
})

describe('classify - click ids', () => {
  it('gclid is google ads', () => {
    expect(run('?gclid=abc')).toMatchObject({ channel: 'Paid Search', source: 'google', medium: 'cpc', clickIdType: 'gclid' })
  })
  it('msclkid is bing ads', () => {
    expect(run('?msclkid=abc')).toMatchObject({ channel: 'Paid Search', source: 'bing' })
  })
  it('fbclid alone is facebook social', () => {
    expect(run('?fbclid=abc')).toMatchObject({ channel: 'Organic Social', source: 'facebook' })
  })
})

describe('classify - referrer', () => {
  it('a search engine is organic search', () => {
    expect(run('', 'https://www.google.co.uk/')).toMatchObject({ channel: 'Organic Search', source: 'google', medium: 'organic' })
  })
  it('a social network is organic social', () => {
    expect(run('', 'https://l.facebook.com/l.php?u=x')).toMatchObject({ channel: 'Organic Social', source: 'facebook' })
    expect(run('', 'https://t.co/abc')).toMatchObject({ source: 'twitter' })
  })
  it('any other site is a referral, named by its host', () => {
    expect(run('', 'https://www.blog.example.net/post')).toMatchObject({ channel: 'Referral', source: 'blog.example.net', medium: 'referral', referrerHost: 'blog.example.net' })
  })
  it('no referrer is direct', () => {
    expect(run('')).toMatchObject({ channel: 'Direct', source: '(direct)', medium: '(none)' })
  })
  it('our own site, in any listed spelling, is direct', () => {
    expect(run('', 'https://www.example.co.uk/basket').channel).toBe('Direct')
    expect(run('', 'https://shop.example.com/').channel).toBe('Direct')
  })
  it('a payment page is not a source', () => {
    expect(run('', 'https://checkout.stripe.com/pay/x').channel).toBe('Direct')
    expect(run('', 'https://www.paypal.com/checkoutnow').channel).toBe('Direct')
  })
  it('garbage never throws', () => {
    expect(run('%%%', 'not a url').channel).toBe('Direct')
  })
})

describe('helpers', () => {
  it('normaliseSource folds spellings together', () => {
    expect(normaliseSource('FB')).toBe('facebook')
    expect(normaliseSource('m.facebook.com')).toBe('facebook')
    expect(normaliseSource('www.google.com')).toBe('google')
  })
  it('hostOf', () => {
    expect(hostOf('https://WWW.Example.com/a')).toBe('example.com')
    expect(hostOf('nope')).toBeNull()
  })
  it('hasCampaignSignal', () => {
    expect(hasCampaignSignal('?utm_source=a')).toBe(true)
    expect(hasCampaignSignal('?gclid=1')).toBe(true)
    expect(hasCampaignSignal('?page=2')).toBe(false)
  })
  it('bots and devices', () => {
    expect(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true)
    expect(isBotUserAgent(null)).toBe(true)
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
    expect(isBotUserAgent(iphone)).toBe(false)
    expect(deviceFrom(iphone)).toBe('mobile')
    expect(deviceFrom('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('tablet')
    expect(deviceFrom('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120')).toBe('desktop')
  })
  it('cleanPath refuses anything that is not a local path and drops queries', () => {
    expect(cleanPath('//evil.com')).toBeNull()
    expect(cleanPath('https://x.com')).toBeNull()
    expect(cleanPath('/a/b?token=1#x')).toBe('/a/b')
  })
})
