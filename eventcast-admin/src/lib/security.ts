/**
 * 🔐 EVENTCAST PRO - ANTI-THEFT HLS SIGNER
 *
 * Generates short-lived HMAC-SHA256 tokens for HLS streams to prevent
 * unauthorized embedding/hotlinking of media.eventcast.pro streams.
 */

// Read the signing secret lazily so that merely importing this module never
// throws during Next.js / Cloudflare build-time module collection. Fail closed
// only when the signer is actually invoked without a configured secret — never
// fall back to a hardcoded value.
function getSigningSecret(): string {
  const secret = process.env.HLS_SIGNING_SECRET;
  if (!secret) {
    throw new Error(
      'HLS_SIGNING_SECRET is not configured. Refusing to sign or verify HLS tokens.'
    );
  }
  return secret;
}

// Helper to convert string to ArrayBuffer
function strToBuffer(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

// Helper to convert ArrayBuffer to Hex String
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generates a signed URL for a given stream slug.
 *
 * @param slug The event stream slug (e.g., 'raj-priya-wedding')
 * @param ttlSeconds How long the link should be valid (default: 300 seconds / 5 mins)
 * @returns The full signed URL with ?token and &expires
 */
export async function generateSignedStreamUrl(slug: string, ttlSeconds: number = 300): Promise<string> {
  const secret = getSigningSecret();
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const path = `/memfs/${slug}.m3u8`;
  const dataToSign = `${path}:${expires}`;

  const key = await crypto.subtle.importKey(
    'raw',
    strToBuffer(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, strToBuffer(dataToSign));
  const signature = bufferToHex(signatureBuffer);

  const baseUrl = process.env.RESTREAMER_URL || 'https://media.eventcast.pro';
  return `${baseUrl}${path}?token=${signature}&expires=${expires}`;
}

/**
 * Validates a signed URL parameters.
 */
export async function verifySignature(path: string, token: string, expires: number): Promise<boolean> {
  if (Math.floor(Date.now() / 1000) > expires) {
    return false; // Token expired
  }

  const secret = getSigningSecret();
  const dataToSign = `${path}:${expires}`;

  const key = await crypto.subtle.importKey(
    'raw',
    strToBuffer(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  // Convert hex token back to Uint8Array for verification
  const tokenBytes = new Uint8Array(token.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []);

  return crypto.subtle.verify('HMAC', key, tokenBytes, strToBuffer(dataToSign));
}
