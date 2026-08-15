import { PARTNER_TYPES, type PartnerType } from './partnerFields';

/**
 * The one official event contract (V2.1 baseline CNT-001/CNT-002). This file
 * has two parts:
 *
 * 1. LEGACY CONTRACT (below, unchanged) — `EventFormState`, `EventDbRow`,
 *    `dbRowToFormState`, `formStateToGeneratePayload`, `normalizeGenerateRequest`,
 *    and friends. This is the flat, production-oriented shape the legacy
 *    tab-based admin and the frozen `(admin-v2)/events/new` wizard both
 *    submit to `/api/events/generate`. It is retained as-is, unmodified,
 *    purely so those existing call sites keep compiling and working exactly
 *    as before — it is NOT the baseline-compliant canonical contract and
 *    must not be extended further. Both call sites are superseded once the
 *    Draft-safe path below has a real route.
 *
 * 2. CANONICAL EVENT CONTRACT (bottom of this file) — `EventDraftInput`,
 *    `CanonicalEventRecord`, `PublicEventConfig`, and their mapping
 *    functions. This is the actual V2.1 three-layer contract (CNT-001) for
 *    the Route-Based Draft Event Foundation slice: one authoritative
 *    `scheduledStartAt` (Asia/Kolkata), `templateId`+`templateVersion`, and
 *    an explicit Draft/page-state dimension kept separate from visibility.
 *    Scope is Wedding + the one verified canonical template only (first-slice
 *    positive scope) — no other event type or template is represented here.
 *
 * `events.invitation_video_url` is a scalar Postgres `text` column (confirmed
 * via PostgREST OpenAPI introspection), not `text[]`. Multiple invitation
 * video URLs are therefore stored backward-compatibly as one newline
 * separated string in that same column — never as an array — so existing
 * single-URL rows keep working unchanged.
 */

// ═══════════════════════════════════════════════════════════════════════════
// PART 1 — LEGACY CONTRACT (frozen call sites only; do not extend)
// ═══════════════════════════════════════════════════════════════════════════

// ─── Shared defaults ────────────────────────────────────────────────────────

export const DEFAULT_PRIVACY_STATUS = 'Public (Visible Everywhere)';
export const DEFAULT_TEMPLATE_ID = 'wedding-template-01';

/**
 * Fallback used only when hydrating an existing row whose `privacy_status`
 * is null/undefined (legacy rows predating that column). Deliberately kept
 * distinct from `DEFAULT_PRIVACY_STATUS` — that one is for brand-new events
 * only, and must never silently make an existing/duplicated event more
 * visible than the safe default it always had.
 */
export const LEGACY_ROW_PRIVACY_FALLBACK = 'Unlisted (Link Only)';

// ─── List/scalar conversion helpers ─────────────────────────────────────────

/** Parses a newline-separated string (or an array of strings) into a clean list. */
export function parseNewlineList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split('\n').map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

/** Invitation-video URLs as they should be persisted in the scalar `invitation_video_url` text column. */
export function invitationVideoUrlsToDbValue(value: unknown): string | null {
  const list = parseNewlineList(value);
  return list.length > 0 ? list.join('\n') : null;
}

/** Invitation-video URLs (scalar text, or a legacy array) as the newline-joined string the form displays. */
export function invitationVideoDbValueToFormString(value: unknown): string {
  return parseNewlineList(value).join('\n');
}

/** Gallery URLs (array column, or a legacy newline string) as the newline-joined string the form displays. */
export function galleryUrlsToFormString(value: unknown): string {
  return parseNewlineList(value).join('\n');
}

/** Gallery URLs from the form's newline-separated string into the array the DB column expects. */
export function galleryFormStringToArray(value: unknown): string[] {
  return parseNewlineList(value);
}

// ─── Slug computation (create-only) ─────────────────────────────────────────

export function computeEventSlug(input: {
  groomName?: string | null;
  brideName?: string | null;
  celebrantName?: string | null;
  eventType?: string | null;
}): string {
  const groom = input.groomName || input.celebrantName || 'event';
  const bride = input.brideName || 'family';
  const type = input.eventType || 'wedding';
  return `${groom.toLowerCase().replace(/\s+/g, '-')}-${bride.toLowerCase().replace(/\s+/g, '-')}-${type.toLowerCase()}`;
}

// ─── EventFormState — the shape CreateEventFlow/page.tsx keep in state ──────

