<p align="center">
  <img src="module-art.webp" alt="Analytics" width="640" />
</p>

# Analytics

Shows who visits a Cactus site and where they came from - search, adverts, email,
social, other websites, and every `utm_` tag on every link - and, when the Shop
module is installed, which visits ended in an order and who placed it.

Everything is counted on the site's own database. Nothing is sent anywhere, and no
IP address is stored.

## What it does

- Counts visitors, visits and page views, behind the site's cookie banner (the
  `analytics` category), Do Not Track and Global Privacy Control.
- Files each visit under a **channel** (Paid Search, Organic Search, Paid Social,
  Organic Social, Email, Affiliate, Display, Video, Referral, Other, Direct), a
  source and a medium. Owner tags win, then ad click ids (`gclid`, `msclkid`,
  `fbclid`...), then the referring website.
- Keeps the **whole landing address** of every visit and **every `utm_*`
  parameter** on it, including the rare ones (`utm_id`, `utm_source_platform`...).
- With the Shop: records each order against the visitor, with the customer's name,
  email and total, the visit that gets the credit (their latest one that was not
  just typing the address in), how they first ever found the site, and how many
  days it took.
- A **link builder** for tagging campaign links, and CSV downloads of orders and
  tagged visits.

## How it is wired

The module never talks to the shop and the shop never talks to the module. The
shop announces a completed order through core's conversion seam
(`lib/analytics/conversion.ts`); this module listens with `onConversion()`, then
reads the order itself from the shop's table - the total and customer come from the
shop, never from the browser. A site with no shop still counts visits.

An `Analytics` placement block on the header layout (placed automatically on
install) loads the tracker.

## Where things are

- Sidebar: **Analytics** (Overview, Where from, Campaigns, Pages, Orders, Visits &
  links, Link builder).
- Settings > General > **Analytics**: on/off, privacy signals, excluding admins,
  retention, extra own hostnames.

## Tables

`ana_settings`, `ana_visitors`, `ana_sessions`, `ana_pageviews`, `ana_orders`.
A nightly job clears page-by-page history past the retention period.

## Tests

`npx vitest run modules/analytics` runs the pure classification tests. The SQL is
exercised against a real Postgres by `lib/sql.live.test.ts`
(`RUN_ANALYTICS_SQL=1`, needs the OVH test server like the other live suites).
