/**
 * /api/r2-upload
 * Receives a video file from the admin panel and uploads it to Cloudflare R2.
 * Uses the S3-compatible API with AWS Signature V4.
 * Videos → R2 (Zero Egress Fees)
 * Images → Cloudinary (handled in page.tsx)
 */
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createHmac, createHash } from 'crypto';

// ─── AWS Sig V4 Helpers ───────────────────────────────────────────────────────

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function getSigningKey(secretKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate    = hmacSha256('AWS4' + secretKey, dateStamp);
  const kRegion  = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, 'aws4_request');
  return kSigning;
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const folder = (formData.get('folder') as string) || 'events';

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }

    const accountId  = process.env.R2_ACCOUNT_ID!;
    const accessKey  = process.env.R2_ACCESS_KEY_ID!;
    const secretKey  = process.env.R2_SECRET_ACCESS_KEY!;
    const bucketName = process.env.R2_BUCKET_NAME!;
    const endpoint   = process.env.R2_S3_ENDPOINT!; // https://<accountId>.r2.cloudflarestorage.com

    if (!accountId || !accessKey || !secretKey || !bucketName || !endpoint) {
      return NextResponse.json({ success: false, error: 'R2 environment variables not configured' }, { status: 500 });
    }

    // Build a clean object key: events/<folder>/<timestamp>-<filename>
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectKey = `${folder}/${Date.now()}-${safeFileName}`;

    // Read file bytes
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const contentType = file.type || 'video/mp4';

    // ── AWS Sig V4 ────────────────────────────────────────────────────────────
    const region  = 'auto'; // Cloudflare R2 uses 'auto'
    const service = 's3';
    const host    = new URL(endpoint).host;

    const now         = new Date();
    const amzDate     = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z'; // YYYYMMDDTHHmmssZ
    const dateStamp   = amzDate.slice(0, 8); // YYYYMMDD

    const payloadHash = sha256Hex(fileBuffer);
    const canonicalUri = `/${bucketName}/${objectKey}`;

    const canonicalHeaders =
      `content-type:${contentType}\n` +
      `host:${host}\n` +
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${amzDate}\n`;

    const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest = [
      'PUT',
      canonicalUri,
      '', // no query string
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = getSigningKey(secretKey, dateStamp, region, service);
    const signature  = hmacSha256(signingKey, stringToSign).toString('hex');

    const authHeader =
      `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, ` +
      `Signature=${signature}`;

    // ── Upload to R2 ──────────────────────────────────────────────────────────
    const uploadUrl = `${endpoint}/${bucketName}/${objectKey}`;

    const r2Res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type':        contentType,
        'x-amz-date':          amzDate,
        'x-amz-content-sha256': payloadHash,
        'Authorization':        authHeader,
      },
      body: fileBuffer,
    });

    if (!r2Res.ok) {
      const errText = await r2Res.text();
      console.error('R2 upload error:', r2Res.status, errText);
      return NextResponse.json({ success: false, error: `R2 upload failed: ${r2Res.status}` }, { status: 500 });
    }

    // ── Build public URL ──────────────────────────────────────────────────────
    // Uses the R2 Public Development URL (enabled in Cloudflare R2 bucket settings).
    // Future: replace with cdn.eventcast.pro custom domain for branded URLs.
    const r2PublicBase = process.env.R2_PUBLIC_URL || `https://pub-fa013cc979d8410e9d307bd2c9e6ecf2.r2.dev`;
    const publicUrl = `${r2PublicBase}/${objectKey}`;

    return NextResponse.json({ success: true, url: publicUrl, key: objectKey });

  } catch (err: any) {
    console.error('R2 upload route error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
