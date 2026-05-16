require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function seed() {
  console.log('Seeding photographers...');
  
  const photographers = [
    { name: 'Ashok Wedding Studios', city: 'Guntur', phone_number: '9010111092' },
    { name: 'Uma Studio', city: 'Vijayawada', phone_number: '9848012345' },
    { name: 'Vamsi Photography', city: 'Hyderabad', phone_number: '8885551234' },
    { name: 'Siva Krishna Studio', city: 'Tenali', phone_number: '9991112222' }
  ];

  const { data, error } = await supabase
    .from('photographers')
    .insert(photographers);

  if (error) {
    console.error('Error seeding data:', error);
  } else {
    console.log('Successfully seeded photographers!');
  }
}

seed();
