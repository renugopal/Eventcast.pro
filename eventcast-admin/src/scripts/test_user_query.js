require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  console.log("Testing query authenticated as manaveduka@gmail.com...");

  // Sign in as manaveduka@gmail.com
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'manaveduka@gmail.com',
    password: 'password' // We will catch if password is correct or not, or try to see if it logs in
  });

  if (authError) {
    console.error("❌ Sign in failed:", authError.message);
    return;
  }

  console.log("✅ Sign in succeeded! User ID:", authData.user.id);

  // Now perform the exact query from checkUser()
  const { data, error } = await supabase
    .from('studio_members')
    .select('studio_id, studios(slug, display_name)')
    .eq('user_id', authData.user.id)
    .limit(1)
    .single();

  if (error) {
    console.error("❌ checkUser query failed:", error);
  } else {
    console.log("✅ checkUser query succeeded!", JSON.stringify(data, null, 2));
  }
}

run();
