-- ============================================================
-- Supabase RPC: get_event_view_counts
-- Performance fix for fetchAnalytics() — replaces the pattern
-- of fetching up to 10,000 raw page_views rows client-side.
--
-- Run this SQL once in your Supabase SQL Editor:
--   Dashboard → SQL Editor → New Query → paste & run
-- ============================================================

CREATE OR REPLACE FUNCTION get_event_view_counts()
RETURNS TABLE(event_id UUID, view_count BIGINT)
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT event_id, COUNT(*)::BIGINT AS view_count
  FROM page_views
  GROUP BY event_id;
$$;

-- Grant access to the anon and authenticated roles so the
-- Supabase client (both admin dashboard and public portal) can call it.
GRANT EXECUTE ON FUNCTION get_event_view_counts() TO anon, authenticated;
