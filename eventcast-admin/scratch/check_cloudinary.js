const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function listResources() {
  try {
    const result = await cloudinary.api.resources({
      type: 'upload',
      prefix: 'base_thumbnails/'
    });
    console.log('--- FOUND RESOURCES ---');
    result.resources.forEach(res => {
      console.log(`ID: ${res.public_id}, URL: ${res.secure_url}`);
    });
    console.log('--- END ---');
  } catch (err) {
    console.error('List failed:', err);
  }
}

listResources();
