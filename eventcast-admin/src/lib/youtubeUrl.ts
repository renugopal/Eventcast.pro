/**
 * Shared YouTube watch-URL validator. Originally declared inline in
 * `PATCH /api/events/[eventId]/livestream/youtube` (Baseline YTB-003's
 * manual watch-link model); extracted here so the Super Admin YouTube
 * fallback verification route (Milestone N, manual attestation) validates
 * against the exact same rule rather than a second, possibly-diverging
 * copy. Format validation only — never a YouTube API call, never ownership
 * or availability verification.
 */
export function isValidYoutubeWatchUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const host = parsed.hostname.toLowerCase();
  return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
}
