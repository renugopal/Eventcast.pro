import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAndSeed() {
  console.log('Checking photographers...');
  const { data, error } = await supabase.from('photographers').select('*');
  
  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${data.length} photographers.`);

  if (data.length === 0) {
    console.log('Seeding initial photographers...');
    const { error: insertError } = await supabase.from('photographers').insert([
      { name: 'Ashok Wedding Studios', city: 'Guntur', phone: '9010111092', logo_url: 'https://res.cloudinary.com/df5b4aq7h/image/upload/v1777209111/event_assets/ashok_logo.png' },
      { name: 'Uma Studio', city: 'Vijayawada', phone: '9848012345', logo_url: '' },
      { name: 'Vamsi Photography', city: 'Hyderabad', phone: '8885551234', logo_url: '' }
    ]);

    if (insertError) {
      console.error('Insert Error:', insertError);
    } else {
      console.log('Seed successful!');
    }
  } else {
    console.log('Current Photographers:', data);
  }
}

checkAndSeed();
