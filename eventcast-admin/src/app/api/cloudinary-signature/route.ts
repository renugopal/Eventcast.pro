import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'edge';

async function generateCloudinarySignature(params: Record<string, string>, apiSecret: string) {
  const sortedKeys = Object.keys(params).sort();
  const stringToSign = sortedKeys.map(k => `${k}=${params[k]}`).join('&') + apiSecret;
  
  const encoder = new TextEncoder();
  const data = encoder.encode(stringToSign);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { timestamp, upload_preset } = await req.json();
    
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!apiSecret) {
      throw new Error("CLOUDINARY_API_SECRET is not configured");
    }

    const signature = await generateCloudinarySignature(
      { timestamp: timestamp.toString(), upload_preset },
      apiSecret
    );

    return NextResponse.json({ signature });
  } catch (error) {
    console.error('Signature Error:', error);
    return NextResponse.json({ error: 'Failed to generate signature' }, { status: 500 });
  }
}
