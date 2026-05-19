require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  console.log("Testing frontend-style query...");

  // Sign in to get a session (optional, but let's test if we can do the select)
  // Even if not signed in, let's see if the join syntax is valid and what error it returns
  const { data, error } = await supabase
    .from('studio_members')
    .select('studio_id, studios(slug, display_name)')
    .limit(1);

  if (error) {
    console.error("❌ Query Failed:", error);
  } else {
    console.log("✅ Query Succeeded!", JSON.stringify(data, null, 2));
  }
}

run();
