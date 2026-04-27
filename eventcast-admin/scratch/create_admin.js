const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase environment variables!");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function createAdminUser() {
  const email = 'admin@eventcast.pro';
  const password = 'Admin@123';

  console.log(`Attempting to create admin user: ${email}...`);

  const { data, error } = await supabase.auth.admin.createUser({
    email: email,
    password: password,
    email_confirm: true // Automatically confirm the email
  });

  if (error) {
    if (error.message.includes('already registered')) {
      console.log("User already exists! You can use the existing account.");
    } else {
      console.error("Error creating user:", error.message);
    }
  } else {
    console.log("Admin user created successfully!");
    console.log("Email:", email);
    console.log("Password:", password);
  }
}

createAdminUser();
