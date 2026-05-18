/**
 * /api/r2-upload  — Edge Runtime (Cloudflare Pages compatible)
 * Uploads videos to Cloudflare R2 using AWS Signature V4 via Web Crypto API.
 * Node.js `crypto` module is NOT used — only Web Crypto (available in Edge).
 */
export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';

// ─── Web Crypto AWS Sig V4 Helpers ────────────────────────────────────────────

async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const buffer = typeof data === 'string' ? new TextEncoder().encode(data) as BufferSource : data as BufferSource;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Raw(keyData: ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
}

async function getSigningKeyBuf(
  secretKey: string, dateStamp: string, region: string, service: string
): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const kDate    = await hmacSha256Raw(enc.encode('AWS4' + secretKey).buffer as ArrayBuffer, dateStamp);
  const kRegion  = await hmacSha256Raw(kDate, region);
  const kService = await hmacSha256Raw(kRegion, service);
  return hmacSha256Raw(kService, 'aws4_request');
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file     = formData.get('file') as File | null;
    const folder   = (formData.get('folder') as string) || 'events';

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }

    const accessKey    = process.env.R2_ACCESS_KEY_ID!;
    const secretKey    = process.env.R2_SECRET_ACCESS_KEY!;
    const bucketName   = process.env.R2_BUCKET_NAME!;
    const endpoint     = process.env.R2_S3_ENDPOINT!;
    const r2PublicBase = process.env.R2_PUBLIC_URL || 'https://pub-fa013cc979d8410e9d307bd2c9e6ecf2.r2.dev';

    if (!accessKey || !secretKey || !bucketName || !endpoint) {
      return NextResponse.json(
        { success: false, error: 'R2 environment variables not configured' },
        { status: 500 }
      );
    }

    // Build object key: events/<folder>/<timestamp>-<filename>
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectKey    = `${folder}/${Date.now()}-${safeFileName}`;

    const fileBuffer  = await file.arrayBuffer();
    const contentType = file.type || 'video/mp4';

    // ── AWS Sig V4 ────────────────────────────────────────────────────────────
    const region  = 'auto'; // Cloudflare R2 uses 'auto'
    const service = 's3';
    const host    = new URL(endpoint).host;

    const now       = new Date();
    const amzDate   = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
    const dateStamp = amzDate.slice(0, 8);

    const payloadHash  = await sha256Hex(fileBuffer);
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
      await sha256Hex(new TextEncoder().encode(canonicalRequest)),
    ].join('\n');

    const signingKeyBuf = await getSigningKeyBuf(secretKey, dateStamp, region, service);
    const signingKey    = await crypto.subtle.importKey(
      'raw', signingKeyBuf, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const signatureBuf = await crypto.subtle.sign(
      'HMAC', signingKey, new TextEncoder().encode(stringToSign)
    );
    const signature = bufToHex(signatureBuf);

    const authHeader =
      `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, ` +
      `Signature=${signature}`;

    // ── Upload to R2 ──────────────────────────────────────────────────────────
    const uploadUrl = `${endpoint}/${bucketName}/${objectKey}`;

    const r2Res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type':          contentType,
        'x-amz-date':            amzDate,
        'x-amz-content-sha256':  payloadHash,
        'Authorization':         authHeader,
      },
      // @ts-ignore — duplex required for streaming body in some runtimes
      body: fileBuffer,
    });

    if (!r2Res.ok) {
      const errText = await r2Res.text();
      console.error('R2 upload error:', r2Res.status, errText);
      return NextResponse.json(
        { success: false, error: `R2 upload failed: ${r2Res.status} — ${errText}` },
        { status: 500 }
      );
    }

    // ── Return public URL ─────────────────────────────────────────────────────
    const publicUrl = `${r2PublicBase}/${objectKey}`;
    return NextResponse.json({ success: true, url: publicUrl, key: objectKey });

  } catch (err: any) {
    console.error('R2 upload route error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
