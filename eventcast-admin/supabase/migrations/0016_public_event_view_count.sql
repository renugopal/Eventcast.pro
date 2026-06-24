-- Public page-view count for event landing pages (anon-safe, single event)
CREATE OR REPLACE FUNCTION get_public_event_view_count(p_event_id UUID)
RETURNS BIGINT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::BIGINT FROM page_views WHERE event_id = p_event_id;
$$;

GRANT EXECUTE ON FUNCTION get_public_event_view_count(UUID) TO anon, authenticated;
