const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');

cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const directoryPath = 'C:\\Users\\Renugopal\\Downloads\\Thumbnails\\No Text';

async function uploadFiles() {
  try {
    const files = fs.readdirSync(directoryPath);
    console.log(`Found ${files.length} files to upload.`);

    for (const file of files) {
      const filePath = path.join(directoryPath, file);
      const publicId = `base_thumbnails/${path.parse(file).name}`;
      
      console.log(`Uploading ${file}...`);
      await cloudinary.uploader.upload(filePath, {
        public_id: publicId,
        folder: 'base_thumbnails',
        overwrite: true
      });
      console.log(`Successfully uploaded ${file}`);
    }
    console.log('All uploads complete!');
  } catch (err) {
    console.error('Upload failed:', err);
  }
}

uploadFiles();
