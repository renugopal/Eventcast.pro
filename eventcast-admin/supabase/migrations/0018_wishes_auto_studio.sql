-- Auto-fill studio_id on public wishes inserts (guest landing pages omit studio_id)
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