export interface EventFormState {
  eventType: string;
  groomName: string;
  brideName: string;
  celebrantName: string;
  customTopTitle: string;
  eventDate: string;
  eventTime: string;
  timerTargetTime: string;
  showTimer: boolean;
  venueName: string;
  venueMapLink: string;
  invitationVideoUrls: string;
  thumbnailUrl: string;
  privacyStatus: string;
  galleryUrls: string;
  vodLink: string;
  templateId: string;
  youtubePrivacy: string;
  customInitials: string;
  hideLoaderPhoto: boolean;
  loaderPhotoUrl: string;
  notes: string;
  youtube_broadcast_id: string;
  youtube_stream_key: string;
  youtube_url: string;
  slug: string;
  photographerName: string;
  photographerPhone: string;
  photographerInsta: string;
  /**
   * Persisted to `events.guest_photo_wall_enabled` and honored by the public
   * render worker (hides the guest-photo-wall section when false). Defaults
   * to true, matching the column's DB default.
   */
  guestPhotoWallEnabled: boolean;
}

// ─── Database row → form-state hydration (edit / duplicate) ────────────────

export interface EventDbRow {
  id?: string;
  event_type?: string | null;
  groom_name?: string | null;
  bride_name?: string | null;
  celebrant_name?: string | null;
  custom_top_title?: string | null;
  event_date?: string | null;
  event_time?: string | null;
  timer_target_time?: string | null;
  show_timer?: boolean | null;
  venue_name?: string | null;
  venue_map_link?: string | null;
  invitation_video_url?: string | string[] | null;
  thumbnail_url?: string | null;
  privacy_status?: string | null;
  gallery_urls?: string[] | string | null;
  vod_link?: string | null;
  template_id?: string | null;
  custom_initials?: string | null;
  hide_loader_photo?: boolean | null;
  loader_photo_url?: string | null;
  notes?: string | null;
  youtube_broadcast_id?: string | null;
  youtube_stream_key?: string | null;
  youtube_url?: string | null;
  slug?: string | null;
  photographer_id?: string | null;
  guest_photo_wall_enabled?: boolean | null;
}

export interface PhotographerRef {
  name?: string | null;
  phone_number?: string | null;
  instagram_url?: string | null;
}

export type HydrationMode = 'edit' | 'duplicate';

export interface DbRowToFormStateOptions {
  mode: HydrationMode;
  photographer?: PhotographerRef | null;
  defaultTemplateId?: string;
}

/**
 * Hydrates form state from a persisted event row for either editing
 * (everything preserved, including the verified slug and YouTube/VOD
 * identifiers) or duplicating (slug, YouTube identifiers, stream key, and
 * VOD link are cleared since they must not be copied onto a new event).
 */
export function dbRowToFormState(
  row: EventDbRow,
  options: DbRowToFormStateOptions
): EventFormState {
  const { mode, photographer = null, defaultTemplateId = DEFAULT_TEMPLATE_ID } = options;
  const isDuplicate = mode === 'duplicate';

  return {
    eventType: row.event_type || 'Wedding',
    groomName: isDuplicate ? `${row.groom_name || ''} (Copy)` : (row.groom_name || ''),
    brideName: row.bride_name || '',
    celebrantName: isDuplicate ? `${row.celebrant_name || ''} (Copy)` : (row.celebrant_name || ''),
    customTopTitle: row.custom_top_title || '',
    eventDate: row.event_date || '',
    eventTime: row.event_time || '',
    timerTargetTime: row.timer_target_time || '',
    showTimer: row.show_timer ?? true,
    venueName: row.venue_name || '',
    venueMapLink: row.venue_map_link || '',
    invitationVideoUrls: invitationVideoDbValueToFormString(row.invitation_video_url),
    thumbnailUrl: row.thumbnail_url || '',
    privacyStatus: row.privacy_status ?? LEGACY_ROW_PRIVACY_FALLBACK,
    galleryUrls: galleryUrlsToFormString(row.gallery_urls),
    // Duplicate mode must not carry over VOD/stream links from the source event.
    vodLink: isDuplicate ? '' : (row.vod_link || ''),
    templateId: row.template_id || defaultTemplateId,
    // Neither edit nor duplicate currently expose a YouTube-privacy control, so
    // this always resolves to the same value the legacy hydration used.
    youtubePrivacy: 'public',
    customInitials: row.custom_initials || '',
    hideLoaderPhoto: row.hide_loader_photo || false,
    loaderPhotoUrl: row.loader_photo_url || '',
    notes: row.notes || '',
    youtube_broadcast_id: isDuplicate ? '' : (row.youtube_broadcast_id || ''),
    youtube_stream_key: isDuplicate ? '' : (row.youtube_stream_key || ''),
    youtube_url: isDuplicate ? '' : (row.youtube_url || ''),
    // Duplicate mode must not carry over the source event's slug — a new one
    // is computed on submit. Edit mode preserves the verified DB slug.
    slug: isDuplicate ? '' : (row.slug || ''),
    photographerName: photographer?.name || '',
    photographerPhone: photographer?.phone_number || '',
    photographerInsta: photographer?.instagram_url || '',
    // Matches the render worker's own `!== false` treatment of this column.
    guestPhotoWallEnabled: row.guest_photo_wall_enabled !== false,
  };
}

