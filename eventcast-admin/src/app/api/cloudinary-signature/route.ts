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

// Accepts { params: Record<string, string> } where params contains all upload
// fields that need to be signed (e.g. timestamp, folder, eager).
// Cloudinary signature rules: sign every param except file, api_key, resource_type.
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json();
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!apiSecret) {
      throw new Error("CLOUDINARY_API_SECRET is not configured");
    }

    // Support both legacy { timestamp, upload_preset } and new { params: {...} }
    const params: Record<string, string> = body.params
      ? body.params
      : { timestamp: body.timestamp?.toString(), upload_preset: body.upload_preset };

    const signature = await generateCloudinarySignature(params, apiSecret);
    return NextResponse.json({ signature });
  } catch (error) {
    console.error('Signature Error:', error);
    return NextResponse.json({ error: 'Failed to generate signature' }, { status: 500 });
  }
}
