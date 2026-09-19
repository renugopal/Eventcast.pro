/**
 * The one public event page URL format used across the app (matches the
 * existing hardcoded strings in `events/page.tsx` and `livestreams/page.tsx`
 * exactly: `https://eventcast.pro/events/{slug}`). This package introduces it
 * only for the two Event Workspace files it touches (Overview, Event Page);
 * the pre-existing hardcoded call sites are left untouched, matching the
 * "preserve unrelated pre-existing files exactly" scope boundary.
 */
const PUBLIC_EVENT_BASE_URL = 'https://eventcast.pro/events';

export function publicEventUrl(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return `${PUBLIC_EVENT_BASE_URL}/${slug}`;
}
