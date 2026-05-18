-- STEP 1: Enable RLS on all 4 tenant-scoped tables
ALTER TABLE events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE photographers ENABLE ROW LEVEL SECURITY;
ALTER TABLE wishes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_views    ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- STEP 2: RLS policies for the `events` table
-- ============================================================

CREATE POLICY events_select_policy ON events
  FOR SELECT
  USING (
    studio_id IN (
      SELECT studio_id FROM studio_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY events_insert_policy ON events
  FOR INSERT
  WITH CHECK (
    studio_id IN (
      SELECT studio_id FROM studio_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY events_update_policy ON events
  FOR UPDATE
  USING (
    studio_id IN (
      SELECT studio_id FROM studio_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    studio_id IN (
      SELECT studio_id FROM studio_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY events_delete_policy ON events
  FOR DELETE
  USING (
    studio_id IN (
      SELECT studio_id FROM studio_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- ============================================================
-- STEP 3: RLS policies for the `photographers` table
-- ============================================================

CREATE POLICY photographers_select_policy ON photographers
  FOR SELECT
  USING (
    studio_id IN (
      SELECT studio_id FROM studio_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY photographers_insert_policy ON photographers
  FOR INSERT
  WITH CHECK (
    studio_id IN (
      SELECT studio_id FROM studio_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY photographers_update_policy ON photographers
  FOR UPDATE
  USING (
    studio_id IN (
      SELECT studio_id FROM studio_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    studio_id IN (
      SELECT studio_id FROM studio_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY photographers_delete_policy ON photographers
  FOR DELETE
  USING (
    studio_id IN (
      SELECT studio_id FROM studio_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- ============================================================
-- STEP 4: RLS policies for the `page_views` table
-- ============================================================

-- Public insert: guests can record page views for any published event
CREATE POLICY page_views_insert_policy ON page_views
  FOR INSERT
  WITH CHECK (
    event_id IN (
      SELECT id FROM events WHERE studio_id IS NOT NULL
    )
  );

-- Studio members can read page views for their own studio's events
CREATE POLICY page_views_select_policy ON page_views
  FOR SELECT
  USING (
    studio_id IN (
      SELECT studio_id FROM studio_members WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- STEP 5: RLS policies for the `wishes` table
-- ============================================================

-- Public insert: guests can post wishes on any published event
CREATE POLICY wishes_insert_policy ON wishes
  FOR INSERT
  WITH CHECK (
    event_id IN (
      SELECT id FROM events WHERE studio_id IS NOT NULL
    )
  );

-- Public select: guests can read wishes on any published event
CREATE POLICY wishes_select_policy ON wishes
  FOR SELECT
  USING (
    event_id IN (
      SELECT id FROM events WHERE studio_id IS NOT NULL
    )
  );

-- Only studio owner/admin can delete wishes
CREATE POLICY wishes_delete_policy ON wishes
  FOR DELETE
  USING (
    studio_id IN (
      SELECT studio_id FROM studio_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );
