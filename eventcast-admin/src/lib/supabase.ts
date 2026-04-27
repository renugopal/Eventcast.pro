import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Client specifically for browser/public requests
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Client specifically for Admin/Backend operations (Bypasses RLS)
// Only initialized if the secret key is available (Server-side/Build time)
export const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY 
  ? createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;
