-- Migration 0010: API Rate Limiting Infrastructure
-- This migration creates the rate_limits table and check_rate_limit RPC function
-- to protect public API endpoints like the AI Sales Bot from abuse.

CREATE TABLE IF NOT EXISTS public.rate_limits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Index for fast queries on ip_hash, endpoint, and time
CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_endpoint_time 
ON public.rate_limits (ip_hash, endpoint, created_at DESC);

-- Enable RLS (Row Level Security)
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if it exists to make migration idempotent
DROP POLICY IF EXISTS "Allow service_role full access" ON public.rate_limits;

-- Allow service role to do everything, keep public access completely restricted
CREATE POLICY "Allow service_role full access" ON public.rate_limits
  USING (true)
  WITH CHECK (true);

-- Single-roundtrip RPC function to check rate limits efficiently
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_ip_hash TEXT,
  p_endpoint TEXT,
  p_limit INT,
  p_window_seconds INT
) RETURNS BOOLEAN AS $$
DECLARE
  v_count INT;
  v_window_start TIMESTAMPTZ;
BEGIN
  v_window_start := now() - (p_window_seconds || ' seconds')::INTERVAL;
  
  -- Insert the current request
  INSERT INTO public.rate_limits (ip_hash, endpoint)
  VALUES (p_ip_hash, p_endpoint);
  
  -- Clean up expired logs (older than 24 hours) to keep table clean
  -- Background pruning built directly into the check function
  DELETE FROM public.rate_limits
  WHERE created_at < now() - INTERVAL '1 day';
  
  -- Count requests in the window for this IP and endpoint
  SELECT COUNT(*) INTO v_count
  FROM public.rate_limits
  WHERE ip_hash = p_ip_hash
    AND endpoint = p_endpoint
    AND created_at >= v_window_start;
    
  -- Return TRUE if allowed, FALSE if rate limited
  RETURN v_count <= p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
