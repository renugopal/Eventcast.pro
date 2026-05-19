require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  console.log("Checking RLS status for studios and studio_members...");

  const { data, error } = await supabase.rpc('check_rls_status');
  
  // If rpc doesn't exist, we can query pg_tables
  if (error) {
    // Let's run a generic query
    const { data: tables, error: tableError } = await supabase.from('studios').select('id').limit(1);
    console.log("Studios accessible via Service Role:", !tableError);
  } else {
    console.log("RLS Status:", data);
  }

  // Let's see if we can query pg_catalog tables via generic select or a direct SQL query
  // Since we don't have raw SQL execution unless we write a custom migration, let's look at the migrations.
  // Wait! In the migrations we checked, there was no ENABLE ROW LEVEL SECURITY for studios or studio_members.
  // So unless the user clicked "Enable RLS" manually in the Supabase UI for those tables, RLS is NOT enabled!
}

run();
