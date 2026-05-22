/**
 * DELETE /api/guest-photos/delete
 *
 * Protected — requires studio member JWT.
 * Deletes a guest photo from BOTH R2 storage AND Supabase DB.
 * Used by the Admin Moderation Panel.
 *
 * Body: { photo_id: string }
 */
export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@supabase/supabase-js';

// ─── R2 Delete Helper (AWS Sig V4 DELETE) ─────────────────────────────────────
async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const buffer = typeof data === 'string'
    ? new TextEncoder().encode(data) as BufferSource
    : data as BufferSource;
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
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function deleteFromR2(r2Key: string): Promise<void> {
  const accessKey  = process.env.R2_ACCESS_KEY_ID!;
  const secretKey  = process.env.R2_SECRET_ACCESS_KEY!;
  const bucketName = process.env.R2_BUCKET_NAME!;
  const endpoint   = process.env.R2_S3_ENDPOINT!;

  const region  = 'auto';
  const service = 's3';
  const host    = new URL(endpoint).host;

  const now       = new Date();
  const amzDate   = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);

  const emptyHash    = await sha256Hex(new ArrayBuffer(0));
  const canonicalUri = `/${bucketName}/${r2Key}`;

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${emptyHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = ['DELETE', canonicalUri, '', canonicalHeaders, signedHeaders, emptyHash].join('\n');
  const credentialScope  = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign     = [
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

  const r2Res = await fetch(`${endpoint}/${bucketName}/${r2Key}`, {
    method: 'DELETE',
    headers: {
      'host':                   host,
      'x-amz-date':             amzDate,
      'x-amz-content-sha256':   emptyHash,
      'Authorization':          authHeader,
    },
  });

  // 204 No Content = success. 404 = already gone = also acceptable.
  if (!r2Res.ok && r2Res.status !== 404) {
    const errText = await r2Res.text();
    throw new Error(`R2 delete failed: ${r2Res.status} — ${errText}`);
  }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { photo_id } = await req.json();

    if (!photo_id) {
      return NextResponse.json({ success: false, error: 'photo_id is required' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // 1. Fetch the photo record and verify ownership via event → studio chain
    const { data: photo, error: fetchErr } = await supabase
      .from('guest_photos')
      .select('id, r2_key, event_id, events!inner(studio_id)')
      .eq('id', photo_id)
      .maybeSingle();

    if (fetchErr || !photo) {
      return NextResponse.json({ success: false, error: 'Photo not found' }, { status: 404 });
    }

    // Ownership check: event's studio must match requesting studio
    const eventStudios = photo.events as any;
    const photoStudioId = Array.isArray(eventStudios)
      ? eventStudios[0]?.studio_id
      : eventStudios?.studio_id;

    if (photoStudioId !== auth.studioId) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    // 2. Delete from R2 first (non-fatal — DB cleanup still happens)
    try {
      await deleteFromR2(photo.r2_key);
    } catch (r2Err: any) {
      console.warn('[guest-photos/delete] R2 delete warning (continuing):', r2Err.message);
    }

    // 3. Delete from Supabase DB
    const { error: deleteErr } = await supabase
      .from('guest_photos')
      .delete()
      .eq('id', photo_id);

    if (deleteErr) {
      return NextResponse.json({ success: false, error: deleteErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, deleted_id: photo_id });

  } catch (err: any) {
    console.error('[guest-photos/delete] Error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
