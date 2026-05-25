export const compressImage = async (file: File): Promise<Blob | File> => {
  if (file.type.startsWith('video/')) return file; // Skip for videos
  if (file.size < 2 * 1024 * 1024) return file; // Skip if less than 2MB

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Limit max dimension to 2500px for high quality but reasonable size
        const maxDim = 2500;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height *= maxDim / width;
            width = maxDim;
          } else {
            width *= maxDim / height;
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else resolve(file);
        }, 'image/jpeg', 0.85); // 85% quality is perfect for web
      };
    };
  });
};

export async function uploadToR2(files: FileList, folder: string): Promise<string[]> {
  const uploadedUrls: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fd = new FormData();
    fd.append('file', file);
    fd.append('folder', folder);
    try {
      const res = await fetch('/api/r2-upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.success && data.url) {
        uploadedUrls.push(data.url);
      } else {
        console.error('R2 upload failed:', data.error);
      }
    } catch (err) {
      console.error('R2 upload error:', err);
    }
  }
  return uploadedUrls;
}

export async function uploadImageToCloudinary(files: FileList, folder: string): Promise<string[]> {
  const uploadedUrls: string[] = [];
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY;
  const eager = 'f_auto,q_auto,w_1920,c_limit';

  for (let i = 0; i < files.length; i++) {
    const fileToUpload = await compressImage(files[i]);
    const timestamp = Math.round(Date.now() / 1000).toString();
    const paramsToSign: Record<string, string> = { eager, folder, timestamp };

    let signature = '';
    try {
      const sigRes = await fetch('/api/cloudinary-signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: paramsToSign }),
      });
      const sigData = await sigRes.json();
      signature = sigData.signature;
    } catch (err) {
      console.error("Cloudinary signature error:", err);
      continue;
    }

    const formDataUpload = new FormData();
    formDataUpload.append('file', fileToUpload);
    formDataUpload.append('api_key', apiKey || '');
    formDataUpload.append('timestamp', timestamp);
    formDataUpload.append('signature', signature);
    formDataUpload.append('folder', folder);
    formDataUpload.append('eager', eager);

    try {
      const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
        method: 'POST',
        body: formDataUpload,
      });
      const data = await res.json();
      if (data.secure_url) {
        // Use pre-transformed eager URL if available, else construct it
        const finalUrl = data.eager?.[0]?.secure_url || data.secure_url.replace('/upload/', `/upload/${eager}/`);
        uploadedUrls.push(finalUrl);
      }
    } catch (err) {
      console.error("Cloudinary upload error:", err);
    }
  }
  return uploadedUrls;
}