// ─── Form state → /api/events/generate request payload ─────────────────────

export interface GeneratePayloadYoutubeDetails {
  youtubeUrl?: string | null;
  broadcastId?: string | null;
  streamKey?: string | null;
}

export interface GeneratePayloadMeta {
  isEditing: boolean;
  editingId?: string | null;
  youtubeDetails?: GeneratePayloadYoutubeDetails | null;
}

export type GenerateEventPayload = Omit<EventFormState, 'galleryUrls'> & {
  isEditing: boolean;
  editingId: string | null;
  galleryUrls: string[];
};

/**
 * Builds the exact request body CreateEventFlow sends to
 * `/api/events/generate`, so the component never maintains its own
 * independent mapping of form state to wire payload.
 */
export function formStateToGeneratePayload(
  formState: EventFormState,
  meta: GeneratePayloadMeta
): GenerateEventPayload {
  const youtubeDetails = meta.youtubeDetails || null;
  return {
    ...formState,
    isEditing: meta.isEditing,
    editingId: meta.editingId ?? null,
    vodLink: youtubeDetails?.youtubeUrl || formState.vodLink,
    youtube_broadcast_id: youtubeDetails?.broadcastId || formState.youtube_broadcast_id,
    youtube_stream_key: youtubeDetails?.streamKey || formState.youtube_stream_key,
    youtube_url: youtubeDetails?.youtubeUrl || formState.youtube_url,
    galleryUrls: galleryFormStringToArray(formState.galleryUrls),
  };
}

// ─── Normalized /api/events/generate server-side input ──────────────────────

