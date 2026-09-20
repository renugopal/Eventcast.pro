import type { PublicEventCredit } from './eventContract';

/**
 * Pure helpers for the post-Publish "Update published credits" capability.
 *
 * The frozen `events.published_credits` snapshot (migration `0030`, baseline
 * PART-006) is never rewritten automatically when a Partner or Event Credit
 * is edited. Instead the provider takes one explicit action, and the server
 * re-derives the snapshot from the current `event_credits` + `partners` rows
 * through the very same `projectPublicEventCredits()` the Publish route uses.
 * These helpers only *compare* two already-projected lists; they never
 * project anything themselves, so there is exactly one projection.
 */

// The complete public-safe field set of a projected credit — kept explicit so
// a future field added to `PublicEventCredit` must also be added here (the
// type check below fails otherwise), rather than being silently ignored by
// the comparison.
const PUBLIC_CREDIT_FIELDS: readonly (keyof PublicEventCredit)[] = [
  'businessName',
  'roleLabel',
  'isPrimary',
  'logoUrl',
  'websiteUrl',
  'instagramUrl',
  'facebookUrl',
  'youtubeUrl',
];

function creditsMatch(a: PublicEventCredit, b: PublicEventCredit): boolean {
  return PUBLIC_CREDIT_FIELDS.every((field) => (a[field] ?? null) === (b[field] ?? null));
}

/**
 * Order-sensitive equality of two projected credit lists. Order matters
 * because the public page renders credits in snapshot order (primary first,
 * then additional in creation order) — a reordering is a visible change.
 *
 * A `null`/non-array `frozen` value (an unfrozen row, or an unexpectedly
 * malformed stored value) never equals a current list, so callers fail
 * toward "an update is needed" rather than toward "nothing to do".
 */
export function publishedCreditsEqual(frozen: unknown, current: PublicEventCredit[]): boolean {
  if (!Array.isArray(frozen)) return false;
  if (frozen.length !== current.length) return false;
  return frozen.every((entry, index) => {
    if (!entry || typeof entry !== 'object') return false;
    return creditsMatch(entry as PublicEventCredit, current[index]);
  });
}

export interface PublishedCreditsStatus {
  /** `true` only for a Published, non-archived event whose snapshot differs from its current credits. */
  needsUpdate: boolean;
  /** `null` when the row has never been frozen (i.e. still a Draft). */
  frozenCount: number | null;
  currentCount: number;
}

/**
 * Derives the provider-facing status. Only a Published, non-archived event
 * can ever report `needsUpdate` — a Draft has nothing to refresh (Publish
 * itself freezes the snapshot), and an archived event must be restored
 * before any published-page change is allowed, mirroring
 * `PATCH /api/events/[eventId]/details`.
 */
export function derivePublishedCreditsStatus(input: {
  pageState: string | null;
  archivedAt: string | null;
  frozen: unknown;
  current: PublicEventCredit[];
}): PublishedCreditsStatus {
  const frozenCount = Array.isArray(input.frozen) ? input.frozen.length : null;
  const eligible = input.pageState === 'published' && !input.archivedAt;
  return {
    needsUpdate: eligible && !publishedCreditsEqual(input.frozen, input.current),
    frozenCount,
    currentCount: input.current.length,
  };
}
