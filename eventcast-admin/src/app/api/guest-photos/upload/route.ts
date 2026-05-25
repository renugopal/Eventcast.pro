/**
 * POST /api/guest-photos/upload
 *
 * Public endpoint — no JWT required (guestphoto uploads come from event landing pages).
 * Middleware allowlist handles this via PUBLIC_PREFIXES.
 *
 * Flow:
 *  1. Validate required fields (event_id, uploader_name, file)
 *  2. Fetch event's guest_photo_limit from DB
 *  3. Count existing approved photos for this event
 *  4. Reject if limit reached (429)
 *  5. Upload compressed WebP to R2 under guest-photos/{event_id}/
 *  6. Insert record in guest_photos table
 *  7. Return { success, photo_url, photo_id }
 */
export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ─── Web Crypto AWS Sig V4 (same pattern as /api/r2-upload) ──────────────────
async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const buffer =
    typeof data === 'string'
      ? new TextEncoder().encode(data).buffer as ArrayBuffer
      : data instanceof Uint8Array
      ? data.buffer as ArrayBuffer
      : data;
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

async function uploadToR2(
  fileBuffer: ArrayBuffer,
  objectKey: string,
  contentType: string
): Promise<string> {
  const accessKey    = process.env.R2_ACCESS_KEY_ID!;
  const secretKey    = process.env.R2_SECRET_ACCESS_KEY!;
  const bucketName   = process.env.R2_BUCKET_NAME!;
  const endpoint     = process.env.R2_S3_ENDPOINT!;
  const r2PublicBase = process.env.R2_PUBLIC_URL || 'https://pub-fa013cc979d8410e9d307bd2c9e6ecf2.r2.dev';

  const region  = 'auto';
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

  const canonicalRequest = ['PUT', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, credentialScope,
    await sha256Hex(new TextEncoder().encode(canonicalRequest)),
  ].join('\n');

  const signingKeyBuf = await getSigningKeyBuf(secretKey, dateStamp, region, service);
  const signingKey    = await crypto.subtle.importKey(
    'raw', signingKeyBuf, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signatureBuf = await crypto.subtle.sign('HMAC', signingKey, new TextEncoder().encode(stringToSign));
  const signature    = bufToHex(signatureBuf);

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const uploadUrl = `${endpoint}/${bucketName}/${objectKey}`;
  const r2Res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type':         contentType,
      'x-amz-date':           amzDate,
      'x-amz-content-sha256': payloadHash,
      'Authorization':        authHeader,
    },
    // @ts-ignore — duplex required for streaming body in some runtimes
    body: fileBuffer,
  });

  if (!r2Res.ok) {
    const errText = await r2Res.text();
    throw new Error(`R2 upload failed: ${r2Res.status} — ${errText}`);
  }

  return `${r2PublicBase}/${objectKey}`;
}

// ─── Main Handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const formData     = await req.formData();
    const file         = formData.get('file') as File | null;
    const eventId      = (formData.get('event_id') as string | null)?.trim();
    const uploaderName = (formData.get('uploader_name') as string | null)?.trim();

    // ── Validation ────────────────────────────────────────────────────────────
    if (!file)         return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    if (!eventId)      return NextResponse.json({ success: false, error: 'event_id is required' }, { status: 400 });
    if (!uploaderName) return NextResponse.json({ success: false, error: 'Your name is required to share a photo' }, { status: 400 });
    if (uploaderName.length > 60) return NextResponse.json({ success: false, error: 'Name too long (max 60 chars)' }, { status: 400 });

    // File type guard — must be an image
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ success: false, error: 'Only image files are allowed' }, { status: 415 });
    }

    // File size guard — 12 MB max (browser should compress, but guard anyway)
    const MAX_BYTES = 12 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ success: false, error: 'File too large. Max 12 MB.' }, { status: 413 });
    }

    // ── Supabase — service role for count queries ─────────────────────────────
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // 1. Fetch event photo limit
    const { data: eventRow, error: eventErr } = await supabase
      .from('events')
      .select('id, guest_photo_limit')
      .eq('id', eventId)
      .maybeSingle();

    if (eventErr || !eventRow) {
      return NextResponse.json({ success: false, error: 'Event not found' }, { status: 404 });
    }

    const photoLimit: number = eventRow.guest_photo_limit ?? 50;

    // 2. Count existing photos for this event
    const { count: existingCount, error: countErr } = await supabase
      .from('guest_photos')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('approved', true);

    if (countErr) {
      console.error('[guest-photos/upload] Count error:', countErr);
      return NextResponse.json({ success: false, error: 'Could not check photo count' }, { status: 500 });
    }

    if ((existingCount ?? 0) >= photoLimit) {
      return NextResponse.json({
        success: false,
        error: `Photo wall is full (${photoLimit} photos max). Thank you for being part of this celebration! 🎉`,
        limitReached: true,
      }, { status: 429 });
    }

    // ── Upload to R2 ──────────────────────────────────────────────────────────
    const fileBuffer  = await file.arrayBuffer();
    const contentType = file.type || 'image/webp';

    // Store under guest-photos/{event_id}/{timestamp}.webp
    const ext       = file.type === 'image/webp' ? 'webp' : file.type.split('/')[1] || 'jpg';
    const objectKey = `guest-photos/${eventId}/${Date.now()}.${ext}`;

    const publicUrl = await uploadToR2(fileBuffer, objectKey, contentType);

    // ── Insert into Supabase ──────────────────────────────────────────────────
    const { data: photoRow, error: insertErr } = await supabase
      .from('guest_photos')
      .insert({
        event_id:        eventId,
        photo_url:       publicUrl,
        r2_key:          objectKey,
        file_size_bytes: file.size,
        uploader_name:   uploaderName,
        approved:        true,
      })
      .select('id')
      .single();

    if (insertErr) {
      console.error('[guest-photos/upload] Insert error:', insertErr);
      return NextResponse.json({ success: false, error: 'Failed to save photo record' }, { status: 500 });
    }

    return NextResponse.json({
      success:   true,
      photo_url: publicUrl,
      photo_id:  photoRow.id,
    });

  } catch (err: any) {
    console.error('[guest-photos/upload] Error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
