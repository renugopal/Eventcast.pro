-- Auto-fill studio_id on public wishes inserts (guest landing pages omit studio_id)
--
-- Unconditional by design (unlike the analogous set_page_view_studio_id in
-- 0017_page_views_auto_studio.sql, which only fills a NULL studio_id): the
-- Wishes insert path is reachable from an unauthenticated public guest
-- landing page, so any caller-supplied studio_id must be treated as
-- untrusted input, not merely a default to fall back on. This trigger
-- always re-derives studio_id from the event's own row whenever event_id
-- is present, so a guest client can never cause a wish to be attributed to
-- a studio other than the one that actually owns the target event. Do not
-- add a "NEW.studio_id IS NULL AND" guard here.
CREATE OR REPLACE FUNCTION set_wish_studio_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.event_id IS NOT NULL THEN
    SELECT studio_id INTO NEW.studio_id FROM events WHERE id = NEW.event_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wishes_set_studio_id ON wishes;
CREATE TRIGGER wishes_set_studio_id
  BEFORE INSERT ON wishes
  FOR EACH ROW
  EXECUTE FUNCTION set_wish_studio_id();
