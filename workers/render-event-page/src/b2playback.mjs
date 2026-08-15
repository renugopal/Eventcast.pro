// Pure helpers for the B2 authoritative-VOD playback path.
//
// Mirrors hls-playback.mjs's role for the R2 live path: plain JS (typed with
// JSDoc), no bundler-only syntax, executable directly with `node --test` and
// checked by `tsc --noEmit` via this Worker's `allowJs`.
//
// B2 is a private, S3-compatible bucket with no Cloudflare-native binding
// (unlike MEDIA_R2), so every read has to be an authenticated outbound
// fetch() from the Worker itself — the browser never sees a B2 host,
// credential, or presigned URL. AWS SigV4 is the auth scheme Backblaze's
// S3-compatible endpoint expects; @aws-sdk/client-s3 cannot run in this
// Worker's bundler-free, Node-free environment, and no presigner package is
// installed (adding one is a scope/dependency decision this pass does not
// make), so signing is implemented directly against Web Crypto — the same
// primitive Cloudflare Workers already expose, no new dependency.
//
// Key layout mirrors internal/upload/b2keys.go exactly:
//   events/{event_id}/vod/{finalization_generation}.m3u8
//   events/{event_id}/media/{session_id}/{sha256}-{local_file_identity}
// Event identity is the immutable event UUID (never playback_id, which
// rotates on reactivation) and the playlist is generation-specific so a
// superseded archive can never be mistaken for the current one.

const COMPONENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const GENERATION_RE = /^[A-Za-z0-9._-]{1,255}$/;

/** @param {unknown} value @returns {boolean} */
function isSafeComponent(value) {
  return typeof value === 'string' && COMPONENT_RE.test(value);
}

/** @param {unknown} value @returns {boolean} */
export function isValidGeneration(value) {
  return typeof value === 'string' && GENERATION_RE.test(value);
}

/**
 * @param {string} prefix
 * @param {string} key
 * @returns {string}
 */
function withPrefix(prefix, key) {
  if (!prefix) return key;
  return `${prefix.replace(/\/+$/, '')}/${key}`;
}

/**
 * events/{event_id}/vod/{generation}.m3u8 — matches
 * internal/upload/b2keys.go's B2VODPlaylistKey exactly.
 * @param {string} prefix
 * @param {string} eventId
 * @param {string} generation
 * @returns {string | null}
 */
export function buildB2PlaylistKey(prefix, eventId, generation) {
  if (!isSafeComponent(eventId) || !isValidGeneration(generation)) return null;
  return withPrefix(prefix, `events/${eventId}/vod/${generation}.m3u8`);
}

/**
 * events/{event_id}/media/{session_id}/{sha256}-{local_file_identity} —
 * matches internal/upload/b2keys.go's B2SegmentKey exactly.
 * @param {string} prefix
 * @param {string} eventId
 * @param {string} sessionId
 * @param {string} objectName sha256-localFileIdentity, taken verbatim from
 *   the playlist's own relative URI (already content-addressed upstream).
 * @returns {string | null}
 */
export function buildB2SegmentKey(prefix, eventId, sessionId, objectName) {
  if (!isSafeComponent(eventId) || !isSafeComponent(sessionId) || !isSafeComponent(objectName)) return null;
  return withPrefix(prefix, `events/${eventId}/media/${sessionId}/${objectName}`);
}

/**
 * @typedef {{ kind: 'manifest' } | { kind: 'segment', sessionId: string, objectName: string }} B2VodAsset
 */

/**
 * Parse the portion of the request path after /events/{slug}/vod/b2/ into
 * one of the two permitted shapes. Same fail-closed posture as
 * parseHlsAssetPath: unknown shapes, traversal, percent-encoding, and bad
 * charsets all return null.
 * @param {unknown} assetPath
 * @returns {B2VodAsset | null}
 */
