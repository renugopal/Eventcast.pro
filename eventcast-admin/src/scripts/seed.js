const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://lteogzqeuuoxlekhofow.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0ZW9nenFldXVveGxla2hvZm93Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzE5NzQ4MiwiZXhwIjoyMDkyNzczNDgyfQ.ADSXHGEWa_VjRkRQdaxH9TyMEYLeIcuC-XYBHJWOdx0';

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
