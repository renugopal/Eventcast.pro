-- Create studio_domains table
CREATE TABLE IF NOT EXISTS studio_domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
    domain TEXT UNIQUE NOT NULL,
    ssl_status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'active', 'failed'
    dns_status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'active', 'failed'
    cloudflare_hostname_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE studio_domains ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS studio_domains_select_policy ON studio_domains;
DROP POLICY IF EXISTS studio_domains_modify_policy ON studio_domains;

-- Select policy: Studio members can view their studio's domains
CREATE POLICY studio_domains_select_policy ON studio_domains
    FOR SELECT USING (
        studio_id IN (SELECT studio_id FROM studio_members WHERE user_id = auth.uid())
    );

-- Insert/Delete/Update policy: Studio owners can manage custom domains
CREATE POLICY studio_domains_modify_policy ON studio_domains
    FOR ALL USING (
        studio_id IN (
            SELECT studio_id FROM studio_members 
            WHERE user_id = auth.uid() AND role = 'owner'
        )
    );
