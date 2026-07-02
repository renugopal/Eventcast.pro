/**
 * Shared web SEO format for wedding-template-01.
 * Title:  Chinna ❤️ Eswari Wedding Live | 27th June
 * Desc:   Join us live and be part of this beautiful wedding celebration filled with love, joy, and cherished memories.
 */
function formatShortEventDate(rawDate) {
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

function generateWeddingWebSEO({ groom, bride, eventType, eventDate }) {
  const type = (eventType || 'Wedding').trim();
  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
  const typeLower = typeLabel.toLowerCase();
  const shortDate = formatShortEventDate(eventDate);
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatShortEventDate, generateWeddingWebSEO };
}
if (typeof globalThis !== 'undefined') {
  globalThis.formatShortEventDate = formatShortEventDate;
  globalThis.generateWeddingWebSEO = generateWeddingWebSEO;
}
