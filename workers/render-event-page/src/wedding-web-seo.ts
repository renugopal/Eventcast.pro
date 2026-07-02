/**
 * Web SEO format for wedding-template-01 (keep in sync with wedding-template-01/wedding-web-seo.js)
 */
export function formatShortEventDate(rawDate: string): string {
  if (!rawDate) return '';
  const [y, m, d] = rawDate.split('-').map(Number);
  if (!y || !m || !d) return '';
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  const day = dateObj.getUTCDate();
  const suffix =
    day % 10 === 1 && day !== 11 ? 'st' :
    day % 10 === 2 && day !== 12 ? 'nd' :
    day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  const month = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(dateObj);
  return `${day}${suffix} ${month}`;
}

export function generateWeddingWebSEO({
  groom,
  bride,
  eventType,
  eventDate,
}: {
  groom: string;
  bride?: string;
  eventType?: string;
  eventDate?: string;
}): { title: string; description: string } {
  const type = (eventType || 'Wedding').trim();
  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
  const typeLower = typeLabel.toLowerCase();
  const shortDate = formatShortEventDate(eventDate ?? '');
  const dateSuffix = shortDate ? ` | ${shortDate}` : '';
  const isSinglePerson = !bride || bride.toLowerCase() === 'family';
  const separator = typeLower.includes('wedding') || typeLower.includes('engagement') ? '❤️' : '✨';

  const title = isSinglePerson
    ? `${groom} ${separator} ${typeLabel} Live${dateSuffix}`
    : `${groom} ${separator} ${bride} ${typeLabel} Live${dateSuffix}`;

  const description = typeLower.includes('engagement')
    ? 'Join us live and be a part of this beautiful engagement celebration as the couple begins a wonderful new chapter in their lives.'
    : `Join us live and be part of this beautiful ${typeLower} celebration filled with love, joy, and cherished memories.`;

  return { title, description };
}

/** Web SEO for single-person ceremony templates (dhoti, halfsaree, etc.) */
export function generateCeremonyWebSEO({
  name,
  eventType,
  eventDate,
  venueMain,
  venueSubtext,
}: {
  name: string;
  eventType?: string;
  eventDate?: string;
  venueMain?: string;
  venueSubtext?: string;
}): { title: string; description: string } {
  const type = (eventType || 'Ceremony').trim();
  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
  const shortDate = formatShortEventDate(eventDate ?? '');
  const venuePart = [venueMain, venueSubtext].filter(Boolean).join(', ');
  const possessive = name.endsWith('s') ? `${name}'` : `${name}'s`;

  const title = shortDate
    ? `✨ ${name} ${typeLabel} Live | ${shortDate}`
    : `✨ ${name} ${typeLabel} Live`;

  const description =
    venuePart && shortDate
      ? `Join us live for ${possessive} ${typeLabel} at ${venuePart} on ${shortDate}.`
      : `Join us live to celebrate this beautiful traditional occasion filled with blessings, happiness, culture, and family moments.`;

  return { title, description };
}

/** Loader / intro splash label for ceremony templates */
export function getLoaderLabel({
  groom,
  bride,
  eventType,
  customInitials,
}: {
  groom: string;
  bride?: string;
  eventType?: string;
  customInitials?: string;
}): string {
  const custom = (customInitials || '').trim();
  if (custom.length > 2) return custom;

  const isSingle = !bride || bride.toLowerCase() === 'family';
  if (isSingle && eventType) {
    const parts = groom.trim().split(/\s+/).filter(Boolean);
    const shortName = parts[parts.length - 1] || groom;
    const typeLabel = eventType
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
    return `${shortName} ${typeLabel}`;
  }

  return custom || groom;
}
