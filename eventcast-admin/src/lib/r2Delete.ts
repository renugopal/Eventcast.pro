/**
 * Shared Cloudflare R2 object delete helper (hand-written AWS SigV4 DELETE,
 * Web Crypto only — no `@aws-sdk/client-s3` dependency, matching the
 * existing pattern this module is extracted from unchanged).
 *
 * Extracted from `/api/guest-photos/delete`'s original inline
 * `deleteFromR2()` so the Event Lifecycle permanent-delete path can reuse
 * the exact same, already-proven-in-production R2 delete call instead of a
 * second implementation. Behavior is byte-identical to the original.
 */

async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const buffer =
    typeof data === 'string'
      ? (new TextEncoder().encode(data).buffer as ArrayBuffer)
      : data instanceof Uint8Array
      ? (data.buffer as ArrayBuffer)
      : data;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Raw(keyData: ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
}

async function getSigningKeyBuf(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string
): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const kDate = await hmacSha256Raw(enc.encode('AWS4' + secretKey).buffer as ArrayBuffer, dateStamp);
  const kRegion = await hmacSha256Raw(kDate, region);
  const kService = await hmacSha256Raw(kRegion, service);
  return hmacSha256Raw(kService, 'aws4_request');
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Deletes one object from the configured R2 bucket by key. Resolves
 * (no-op success) on a 404 — already-gone is treated as success. Throws on
 * any other non-OK response, so callers decide for themselves whether a
 * failure here is fatal (every current caller treats it as non-fatal and
 * logs a warning, matching the pre-existing guest-photos/delete behavior).
 */
export async function deleteFromR2(r2Key: string): Promise<void> {
  const accessKey = process.env.R2_ACCESS_KEY_ID!;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY!;
  const bucketName = process.env.R2_BUCKET_NAME!;
  const endpoint = process.env.R2_S3_ENDPOINT!;

  const region = 'auto';
  const service = 's3';
  const host = new URL(endpoint).host;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);

  const emptyHash = await sha256Hex(new ArrayBuffer(0));
  const canonicalUri = `/${bucketName}/${r2Key}`;

  const canonicalHeaders = `host:${host}\n` + `x-amz-content-sha256:${emptyHash}\n` + `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = ['DELETE', canonicalUri, '', canonicalHeaders, signedHeaders, emptyHash].join('\n');
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(new TextEncoder().encode(canonicalRequest)),
  ].join('\n');

  const signingKeyBuf = await getSigningKeyBuf(secretKey, dateStamp, region, service);
  const signingKey = await crypto.subtle.importKey('raw', signingKeyBuf, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signatureBuf = await crypto.subtle.sign('HMAC', signingKey, new TextEncoder().encode(stringToSign));
  const signature = bufToHex(signatureBuf);

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const r2Res = await fetch(`${endpoint}/${bucketName}/${r2Key}`, {
    method: 'DELETE',
    headers: {
      host: host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': emptyHash,
      Authorization: authHeader,
    },
  });

  // 204 No Content = success. 404 = already gone = also acceptable.
  if (!r2Res.ok && r2Res.status !== 404) {
    const errText = await r2Res.text();
    throw new Error(`R2 delete failed: ${r2Res.status} — ${errText}`);
  }
}

/**
 * Reconstructs an R2 object key from a stored public URL, but only when the
 * URL actually matches the configured `R2_PUBLIC_URL` origin AND (when the
 * base has a path prefix) falls strictly inside that prefix. A legacy
 * Cloudinary URL, a different origin, or a different top-level path on the
 * same CDN origin all return `null` rather than a wrongly-derived key, so
 * callers can skip it safely instead of attempting a doomed or — worse —
 * wrong delete call.
 */
export function r2KeyFromPublicUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const r2PublicBase = process.env.R2_PUBLIC_URL;
  if (!r2PublicBase) return null;

  try {
    const base = new URL(r2PublicBase);
    const target = new URL(url);
    if (target.origin !== base.origin) return null;

    const basePath = base.pathname.endsWith('/') ? base.pathname : base.pathname + '/';
    const targetPath = target.pathname;

    if (basePath === '/') {
      // No path prefix on the base — any path under the same origin is a
      // valid key location.
      const key = targetPath.replace(/^\/+/, '');
      return key || null;
    }

    // A path-prefixed base: the target must be INSIDE that exact prefix.
    // Anything else — including a different top-level path on the same
    // origin/CDN — is not a valid R2 object under this bucket's mapping
    // and must return null, not a wrongly-stripped key.
    if (!targetPath.startsWith(basePath)) return null;

    const key = targetPath.slice(basePath.length);
    return key || null;
  } catch {
    return null;
  }
}
