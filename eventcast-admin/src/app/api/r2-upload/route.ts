/**
 * /api/r2-upload  — Edge Runtime (Cloudflare Pages compatible)
 * Uploads a video file directly to Cloudflare R2 using the S3-compatible API.
 * Uses Web Crypto API (crypto.subtle) instead of Node.js crypto — required for Edge.
 * Videos → R2 (Zero Egress Fees)
 */
export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';

// ─── Web Crypto Helpers (Edge Runtime / crypto.subtle) ────────────────────────

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function importHmacKey(keyData: ArrayBuffer | Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function hmacSha256Raw(key: CryptoKey, data: string): Promise<ArrayBuffer> {
  return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
}

async function hmacSha256Hex(key: CryptoKey, data: string): Promise<string> {
  const buf = await hmacSha256Raw(key, data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function getSigningKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const kDateKey    = await importHmacKey(enc.encode('AWS4' + secretKey));
  const kDateBuf    = await hmacSha256Raw(kDateKey, dateStamp);
  const kRegionKey  = await importHmacKey(kDateBuf);
  const kRegionBuf  = await hmacSha256Raw(kRegionKey, region);
  const kServiceKey = await importHmacKey(kRegionBuf);
  const kServiceBuf = await hmacSha256Raw(kServiceKey, service);
  const kSigningKey = await importHmacKey(kServiceBuf);
  const kSigningBuf = await hmacSha256Raw(kSigningKey, 'aws4_request');
  return importHmacKey(kSigningBuf);
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const formData   = await req.formData();
    const file       = formData.get('file') as File | null;
    const folder     = (formData.get('folder') as string) || 'events';

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }

    const accountId  = process.env.R2_ACCOUNT_ID!;
    const accessKey  = process.env.R2_ACCESS_KEY_ID!;
    const secretKey  = process.env.R2_SECRET_ACCESS_KEY!;
    const bucketName = process.env.R2_BUCKET_NAME!;
    const endpoint   = process.env.R2_S3_ENDPOINT!;

    if (!accountId || !accessKey || !secretKey || !bucketName || !endpoint) {
      return NextResponse.json(
        { success: false, error: 'R2 environment variables not configured' },
        { status: 500 }
      );
    }

    // Build a safe object key
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectKey    = `${folder}/${Date.now()}-${safeFileName}`;
    const fileBuffer   = await file.arrayBuffer();
    const contentType  = file.type || 'video/mp4';

    // ── AWS Sig V4 (Web Crypto) ───────────────────────────────────────────────
    const region  = 'auto'; // Cloudflare R2 uses 'auto'
    const service = 's3';
    const host    = new URL(endpoint).host;

    const now       = new Date();
    // Format: YYYYMMDDTHHmmssZ
    const amzDate   = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const dateStamp = amzDate.slice(0, 8);

    const payloadHash    = await sha256Hex(new Uint8Array(fileBuffer));
    const canonicalUri   = `/${bucketName}/${objectKey}`;
    const signedHeaders  = 'content-type;host;x-amz-content-sha256;x-amz-date';

    const canonicalHeaders =
      `content-type:${contentType}\n` +
      `host:${host}\n` +
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${amzDate}\n`;

    const canonicalRequest = [
      'PUT',
      canonicalUri,
      '',              // no query string
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      await sha256Hex(new TextEncoder().encode(canonicalRequest)),
    ].join('\n');

    const signingKey = await getSigningKey(secretKey, dateStamp, region, service);
    const signature  = await hmacSha256Hex(signingKey, stringToSign);

    const authHeader =
      `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, ` +
      `Signature=${signature}`;

    // ── PUT to R2 ─────────────────────────────────────────────────────────────
    const uploadUrl = `${endpoint}/${bucketName}/${objectKey}`;

    const r2Res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type':         contentType,
        'x-amz-date':           amzDate,
        'x-amz-content-sha256': payloadHash,
        'Authorization':        authHeader,
      },
      body: fileBuffer,
    });

    if (!r2Res.ok) {
      const errText = await r2Res.text();
      console.error('R2 upload error:', r2Res.status, errText);
      return NextResponse.json(
        { success: false, error: `R2 upload failed: ${r2Res.status}` },
        { status: 500 }
      );
    }

    // Return public URL — update this to cdn.eventcast.pro once Worker is set up
    const publicUrl = `${endpoint}/${bucketName}/${objectKey}`;

    return NextResponse.json({ success: true, url: publicUrl, key: objectKey });

  } catch (err: any) {
    console.error('R2 upload route error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
