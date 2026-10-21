-- Analytics module: who visited, where they came from, and (with a shop) which
-- visits ended in an order. Four tables and one settings row, all first-party:
-- nothing here is sent anywhere, and no IP address is stored.
-- All DDL is idempotent so run-module-migrations can safely re-apply it.

CREATE TABLE IF NOT EXISTS "ana_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    -- A browser that sends Do Not Track (or Global Privacy Control) is not counted.
    "respect_dnt" BOOLEAN NOT NULL DEFAULT true,
    -- Signed-in admins are not counted, so the owner clicking round their own
    -- site does not become the busiest "visitor" of the month.
    "exclude_admins" BOOLEAN NOT NULL DEFAULT true,
    -- How long page-by-page history is kept. Sessions and orders outlive it.
    "retention_days" INTEGER NOT NULL DEFAULT 730,
    -- Extra hostnames that count as this site (comma separated), so a visit
    -- arriving from the shop's other domain is not reported as a referral.
    "own_hosts" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ana_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ana_settings_singleton_check" CHECK ("id" = 'singleton')
);
INSERT INTO "ana_settings" ("id") VALUES ('singleton') ON CONFLICT DO NOTHING;

-- One row per browser (a first-party cookie, not a fingerprint). The first_*
-- columns freeze how this visitor first found the site, whatever they did after.
CREATE TABLE IF NOT EXISTS "ana_visitors" (
    "id" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "first_channel" TEXT NOT NULL DEFAULT 'Direct',
    "first_source" TEXT NOT NULL DEFAULT '(direct)',
    "first_medium" TEXT NOT NULL DEFAULT '(none)',
    "first_campaign" TEXT,
    "first_landing_path" TEXT,
    "device" TEXT,
    "country" TEXT,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "page_views" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ana_visitors_pkey" PRIMARY KEY ("id")
);

-- One row per visit. A visit ends after 30 quiet minutes, or when the visitor
-- arrives from a different tagged campaign. The attribution is worked out once,
-- on the first page of the visit, and never rewritten.
CREATE TABLE IF NOT EXISTS "ana_sessions" (
    "id" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "landing_path" TEXT NOT NULL,
    -- The landing address exactly as it arrived, query string and all, so every
    -- utm_* tag (and any other) can be read back later. Capped at 2000 characters.
    "landing_url" TEXT NOT NULL,
    "referrer" TEXT,
    "referrer_host" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'Direct',
    "source" TEXT NOT NULL DEFAULT '(direct)',
    "medium" TEXT NOT NULL DEFAULT '(none)',
    "campaign" TEXT,
    "term" TEXT,
    "content" TEXT,
    -- Every utm_* parameter that came with the landing, including the rarer ones
    -- (utm_id, utm_source_platform, utm_creative_format...).
    "utm" JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- gclid, msclkid, fbclid... when the visit came with an ad platform's click id.
    "click_id_type" TEXT,
    "device" TEXT,
    "country" TEXT,
    "page_views" INTEGER NOT NULL DEFAULT 0,
    "ordered" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ana_sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ana_sessions_started_at_idx" ON "ana_sessions" ("started_at");
CREATE INDEX IF NOT EXISTS "ana_sessions_visitor_idx" ON "ana_sessions" ("visitor_id", "started_at");

CREATE TABLE IF NOT EXISTS "ana_pageviews" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "session_id" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "title" TEXT,
    "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ana_pageviews_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ana_pageviews_session_idx" ON "ana_pageviews" ("session_id", "viewed_at");
CREATE INDEX IF NOT EXISTS "ana_pageviews_viewed_at_idx" ON "ana_pageviews" ("viewed_at");

-- An order the shop confirmed, joined to the visitor who placed it. order_id is
-- a plain value, not a foreign key: the shop is optional, and this module must
-- install and work with it absent. The customer's name and email are copied from
-- the order at the moment it is recorded, so this table reads on its own.
CREATE TABLE IF NOT EXISTS "ana_orders" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "order_number" TEXT NOT NULL,
    "order_id" TEXT,
    "visitor_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "customer_email" TEXT,
    "customer_name" TEXT,
    "total" NUMERIC(10,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "placed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Credit goes to the visitor's latest visit that was not simply typing the
    -- address in (falling back to the visit the order was placed in): somebody
    -- who clicked an advert on Monday and came back direct on Friday to pay still
    -- counts as an advert customer.
    "channel" TEXT NOT NULL DEFAULT 'Direct',
    "source" TEXT NOT NULL DEFAULT '(direct)',
    "medium" TEXT NOT NULL DEFAULT '(none)',
    "campaign" TEXT,
    -- And, separately, how this visitor first ever found the site.
    "first_channel" TEXT NOT NULL DEFAULT 'Direct',
    "first_source" TEXT NOT NULL DEFAULT '(direct)',
    "first_medium" TEXT NOT NULL DEFAULT '(none)',
    "first_campaign" TEXT,
    "landing_path" TEXT,
    "pages_viewed" INTEGER NOT NULL DEFAULT 0,
    "days_to_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ana_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ana_orders_order_number_key" UNIQUE ("order_number")
);
CREATE INDEX IF NOT EXISTS "ana_orders_placed_at_idx" ON "ana_orders" ("placed_at");