export function parseB2VodAssetPath(assetPath) {
  if (typeof assetPath !== 'string' || assetPath.length === 0 || assetPath.length > 512) return null;
  if (/[%\\?#]/.test(assetPath)) return null;
  for (let i = 0; i < assetPath.length; i++) {
    const code = assetPath.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return null;
  }

  if (assetPath === 'index.m3u8') return { kind: 'manifest' };

  const parts = assetPath.split('/');
  if (parts.length === 3 && parts[0] === 'media') {
    const [, sessionId, objectName] = parts;
    if (!isSafeComponent(sessionId) || !isSafeComponent(objectName)) return null;
    return { kind: 'segment', sessionId, objectName };
  }

  return null;
}

/**
 * Rewrite the B2 playlist's playlist-relative segment references
 * (`../media/{session}/{object}`, produced by internal/upload/b2playlist.go's
 * b2SegmentRelativeURI) onto this Worker's own public B2-VOD route.
 *
 *   ../media/{session}/{object} -> /events/{slug}/vod/b2/media/{session}/{object}
 *
 * Fails closed exactly like rewriteManifest: any URI line that isn't this
 * exact relative shape means the whole manifest is refused rather than
 * partially rewritten.
 * @param {string} text
 * @param {string} slug
 * @returns {string | null}
 */
export function rewriteB2Manifest(text, slug) {
  if (typeof text !== 'string' || typeof slug !== 'string' || slug.length === 0) return null;
  if (text.trim().length === 0) return null;

  const marker = '../media/';
  const publicBase = `/events/${encodeURIComponent(slug)}/vod/b2/media/`;

  const lines = text.split('\n');
  const out = new Array(lines.length);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const hadCr = raw.endsWith('\r');
    const line = hadCr ? raw.slice(0, -1) : raw;

    if (line.length === 0 || line.startsWith('#')) {
      out[i] = raw;
      continue;
    }

    if (!line.startsWith(marker)) return null; // not our relative shape — refuse to publish it
    const tail = line.slice(marker.length);
    const segParts = tail.split('/');
    if (segParts.length !== 2 || !isSafeComponent(segParts[0]) || !isSafeComponent(segParts[1])) return null;

    const rewritten = `${publicBase}${segParts[0]}/${segParts[1]}`;
    out[i] = hadCr ? `${rewritten}\r` : rewritten;
  }

  const rewrittenText = out.join('\n');
  if (!rewrittenText.startsWith('#EXTM3U')) return null;
  return rewrittenText;
}

// ---------------------------------------------------------------------------
// AWS SigV4 signing for one authenticated GET, via Web Crypto only.
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

/** @param {ArrayBuffer|Uint8Array|string} data @returns {Promise<string>} */
async function sha256Hex(data) {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** @param {ArrayBuffer|Uint8Array} keyBytes @param {string} msg @returns {Promise<ArrayBuffer>} */
async function hmacSha256(keyBytes, msg) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, encoder.encode(msg));
}

/**
 * @param {string} secretAccessKey
 * @param {string} dateStamp YYYYMMDD
 * @param {string} region
 * @param {string} service
 * @returns {Promise<ArrayBuffer>}
 */
async function getSignatureKey(secretAccessKey, dateStamp, region, service) {
  const kDate = await hmacSha256(encoder.encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

/**
 * @typedef {{
 *   endpoint: string,
 *   region: string,
 *   bucket: string,
 *   accessKeyId: string,
 *   secretAccessKey: string,
 * }} B2SigningConfig
 */

/**
 * Builds a fully authenticated GET Request for one B2 object key, ready to
 * pass straight to fetch(). SigV4 header-based auth (not query-string
 * presigning): the request is made server-to-server from the Worker, so the
 * signed URL/headers never reach a browser.
 * @param {B2SigningConfig} config
 * @param {string} objectKey
 * @param {Date} now
 * @returns {Promise<Request>}
 */
export async function buildSignedB2GetRequest(config, objectKey, now = new Date()) {
  const url = new URL(config.endpoint);
  const host = url.host;
  const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');
  const canonicalUri = `/${config.bucket}/${encodedKey}`;

  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex('');

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['GET', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = await getSignatureKey(config.secretAccessKey, dateStamp, config.region, 's3');
  const signatureBytes = await hmacSha256(signingKey, stringToSign);
  const signature = [...new Uint8Array(signatureBytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Request(`${url.protocol}//${host}${canonicalUri}`, {
    method: 'GET',
    headers: {
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: authorization,
    },
  });
}
