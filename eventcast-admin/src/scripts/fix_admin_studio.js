require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing SUPABASE env vars in .env.local!");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  console.log("Starting Admin Studio alignment check...");

  // 1. Fetch all users from Supabase Auth
  const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();
  
  if (authError || !users) {
    console.error("Error fetching auth users:", authError);
    return;
  }

  console.log(`Found ${users.length} users in Auth system.`);

  for (const user of users) {
    console.log(`- User: ${user.email} (${user.id})`);

    // Check if this user has a studio membership
    const { data: memberData, error: memberError } = await supabase
      .from('studio_members')
      .select('studio_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (memberError) {
      console.error(`  Error checking membership for ${user.email}:`, memberError);
      continue;
    }

    if (memberData) {
      console.log(`  ✅ Already belongs to studio: ${memberData.studio_id}`);
    } else {
      console.log(`  ❌ No studio association found for ${user.email}. Creating one...`);

      // Derive slug from email
      const emailPrefix = user.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
      const slug = emailPrefix === 'admin' ? 'eventcast' : `${emailPrefix}-studio`;

      // Check if this slug is taken
      const { data: existingStudio } = await supabase
        .from('studios')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();

      const finalSlug = existingStudio ? `${slug}-${Math.floor(Math.random() * 1000)}` : slug;

      // Create Studio
      const { data: studio, error: studioError } = await supabase
        .from('studios')
        .insert({
          owner_user_id: user.id,
          slug: finalSlug,
          display_name: emailPrefix === 'admin' ? 'Eventcast Pro' : `${user.email.split('@')[0]}'s Studio`,
          brand_color_hex: '#3b82f6',
          plan_tier: 'agency'
        })
        .select()
        .single();

      if (studioError || !studio) {
        console.error(`  Failed to create studio for ${user.email}:`, studioError);
        continue;
      }

      console.log(`  Created Studio: ${studio.display_name} (${studio.id}) with slug "${studio.slug}"`);

      // Create Membership
      const { error: memberInsertError } = await supabase
        .from('studio_members')
        .insert({
          studio_id: studio.id,
          user_id: user.id,
          role: 'owner'
        });

      if (memberInsertError) {
        console.error(`  Failed to create membership for ${user.email}:`, memberInsertError);
      } else {
        console.log(`  ✅ Successfully linked user ${user.email} to their new studio!`);
      }
    }
  }

  console.log("\nAlignment check completed successfully.");
}

run();
