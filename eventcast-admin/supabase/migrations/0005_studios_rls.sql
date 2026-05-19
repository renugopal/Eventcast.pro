-- Enable RLS on studios and studio_members so they can be queried by authenticated users
ALTER TABLE studios ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio_members ENABLE ROW LEVEL SECURITY;

-- studio_members: a user can always read their own memberships
CREATE POLICY studio_members_select_own ON studio_members
  FOR SELECT
  USING (user_id = auth.uid());

-- studio_members: only an owner/admin can insert new members
CREATE POLICY studio_members_insert_policy ON studio_members
  FOR INSERT
  WITH CHECK (
    studio_id IN (
      SELECT studio_id FROM studio_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- studios: a user can read their own studio (where they are a member)
CREATE POLICY studios_select_policy ON studios
  FOR SELECT
  USING (
    id IN (
      SELECT studio_id FROM studio_members WHERE user_id = auth.uid()
    )
  );

-- studios: owner can update their own studio
CREATE POLICY studios_update_policy ON studios
  FOR UPDATE
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());
