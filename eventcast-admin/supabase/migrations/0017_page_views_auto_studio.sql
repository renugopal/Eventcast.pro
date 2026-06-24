-- Auto-fill studio_id on public page_views inserts (guest landing pages omit studio_id)
CREATE OR REPLACE FUNCTION set_page_view_studio_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.studio_id IS NULL AND NEW.event_id IS NOT NULL THEN
    SELECT studio_id INTO NEW.studio_id FROM events WHERE id = NEW.event_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS page_views_set_studio_id ON page_views;
CREATE TRIGGER page_views_set_studio_id
  BEFORE INSERT ON page_views
  FOR EACH ROW
  EXECUTE FUNCTION set_page_view_studio_id();
