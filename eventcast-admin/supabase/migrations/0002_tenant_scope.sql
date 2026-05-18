-- STEP 1: Add nullable studio_id column to the 4 tables
ALTER TABLE events       ADD COLUMN IF NOT EXISTS studio_id uuid REFERENCES studios(id) ON DELETE CASCADE;
ALTER TABLE photographers ADD COLUMN IF NOT EXISTS studio_id uuid REFERENCES studios(id) ON DELETE CASCADE;
ALTER TABLE wishes        ADD COLUMN IF NOT EXISTS studio_id uuid REFERENCES studios(id) ON DELETE CASCADE;
ALTER TABLE page_views    ADD COLUMN IF NOT EXISTS studio_id uuid REFERENCES studios(id) ON DELETE CASCADE;

-- STEP 2: Backfill existing rows with the 'eventcast' studio id
DO $$
DECLARE
  v_studio_id uuid;
BEGIN
  SELECT id INTO v_studio_id FROM studios WHERE slug = 'eventcast';

  UPDATE events        SET studio_id = v_studio_id WHERE studio_id IS NULL;
  UPDATE photographers SET studio_id = v_studio_id WHERE studio_id IS NULL;
  UPDATE wishes        SET studio_id = v_studio_id WHERE studio_id IS NULL;
  UPDATE page_views    SET studio_id = v_studio_id WHERE studio_id IS NULL;
END;
$$;

-- STEP 3: Make studio_id NOT NULL on all 4 tables
ALTER TABLE events        ALTER COLUMN studio_id SET NOT NULL;
ALTER TABLE photographers ALTER COLUMN studio_id SET NOT NULL;
ALTER TABLE wishes        ALTER COLUMN studio_id SET NOT NULL;
ALTER TABLE page_views    ALTER COLUMN studio_id SET NOT NULL;

-- STEP 4: Fix slug uniqueness for multi-tenancy
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_slug_key;
ALTER TABLE events ADD CONSTRAINT events_studio_id_slug_key UNIQUE (studio_id, slug);
