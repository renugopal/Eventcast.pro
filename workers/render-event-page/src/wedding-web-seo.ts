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
  const separator = typeLower.includes('wedding') ? '❤️' : '✨';

  const title = isSinglePerson
    ? `${groom} ${separator} ${typeLabel} Live${dateSuffix}`
    : `${groom} ${separator} ${bride} ${typeLabel} Live${dateSuffix}`;

  const description =
    `Join us live and be part of this beautiful ${typeLower} celebration filled with love, joy, and cherished memories.`;

  return { title, description };
}
