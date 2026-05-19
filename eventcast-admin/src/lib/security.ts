import crypto from 'crypto';

/**
 * 🔐 EVENTCAST PRO - ANTI-THEFT HLS SIGNER
 * 
 * This module generates secure, short-lived HMAC-SHA256 tokens for HLS streams.
 * It prevents unauthorized embedding and hotlinking of media.eventcast.pro streams.
 */

// We use a shared secret that MUST be kept in .env.local and exactly match the Cloudflare Worker secret.
// For development fallback, we use a default string, but ALWAYS set HLS_SIGNING_SECRET in production.
const SECRET_KEY = process.env.HLS_SIGNING_SECRET || 'eventcast_premium_b2b_secret_key_2026';

/**
 * Generates a signed URL for a given stream slug.
 * 
 * @param slug The event stream slug (e.g., 'raj-priya-wedding')
 * @param ttlSeconds How long the link should be valid (default: 300 seconds / 5 mins)
 * @returns The full signed URL with ?token and &expires
 */
export function generateSignedStreamUrl(slug: string, ttlSeconds: number = 300): string {
  // 1. Calculate expiry timestamp
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  
  // 2. The path we are protecting
  const path = `/memfs/${slug}.m3u8`;
  
  // 3. Create the data string to sign: path + expires
  const dataToSign = `${path}:${expires}`;
  
  // 4. Generate the HMAC SHA-256 signature
  const hmac = crypto.createHmac('sha256', SECRET_KEY);
  hmac.update(dataToSign);
  const signature = hmac.digest('hex'); // We use hex for URL safety
  
  // 5. Construct the final URL
  const baseUrl = process.env.RESTREAMER_URL || 'https://media.eventcast.pro';
  return `${baseUrl}${path}?token=${signature}&expires=${expires}`;
}

/**
 * Validates a signed URL parameters (used if we want to verify on the Next.js side,
 * though normally this is done by the Cloudflare Edge Worker).
 */
export function verifySignature(path: string, token: string, expires: number): boolean {
  if (Math.floor(Date.now() / 1000) > expires) {
    return false; // Token expired
  }
  
  const dataToSign = `${path}:${expires}`;
  const hmac = crypto.createHmac('sha256', SECRET_KEY);
  hmac.update(dataToSign);
  const expectedSignature = hmac.digest('hex');
  
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedSignature));
}