export interface NormalizedGenerateInput {
  eventType: string;
  groomName: string;
  brideName: string;
  celebrantName: string;
  customTopTitle: string | null;
  eventDate: string | null;
  eventTime: string | null;
  timerTargetTime: string | null;
  showTimer: boolean;
  venueName: string | null;
  venueMapLink: string | null;
  /** Newline-joined scalar text — never truncated to a single URL. */
  invitationVideoUrl: string | null;
  thumbnailUrl: string | null;
  privacyStatus: string | null;
  galleryUrls: string[];
  vodLink: string | null;
  templateId: string | null;
  photographerId: string | null;
  photographerName: string | null;
  photographerPhone: string | null;
  photographerInsta: string | null;
  baseDesign: unknown;
  youtubeBroadcastId: string | null;
  youtubeStreamKey: string | null;
  youtubeUrl: string | null;
  customInitials: string | null;
  hideLoaderPhoto: boolean;
  loaderPhotoUrl: string | null;
  notes: string | null;
  isEditing: boolean;
  editingId: string | null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Normalizes the raw `/api/events/generate` request body — which may arrive
 * in either snake_case or camelCase, from CreateEventFlow's payload or the
 * legacy page.tsx submit path — into one canonical shape. Every field always
 * resolves to a concrete value (never `undefined`), so downstream DB payload
 * construction can never accidentally emit an `undefined` key that would be
 * dropped or misinterpreted on write.
 */
export function normalizeGenerateRequest(body: Record<string, unknown> | null | undefined): NormalizedGenerateInput {
  const event = (body || {}) as Record<string, any>;

  return {
    eventType: nonEmptyString(event.event_type ?? event.eventType) || 'wedding',
    groomName: nonEmptyString(event.groom_name ?? event.groomName) || '',
    brideName: nonEmptyString(event.bride_name ?? event.brideName) || '',
    celebrantName: nonEmptyString(event.celebrant_name ?? event.celebrantName) || '',
    customTopTitle: nonEmptyString(event.custom_top_title ?? event.customTopTitle),
    eventDate: nonEmptyString(event.event_date ?? event.eventDate),
    eventTime: nonEmptyString(event.event_time ?? event.eventTime),
    timerTargetTime: nonEmptyString(event.timer_target_time ?? event.timerTargetTime),
    showTimer: event.show_timer ?? event.showTimer ?? true,
    venueName: nonEmptyString(event.venue_name ?? event.venueName),
    venueMapLink: nonEmptyString(event.venue_map_link ?? event.venueMapLink),
    invitationVideoUrl: invitationVideoUrlsToDbValue(
      event.invitation_video_url ?? event.invitationVideoUrl ?? event.invitationVideoUrls
    ),
    thumbnailUrl: nonEmptyString(event.thumbnail_url ?? event.thumbnailUrl),
    privacyStatus: nonEmptyString(event.privacy_status ?? event.privacyStatus),
    galleryUrls: parseNewlineList(event.gallery_urls ?? event.galleryUrls),
    vodLink: nonEmptyString(event.vod_link ?? event.vodLink),
    templateId: nonEmptyString(event.template_id ?? event.templateId),
    photographerId: nonEmptyString(event.photographer_id ?? event.photographerId),
    photographerName: nonEmptyString(event.photographerName ?? event.photographer_name),
    photographerPhone: nonEmptyString(event.photographerPhone ?? event.photographer_phone),
    photographerInsta: nonEmptyString(event.photographerInsta ?? event.photographer_insta),
    baseDesign: event.base_design ?? event.baseDesign ?? null,
    youtubeBroadcastId: nonEmptyString(event.youtube_broadcast_id ?? event.youtubeBroadcastId),
    youtubeStreamKey: nonEmptyString(event.youtube_stream_key ?? event.youtubeStreamKey),
    youtubeUrl: nonEmptyString(event.youtube_url ?? event.youtubeUrl),
    customInitials: nonEmptyString(event.custom_initials ?? event.customInitials),
    hideLoaderPhoto: event.hide_loader_photo ?? event.hideLoaderPhoto ?? false,
    loaderPhotoUrl: nonEmptyString(event.loader_photo_url ?? event.loaderPhotoUrl),
    notes: nonEmptyString(event.notes),
    isEditing: Boolean(event.isEditing && event.editingId),
    editingId: nonEmptyString(event.editingId),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 2 — CANONICAL EVENT CONTRACT (V2.1 Route-Based Draft Event Foundation)
// ═══════════════════════════════════════════════════════════════════════════
//
// Three distinct layers (baseline CNT-001):
//   EventDraftInput      — provider-entered Draft form data (this slice only
//                           captures what the verified Wedding path needs).
//   CanonicalEventRecord — the validated internal model. Owns the one
//                           authoritative `scheduledStartAt`, the template
//                           identity+version, and the Draft/page-state and
//                           visibility dimensions kept separate from each
//                           other (baseline EVT-001).
//   PublicEventConfig    — the redacted, guest-safe projection. Structurally
//                           excludes studioId, pageState, and visibility —
//                           there is no field to accidentally leak.
//
// Fixed V1 timezone (baseline CRT-006): every Draft input time is implicitly
// Asia/Kolkata; no timezone selector exists or is planned for this slice.

export const EVENT_TIMEZONE = 'Asia/Kolkata';
const IST_FIXED_OFFSET = '+05:30';

/** The only event type this slice represents. Other types are out of scope. */
export const CANONICAL_EVENT_TYPES = ['Wedding'] as const;
export type CanonicalEventType = (typeof CANONICAL_EVENT_TYPES)[number];

export interface CanonicalTemplateDescriptor {
  templateId: string;
  templateVersion: string;
  eventTypes: readonly CanonicalEventType[];
}

/**
 * The only template compatible with the first bounded Draft slice — the
 * verified "TLF-001" wedding template. `template_id` here is assumed to be
 * the existing `wedding-template-01` asset already deployed as the sole
 * production-verified template (see `workers/render-event-page/templates/
 * wedding-template-01/`); reconcile this mapping if TLF-001 is later found
 * to refer to a different `template_id` string. `templateVersion` is a
 * first placeholder release identifier — full canonical template-package
 * versioning (TPL-001/TPL-004) is later work, not required by this slice,
 * which only needs *a* stable version value to store and pin.
 */
export const CANONICAL_TEMPLATES: Record<string, CanonicalTemplateDescriptor> = {
  'wedding-template-01': {
    templateId: 'wedding-template-01',
    templateVersion: '1.0.0',
    eventTypes: ['Wedding'],
  },
};

/**
 * Resolves a `templateId`+`eventType` pair against the canonical template
 * registry. Returns `null` — never a fallback template — on any mismatch,
 * per baseline CRT-003 ("no silent template fallback").
 */
export function resolveCanonicalTemplate(
  templateId: string,
  eventType: string
): CanonicalTemplateDescriptor | null {
  const template = CANONICAL_TEMPLATES[templateId];
  if (!template) return null;
  if (!(template.eventTypes as readonly string[]).includes(eventType)) return null;
  return template;
}

/**
 * Builds the authoritative `scheduled_start_at` timestamp (ISO 8601, fixed
 * `+05:30` offset) from an Asia/Kolkata wall-clock `datetime-local` value
 * (`YYYY-MM-DDTHH:mm`, e.g. from an `<input type="datetime-local">`). Throws
 * on any other shape rather than guessing — callers (see
 * `draftInputToCanonicalRecord`) turn that into a field-level validation
 * error instead of persisting an ambiguous timestamp.
 */
export function combineIstDateTimeToScheduledStartAt(dateTimeLocal: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dateTimeLocal)) {
    throw new Error(`Invalid scheduled_start_at input: expected "YYYY-MM-DDTHH:mm", got "${dateTimeLocal}"`);
  }
  const isoWithOffset = `${dateTimeLocal}:00${IST_FIXED_OFFSET}`;
  if (Number.isNaN(new Date(isoWithOffset).getTime())) {
    throw new Error(`Invalid scheduled_start_at input: "${dateTimeLocal}" is not a real date/time`);
  }
  return isoWithOffset;
}

const ISO_OFFSET_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const IST_OFFSET_MINUTES = 5 * 60 + 30;

/**
 * Inverse of `combineIstDateTimeToScheduledStartAt`: recovers the
 * Asia/Kolkata wall-clock `datetime-local` value from an authoritative
 * `scheduledStartAt` for prefilling the edit form.
 *
 * `scheduledStartAt` is stored as a Postgres `timestamptz`, which normalizes
 * the offset on read (Supabase returns it as `+00:00`, not the `+05:30` it
 * was written with) — the *instant* is unchanged, only its printed offset.
 * This accepts any valid explicit-offset ISO-8601 timestamp representing
 * that instant and converts it to Asia/Kolkata explicitly via the fixed
 * +05:30 offset (India has no DST), rather than relying on the host's local
 * timezone.
 */
export function scheduledStartAtToIstDateTimeLocal(scheduledStartAt: string): string {
  const match = ISO_OFFSET_TIMESTAMP.exec(scheduledStartAt);
  if (!match) {
    throw new Error(
      `Invalid scheduledStartAt: expected an ISO-8601 timestamp with an explicit offset, got "${scheduledStartAt}"`
    );
  }

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const second = Number(secondStr);

  // Date.UTC silently normalizes out-of-range fields (e.g. day 32 rolls into
  // the next month) instead of failing, so an invalid calendar date would
  // otherwise be accepted and silently reinterpreted. Round-tripping through
  // the UTC getters and comparing back to the parsed fields catches that.
  const asUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(asUtcMs);
  const isValidCalendarDate =
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day &&
    check.getUTCHours() === hour &&
    check.getUTCMinutes() === minute &&
    check.getUTCSeconds() === second;

  const instantMs = Date.parse(scheduledStartAt);
  if (!isValidCalendarDate || Number.isNaN(instantMs)) {
    throw new Error(`Invalid scheduledStartAt: "${scheduledStartAt}" is not a real date/time`);
  }

  const istMs = instantMs + IST_OFFSET_MINUTES * 60 * 1000;
  const ist = new Date(istMs);
  const yyyy = String(ist.getUTCFullYear()).padStart(4, '0');
  const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(ist.getUTCDate()).padStart(2, '0');
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const min = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

export interface DerivedLegacySchedule {
  /** `YYYY-MM-DD`, Asia/Kolkata calendar date. */
  eventDate: string;
  /** `h:mm AM/PM`, Asia/Kolkata clock time — legacy display-string mirror. */
  eventTime: string;
  /** `HH:mm` 24-hour, Asia/Kolkata clock time — legacy countdown-target mirror. */
  timerTargetTime: string;
}

/**
 * Derives the legacy `event_date`/`event_time`/`timer_target_time` mirror
 * values from the one authoritative `scheduledStartAt`. One-directional only
 * — nothing in the canonical model ever reads these back as an input, so
 * they cannot become competing authorities (baseline CNT-003/§6).
 */
export function deriveLegacySchedule(scheduledStartAt: string): DerivedLegacySchedule {
  const parsed = new Date(scheduledStartAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid scheduledStartAt: "${scheduledStartAt}"`);
  }

  const eventDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: EVENT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed);

  const eventTime = new Intl.DateTimeFormat('en-US', {
    timeZone: EVENT_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(parsed);

  const timerTargetTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: EVENT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed);

  return { eventDate, eventTime, timerTargetTime };
}

/**
 * Provider-entered Draft form data. Deliberately narrow: only the
 * groom/bride participant fields the verified Wedding path needs (baseline
 * "does not redesign the full participant model in this task") — no
 * celebrant/other-event-type fields, no optional modules beyond the one
 * already-established Guest Photo Wall toggle.
 */
export interface EventDraftInput {
  eventType: CanonicalEventType;
  groomName: string;
  brideName: string;
  /** Asia/Kolkata wall-clock `datetime-local` value; see combineIstDateTimeToScheduledStartAt. */
  scheduledStartAtLocal: string;
  venueName: string;
  /** Editable, tenant-scoped (unique per studio, not globally) — validated by the persistence layer. */
  slug: string;
  templateId: string;
}

export type EventPageState = 'draft' | 'published';
export type EventPublicVisibility = 'public' | 'unlisted';

/**
 * The validated internal model. `pageState` and `visibility` are separate
 * dimensions (baseline EVT-001) — a Draft is never represented by
 * overloading `visibility` alone, and this type makes that structurally
 * explicit rather than relying on a naming convention.
 */
export interface CanonicalEventRecord {
  id: string;
  studioId: string;
  slug: string;
  eventType: CanonicalEventType;
  groomName: string;
  brideName: string;
  /** The one authoritative timestamp (baseline CNT-003), ISO 8601 with a fixed +05:30 offset. */
  scheduledStartAt: string;
  venueName: string;
  templateId: string;
  templateVersion: string;
  pageState: EventPageState;
  visibility: EventPublicVisibility;
  guestPhotoWallEnabled: boolean;
  /**
   * The manually-assigned SEO/social preview thumbnail (baseline SEO-001),
   * reusing the existing legacy `thumbnail_url` column. Persistence-layer-
   * owned like `pageState`/`visibility` — never derivable from Draft Input,
   * see `DraftCanonicalFields`. Null until a future assignment flow sets it.
   */
  thumbnailUrl: string | null;
}

// ─── Public Event Credit projection (Baseline V2.1 PART-003/PART-005/PART-006) ─
//
// The public-safe field set is deliberately narrow: business/name identity,
// public role label, logo/public links, and primary/additional ordering —
// exactly what the baseline names as appropriate to render publicly.
// `partners.contact_person`/`phone`/`whatsapp`/`city` and `internal_notes`
// are never represented here; the baseline does not name them as
// public-facing, and PART-003 requires internal client information to stay
// separate from public Event Credits.

/** The only role labels an Event Credit can carry — the same closed set as `partners.partner_type`. */
export type EventCreditRoleLabel = PartnerType;
export const EVENT_CREDIT_ROLE_LABELS = PARTNER_TYPES;

/** Public-safe identity fields copied from a Partner into a rendered Event Credit. */
export interface PublicEventCreditPartner {
  businessName: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  youtubeUrl: string | null;
}

/**
 * An editable Event Credit reference joined with its Partner's public-safe
 * fields — the input shape `projectPublicEventCredits` expects. Not itself
 * public data (it is what a caller builds from the editable `event_credits`
 * + `partners` tables before redaction).
 */
export interface EventCreditWithPartner {
  roleLabel: EventCreditRoleLabel;
  isPrimary: boolean;
  partner: PublicEventCreditPartner;
}

/** The guest-safe, redacted public Event Credit (baseline PART-005/PART-006). */
export interface PublicEventCredit extends PublicEventCreditPartner {
  roleLabel: EventCreditRoleLabel;
  isPrimary: boolean;
}

/**
 * Projects editable Event Credit + Partner references into the public-safe
 * Event Credit list, with the one primary credit first (baseline PART-005)
 * and any additional credits following in the order given. Callers should
 * supply credits already ordered primary-first / `created_at` ascending
 * (matching `GET /api/events/[eventId]/credits`) — this function only
 * re-groups by `isPrimary`, it does not re-derive ordering within either
 * group.
 */
export function projectPublicEventCredits(credits: EventCreditWithPartner[]): PublicEventCredit[] {
  const primary = credits.filter((c) => c.isPrimary);
  const additional = credits.filter((c) => !c.isPrimary);
  return [...primary, ...additional].map((c) => ({
    businessName: c.partner.businessName,
    roleLabel: c.roleLabel,
    isPrimary: c.isPrimary,
    logoUrl: c.partner.logoUrl,
    websiteUrl: c.partner.websiteUrl,
    instagramUrl: c.partner.instagramUrl,
    facebookUrl: c.partner.facebookUrl,
    youtubeUrl: c.partner.youtubeUrl,
  }));
}

/** The guest-safe, redacted projection. No secret, token, or internal field is representable here. */
export interface PublicEventConfig {
  id: string;
  slug: string;
  eventType: CanonicalEventType;
  groomName: string;
  brideName: string;
  scheduledStartAt: string;
  venueName: string;
  templateId: string;
  templateVersion: string;
  guestPhotoWallEnabled: boolean;
  thumbnailUrl: string | null;
  eventCredits: PublicEventCredit[];
}

export interface DraftInputValidationError {
  field: keyof EventDraftInput;
  message: string;
}

/**
 * The fields `draftInputToCanonicalRecord` can resolve from Draft Input
 * alone. `id`, `studioId` (server-assigned identity) and `pageState`,
 * `visibility` (persistence-layer-owned safety dimensions — see the
 * 0029 migration) are deliberately never produced here: a Draft is always
 * inserted as `pageState: 'draft'`, `visibility: 'unlisted'` by the
 * persistence layer itself, never derived from client input. `thumbnailUrl`
 * is excluded for the same reason (baseline SEO-001): it is set by a future
 * manual-assignment flow, never by the Draft Create/Edit payload.
 */
export type DraftCanonicalFields = Omit<
  CanonicalEventRecord,
  'id' | 'studioId' | 'pageState' | 'visibility' | 'thumbnailUrl'
>;

export type DraftToCanonicalResult =
  | { ok: true; record: DraftCanonicalFields }
  | { ok: false; error: DraftInputValidationError };

/** Maps validated Draft Input into the canonical record's Draft-derivable fields. */
export function draftInputToCanonicalRecord(input: EventDraftInput): DraftToCanonicalResult {
  const template = resolveCanonicalTemplate(input.templateId, input.eventType);
  if (!template) {
    return {
      ok: false,
      error: {
        field: 'templateId',
        message: `Template "${input.templateId}" is not available for event type "${input.eventType}".`,
      },
    };
  }

  const groomName = input.groomName.trim();
  if (!groomName) {
    return { ok: false, error: { field: 'groomName', message: "Groom's name is required." } };
  }

  const brideName = input.brideName.trim();
  if (!brideName) {
    return { ok: false, error: { field: 'brideName', message: "Bride's name is required." } };
  }

  const venueName = input.venueName.trim();
  if (!venueName) {
    return { ok: false, error: { field: 'venueName', message: 'Venue is required.' } };
  }

  const slug = input.slug.trim();
  if (!slug) {
    return { ok: false, error: { field: 'slug', message: 'Slug is required.' } };
  }

  let scheduledStartAt: string;
  try {
    scheduledStartAt = combineIstDateTimeToScheduledStartAt(input.scheduledStartAtLocal);
  } catch {
    return {
      ok: false,
      error: { field: 'scheduledStartAtLocal', message: 'A valid scheduled date and time is required.' },
    };
  }

  return {
    ok: true,
    record: {
      slug,
      eventType: input.eventType,
      groomName,
      brideName,
      scheduledStartAt,
      venueName,
      templateId: template.templateId,
      templateVersion: template.templateVersion,
      guestPhotoWallEnabled: true,
    },
  };
}

/**
 * Projects a Canonical Event Record into the guest-safe Public Event Config.
 * This function performs field redaction only — it does not itself decide
 * whether a record is allowed to be public. Callers must only invoke it once
 * `pageState`/`visibility` have already been confirmed publishable (e.g. by
 * an RLS-filtered query or an explicit check upstream). `eventCredits` must
 * already be the redacted output of `projectPublicEventCredits` — this
 * function does not itself read or redact Partner data.
 */
export function canonicalRecordToPublicConfig(
  record: CanonicalEventRecord,
  eventCredits: PublicEventCredit[] = []
): PublicEventConfig {
  return {
    id: record.id,
    slug: record.slug,
    eventType: record.eventType,
    groomName: record.groomName,
    brideName: record.brideName,
    scheduledStartAt: record.scheduledStartAt,
    venueName: record.venueName,
    templateId: record.templateId,
    templateVersion: record.templateVersion,
    guestPhotoWallEnabled: record.guestPhotoWallEnabled,
    thumbnailUrl: record.thumbnailUrl,
    eventCredits,
  };
}

// ─── Canonical → wedding-template-01 renderer adapter (TPL-006) ────────────
//
// A typed legacy adapter (baseline TPL-006) from the canonical contract into
// the row shape the one shared `renderEvent` function (`@/lib/
// weddingTemplateRenderer`) expects — the same function the public Worker
// imports from this project tree, so Admin Draft preview and public
// production render through one canonical model rather than a second,
// divergent interpretation of the template (baseline TPL-003/CRT-011).

/**
 * The minimal Canonical Event Record fields this adapter needs. Deliberately
 * a `Pick`, not the full record: the Draft slice still never carries
 * gallery, invitation video, YouTube, or venue-map data, so the renderer's
 * own null-handling for those optional fields applies exactly as it does
 * for a real published event that simply hasn't set them. `thumbnailUrl`
 * (baseline SEO-001) is the one exception — it is threaded through so the
 * shared renderer's existing `og:image`/`twitter:image` population works.
 */
export type WeddingTemplatePreviewInput = Pick<
  CanonicalEventRecord,
  | 'id'
  | 'studioId'
  | 'slug'
  | 'eventType'
  | 'groomName'
  | 'brideName'
  | 'scheduledStartAt'
  | 'venueName'
  | 'templateId'
  | 'guestPhotoWallEnabled'
  | 'thumbnailUrl'
>;

/**
 * Projects the canonical fields into the shared renderer's row shape.
 * `event_date`/`event_time`/`timer_target_time` are re-derived here from the
 * one authoritative `scheduledStartAt` (baseline CNT-003) rather than read
 * back from any stored legacy-mirror column, so preview can never drift from
 * the canonical schedule the Draft was actually saved with.
 *
 * `event_time` is deliberately populated from `legacy.timerTargetTime`
 * (24-hour `HH:mm`), not `legacy.eventTime` (a 12-hour `h:mm AM/PM`
 * *display*-string mirror — see `DerivedLegacySchedule`). The shared
 * renderer's own `formatTime()` (`@/lib/weddingTemplateRenderer`) expects a
 * 24-hour `HH:mm` input — matching what the legacy `<input type="time">`
 * Create Event form always submitted — and reformats it into the 12-hour
 * hero display string itself. Feeding it the 12-hour display string instead
 * double-formats it (e.g. "6:30 PM" -> "6:30 PM AM"). Both values are
 * derived from the same authoritative `scheduledStartAt`, so this is not a
 * second time source — just the correctly-shaped one for this consumer.
 */
export function canonicalRecordToWeddingTemplateRenderRow(
  record: WeddingTemplatePreviewInput,
  eventCredits: PublicEventCredit[] = []
) {
  const legacy = deriveLegacySchedule(record.scheduledStartAt);
  return {
    id: record.id,
    slug: record.slug,
    studio_id: record.studioId,
    template_id: record.templateId,
    event_type: record.eventType,
    groom_name: record.groomName,
    bride_name: record.brideName,
    event_date: legacy.eventDate,
    event_time: legacy.timerTargetTime,
    timer_target_time: legacy.timerTargetTime,
    venue_name: record.venueName,
    guest_photo_wall_enabled: record.guestPhotoWallEnabled,
    thumbnail_url: record.thumbnailUrl,
    event_credits: eventCredits,
  };
}

/**
 * Maps the primary Public Event Credit (if any) into the existing legacy
 * `PhotographerRow` shape the shared renderer's footer already displays
 * (studio-name label + logo). This deliberately reuses the current TLF-001
 * footer visual language for the one Partner/Event Credit slot that already
 * exists, instead of adding a second rendered credit surface (baseline:
 * "keep the change minimal", "do not redesign the whole footer") — the full
 * ordered `eventCredits` list (including any additional credits) is threaded
 * separately into `window.WEDDING_CONFIG.eventCredits` for future footer
 * work. `phone_number` is never populated here: the public Event Credit
 * projection deliberately excludes Partner contact fields (see
 * `projectPublicEventCredits`), so the footer's phone link stays hidden for
 * a Partner/Event Credit-sourced primary, matching its own null-hiding
 * behavior for a photographer with no phone. `id` is a required legacy
 * field with no public meaning here, so it is always `''`.
 */
export function primaryPublicEventCreditToPhotographerRow(eventCredits: PublicEventCredit[]) {
  const primary = eventCredits.find((c) => c.isPrimary);
  if (!primary) return null;
  return {
    id: '',
    name: primary.businessName,
    studio_name: primary.businessName,
    logo_url: primary.logoUrl ?? '',
    instagram: primary.instagramUrl ?? '',
    website: primary.websiteUrl ?? '',
  };
}
