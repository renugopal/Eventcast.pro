-- Migration 0012: Add country column to page_views for geo-location analytics
-- Stores ISO 3166-1 alpha-2 country code resolved at the Cloudflare edge
-- e.g. 'IN' (India), 'US' (United States), 'GB' (United Kingdom)

ALTER TABLE page_views
  ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'Unknown';

-- Index for fast aggregation queries on the analytics dashboard
CREATE INDEX IF NOT EXISTS idx_page_views_country
  ON page_views (country);

COMMENT ON COLUMN page_views.country IS
  'ISO 3166-1 alpha-2 country code resolved at the Cloudflare edge via CF-IPCountry header';
