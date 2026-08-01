// Pure helpers for the private-R2 HLS playback path.
//
// Kept in plain JS (typed with JSDoc) so `node --test` can execute them
// directly: this Worker package has no TS transform in its test path and
// no test framework, and the scope constraint forbids adding Miniflare or
// any new dependency. index.ts imports this module; tsconfig `allowJs`
// lets `tsc --noEmit` still check every call site against these types.
//
// Threat model for everything below: `assetPath` is attacker-controlled
// (it is whatever follows /events/{slug}/hls/ in the request path), and
// `playbackId` is a private identifier that must never reach a response
// body. So paths are validated against a strict allowlist *before* any R2
// key is built, and manifest rewriting fails closed rather than emitting a
// line it does not fully understand.

/**
 * One path component of an R2 object key.
 *
 * Charset mirrors the Media Agent's own sanitizer
 * (internal/spool.sanitizeComponent: [A-Za-z0-9._-] only), narrowed
 * further to require an alphanumeric first character. That rules out
 * ".", "..", and dotfile-shaped components structurally, so traversal can
 * never be expressed by a component that passes this test.
 */
const COMPONENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Extensions the segment writer can actually produce (V1: MPEG-TS passthrough). */
const SEGMENT_EXTENSIONS = ['.ts', '.m4s', '.mp4'];

const MANIFEST_CONTENT_TYPE = 'application/vnd.apple.mpegurl';

/**
 * @typedef {{ kind: 'manifest', assetPath: string, variant: 'live' | 'vod' }} ManifestAsset
 * @typedef {{ kind: 'segment', assetPath: string, sessionId: string, fileName: string }} SegmentAsset
 * @typedef {ManifestAsset | SegmentAsset} HlsAsset
 */

/**
 * True for a single safe key component.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSafeComponent(value) {
  return typeof value === 'string' && COMPONENT_RE.test(value);
}

/**
 * True for a playback_id that is safe to interpolate into an R2 key.
 * Activation generates hex ids, so the component charset is a superset of
 * what a real value can contain.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidPlaybackId(value) {
  return isSafeComponent(value);
}

/**
 * Parse the portion of the request path after /events/{slug}/hls/ into one
 * of exactly three permitted asset shapes. Returns null for anything else —
 * unknown shapes, traversal, percent-encoding, extra depth, bad charset.
 *
 * Percent signs are rejected outright rather than decoded: no legitimate
 * asset name can contain one (see COMPONENT_RE), and refusing to decode
 * removes the whole class of encoded-separator bypasses.
 *
 * @param {unknown} assetPath
 * @returns {HlsAsset | null}
 */
export function parseHlsAssetPath(assetPath) {
  if (typeof assetPath !== 'string' || assetPath.length === 0 || assetPath.length > 512) {
    return null;
  }
  // Reject anything that could carry a second meaning: encoded bytes,
  // Windows separators, control characters, query/fragment remnants.
  if (/[%\\?#]/.test(assetPath) || /[\u0000-\u001f\u007f]/.test(assetPath)) {
    return null;
  }

  const parts = assetPath.split('/');
  if (parts.some((p) => p.length === 0)) {
    return null; // leading, trailing, or doubled slash
  }

  if (parts.length === 2 && parts[1] === 'index.m3u8' && (parts[0] === 'live' || parts[0] === 'vod')) {
    return { kind: 'manifest', assetPath: `${parts[0]}/index.m3u8`, variant: parts[0] };
  }

  if (parts.length === 3 && parts[0] === 'media') {
    const [, sessionId, fileName] = parts;
    if (!isSafeComponent(sessionId) || !isSafeComponent(fileName)) {
      return null;
    }
    if (!SEGMENT_EXTENSIONS.some((ext) => fileName.endsWith(ext))) {
      return null;
    }
    return { kind: 'segment', assetPath: `media/${sessionId}/${fileName}`, sessionId, fileName };
  }

  return null;
}

/**
 * Build the R2 object key for an already-validated asset path.
 *
 * Layout matches internal/upload/keys.go exactly:
 *   events/{playback_id}/live/index.m3u8
 *   events/{playback_id}/vod/index.m3u8
 *   events/{playback_id}/media/{session_id}/{local_file_identity}
 *
 * Returns null (never a partially-built key) if either input fails
 * validation, so a caller that forgets to pre-validate still cannot
 * construct a key from hostile input.
 *
 * @param {unknown} playbackId
 * @param {unknown} assetPath
 * @returns {string | null}
 */
export function buildR2Key(playbackId, assetPath) {
  if (!isValidPlaybackId(playbackId)) return null;
  const asset = parseHlsAssetPath(assetPath);
  if (!asset) return null;
  return `events/${playbackId}/${asset.assetPath}`;
}

/**
 * Rewrite the Media Agent's segment references onto the existing public
 * route.
 *
 *   /events/{playback_id}/media/{session_id}/{file}
 *     -> /events/{slug}/hls/media/{session_id}/{file}
 *
 * Fails closed: returns null if any URI line is not a segment reference
 * for this exact playback_id. A line we cannot rewrite is a line we cannot
 * safely emit — passing it through verbatim would publish the private
 * playback_id (or some other origin's URL) to the player. Callers turn
 * null into the same generic 404 as every other failure.
 *
 * Comment lines (#EXTM3U, #EXTINF, #EXT-X-*) pass through untouched; V1
 * manifests carry no URI-bearing tags (no #EXT-X-KEY / #EXT-X-MAP), so no
 * private reference can hide inside one.
 *
 * @param {string} text
 * @param {string} playbackId
 * @param {string} slug
 * @returns {string | null}
 */
export function rewriteManifest(text, playbackId, slug) {
  if (typeof text !== 'string' || !isValidPlaybackId(playbackId) || typeof slug !== 'string' || slug.length === 0) {
    return null;
  }
  if (text.trim().length === 0) {
    return null;
  }

  const marker = `/events/${playbackId}/media/`;
  const publicBase = `/events/${encodeURIComponent(slug)}/hls/media/`;

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

    const idx = line.indexOf(marker);
    if (idx === -1) {
      return null; // URI line that is not ours — refuse to publish it
    }
    const tail = line.slice(idx + marker.length);
    const asset = parseHlsAssetPath(`media/${tail}`);
    if (!asset || asset.kind !== 'segment') {
      return null;
    }

    const rewritten = `${publicBase}${asset.sessionId}/${asset.fileName}`;
    out[i] = hadCr ? `${rewritten}\r` : rewritten;
  }

  const rewrittenText = out.join('\n');
  if (!rewrittenText.startsWith('#EXTM3U')) {
    return null; // never serve a manifest that lacks a valid HLS header
  }
  return rewrittenText;
}

/**
 * Content-Type fallback used only when the stored object carries no
 * httpMetadata.contentType.
 * @param {HlsAsset} asset
 * @returns {string}
 */
export function fallbackContentType(asset) {
  if (asset.kind === 'manifest') return MANIFEST_CONTENT_TYPE;
  if (asset.fileName.endsWith('.ts')) return 'video/MP2T';
  if (asset.fileName.endsWith('.m4s') || asset.fileName.endsWith('.mp4')) return 'video/mp4';
  return 'application/octet-stream';
}

/**
 * Cache-Control fallback used only when the stored object carries no
 * httpMetadata.cacheControl. Live manifests are mutable and must never be
 * cached (ADR-021); segments are immutable once written.
 * @param {HlsAsset} asset
 * @returns {string}
 */
export function fallbackCacheControl(asset) {
  return asset.kind === 'manifest'
    ? 'no-store, no-cache, must-revalidate'
    : 'public, max-age=31536000, immutable';
}
