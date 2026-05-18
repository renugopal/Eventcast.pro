-- Create ENUMs for roles and plans
CREATE TYPE plan_tier_enum AS ENUM ('free_trial', 'pay_per_event', 'pro', 'agency');
CREATE TYPE member_role_enum AS ENUM ('owner', 'admin', 'member');

-- Create studios table
CREATE TABLE studios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  slug text UNIQUE NOT NULL,
  display_name text NOT NULL,
  custom_domain text UNIQUE,
  brand_logo_url text,
  brand_color_hex text,
  plan_tier plan_tier_enum DEFAULT 'free_trial' NOT NULL,
  custom_hostname_id text,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Create studio_members table for RBAC
CREATE TABLE studio_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid REFERENCES studios(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role member_role_enum DEFAULT 'admin' NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(studio_id, user_id)
);

-- Backfill default tenant for the existing admin user
DO $$
DECLARE
  v_user_id uuid;
  v_studio_id uuid;
BEGIN
  -- Grab the first created user (the current admin)
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at ASC LIMIT 1;
  
  IF v_user_id IS NOT NULL THEN
    -- Create the default 'eventcast' studio
    INSERT INTO studios (owner_user_id, slug, display_name, plan_tier)
    VALUES (v_user_id, 'eventcast', 'Eventcast Pro', 'agency')
    RETURNING id INTO v_studio_id;

    -- Add the user as an owner of this studio
    INSERT INTO studio_members (studio_id, user_id, role)
    VALUES (v_studio_id, v_user_id, 'owner');
  END IF;
END $$;
