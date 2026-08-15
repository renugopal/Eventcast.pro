/**
 * Shared field helpers for the Partner directory API
 * (`/api/partners`, `/api/partners/[partnerId]`), matching the columns in
 * migration `0030_partner_event_credit_foundation_schema.sql`.
 */

export const PARTNER_TYPES = ['photographer', 'studio', 'event_manager', 'client', 'venue', 'other'] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];

export function isPartnerType(value: unknown): value is PartnerType {
  return typeof value === 'string' && (PARTNER_TYPES as readonly string[]).includes(value);
}

// Client (camelCase) body key -> `partners` column (snake_case), for the
// optional, nullable text fields shared by create and update.
export const PARTNER_OPTIONAL_TEXT_FIELDS: ReadonlyArray<[string, string]> = [
  ['contactPerson', 'contact_person'],
  ['phone', 'phone'],
  ['whatsapp', 'whatsapp'],
  ['city', 'city'],
  ['instagramUrl', 'instagram_url'],
  ['facebookUrl', 'facebook_url'],
  ['youtubeUrl', 'youtube_url'],
  ['websiteUrl', 'website_url'],
  ['logoUrl', 'logo_url'],
  ['internalNotes', 'internal_notes'],
];
