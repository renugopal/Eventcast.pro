import { NextResponse } from 'next/server';

/**
 * Server-only helper for verifying that a resource belongs to the
 * requesting studio before it is read, mutated, or used to trigger any
 * external side effect (Restreamer, YouTube, Cloudinary, GitHub, R2, etc).
 *
 * Usage — add this immediately after requireAdmin(), before touching any
 * other table or external service:
 *
 *   const ownership = await getOwnedEventById(db, eventId, auth.studioId);
 *   if (isOwnershipError(ownership)) return ownership.error;
 *   const event = ownership.event;
 */

// Minimal shape we need from a Supabase client — kept intentionally loose so
// any of the differently-constructed clients in this codebase (and test
// mocks) satisfy it without pulling in the full generic SupabaseClient type.
// Modeled structurally on the exact chain used below:
// db.from(table).select(columns).eq(a, b).eq(c, d).maybeSingle().
interface OwnershipQueryResult {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
}

interface OwnershipQueryBuilder {
  select: (columns: string) => OwnershipFilterBuilderStage1;
}

interface OwnershipFilterBuilderStage1 {
  eq: (column: string, value: unknown) => OwnershipFilterBuilderStage2;
}

interface OwnershipFilterBuilderStage2 {
  eq: (column: string, value: unknown) => OwnershipSingleBuilder;
}

interface OwnershipSingleBuilder {
  maybeSingle: () => PromiseLike<OwnershipQueryResult>;
}

interface QueryableDb {
  from: (table: string) => OwnershipQueryBuilder;
}

export type OwnershipResult<T = Record<string, unknown>> =
  | { event: T; error?: undefined }
  | { event?: undefined; error: NextResponse };

export function isOwnershipError<T>(
  result: OwnershipResult<T>
): result is { event?: undefined; error: NextResponse } {
  return result.error !== undefined;
}

/**
 * A single generic response used for both "resource does not exist" and
 * "resource belongs to a different studio". Keeping these identical prevents
 * cross-tenant probing from being able to distinguish the two cases.
 */
function eventNotFoundResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: 'Event not found' },
    { status: 404 }
  );
}

/**
 * Loads an event scoped to both `id` and `studioId` in a single query, so a
 * caller can never load a row that belongs to another studio.
 */
export async function getOwnedEventById<T = Record<string, unknown>>(
  db: unknown,
  eventId: string | null | undefined,
  studioId: string | null | undefined,
  columns: string = '*'
): Promise<OwnershipResult<T>> {
  if (!eventId || !studioId) {
    return { error: eventNotFoundResponse() };
  }

  // Centralized cast: asserting once here (rather than typing `db` as
  // QueryableDb at each route call site) avoids forcing TypeScript to
  // structurally instantiate Supabase's deeply generic client type
  // wherever this helper is called.
  const queryableDb = db as QueryableDb;

  const { data, error } = await queryableDb
    .from('events')
    .select(columns)
    .eq('id', eventId)
    .eq('studio_id', studioId)
    .maybeSingle();

  if (error || !data) {
    return { error: eventNotFoundResponse() };
  }

  return { event: data as unknown as T };
}

/**
 * Same generic "does not exist / belongs to another studio" response, scoped
 * to Partner directory lookups.
 */
function partnerNotFoundResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: 'Partner not found' },
    { status: 404 }
  );
}

/**
 * Loads a partner scoped to both `id` and `studioId` in a single query, so a
 * caller can never load a row that belongs to another studio.
 */
export async function getOwnedPartnerById<T = Record<string, unknown>>(
  db: unknown,
  partnerId: string | null | undefined,
  studioId: string | null | undefined,
  columns: string = '*'
): Promise<OwnershipResult<T>> {
  if (!partnerId || !studioId) {
    return { error: partnerNotFoundResponse() };
  }

  const queryableDb = db as QueryableDb;

  const { data, error } = await queryableDb
    .from('partners')
    .select(columns)
    .eq('id', partnerId)
    .eq('studio_id', studioId)
    .maybeSingle();

  if (error || !data) {
    return { error: partnerNotFoundResponse() };
  }

  return { event: data as unknown as T };
}

/**
 * Same generic "does not exist / belongs to another studio" response, scoped
 * to Event Credit lookups. event_credits has no studio_id column of its own
 * (see migration 0030) — tenant ownership is always proven by the caller
 * first resolving the owning Event via getOwnedEventById, then scoping this
 * lookup to that already-owned eventId.
 */
function eventCreditNotFoundResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: 'Event credit not found' },
    { status: 404 }
  );
}

/**
 * Loads an Event Credit scoped to both `id` and the already-owned `eventId`
 * in a single query, so a caller can never load a credit belonging to a
 * different event (and therefore a different studio).
 */
export async function getEventCreditById<T = Record<string, unknown>>(
  db: unknown,
  creditId: string | null | undefined,
  eventId: string | null | undefined,
  columns: string = '*'
): Promise<OwnershipResult<T>> {
  if (!creditId || !eventId) {
    return { error: eventCreditNotFoundResponse() };
  }

  const queryableDb = db as QueryableDb;

  const { data, error } = await queryableDb
    .from('event_credits')
    .select(columns)
    .eq('id', creditId)
    .eq('event_id', eventId)
    .maybeSingle();

  if (error || !data) {
    return { error: eventCreditNotFoundResponse() };
  }

  return { event: data as unknown as T };
}

/**
 * Same generic "does not exist / belongs to another studio" response, scoped
 * to Guest Memories (guest_photos) lookups. guest_photos has no studio_id
 * column of its own — tenant ownership is always proven by the caller first
 * resolving the owning Event via getOwnedEventById, then scoping this lookup
 * to that already-owned eventId (same pattern as getEventCreditById).
 */
function guestPhotoNotFoundResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: 'Guest memory not found' },
    { status: 404 }
  );
}

/**
 * Loads a Guest Memory (guest_photos row) scoped to both `id` and the
 * already-owned `eventId` in a single query.
 */
export async function getGuestPhotoById<T = Record<string, unknown>>(
  db: unknown,
  photoId: string | null | undefined,
  eventId: string | null | undefined,
  columns: string = '*'
): Promise<OwnershipResult<T>> {
  if (!photoId || !eventId) {
    return { error: guestPhotoNotFoundResponse() };
  }

  const queryableDb = db as QueryableDb;

  const { data, error } = await queryableDb
    .from('guest_photos')
    .select(columns)
    .eq('id', photoId)
    .eq('event_id', eventId)
    .maybeSingle();

  if (error || !data) {
    return { error: guestPhotoNotFoundResponse() };
  }

  return { event: data as unknown as T };
}

/**
 * Same generic "does not exist / belongs to another studio" response, scoped
 * to Wishes lookups. wishes carries its own studio_id (migration 0002), but
 * this helper still scopes by the already-owned eventId first — same
 * defense-in-depth pattern as getEventCreditById/getGuestPhotoById — so a
 * wish can never be resolved outside the Event it was actually posted to.
 */
function wishNotFoundResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: 'Wish not found' },
    { status: 404 }
  );
}

/**
 * Loads a Wish scoped to both `id` and the already-owned `eventId` in a
 * single query.
 */
export async function getWishById<T = Record<string, unknown>>(
  db: unknown,
  wishId: string | null | undefined,
  eventId: string | null | undefined,
  columns: string = '*'
): Promise<OwnershipResult<T>> {
  if (!wishId || !eventId) {
    return { error: wishNotFoundResponse() };
  }

  const queryableDb = db as QueryableDb;

  const { data, error } = await queryableDb
    .from('wishes')
    .select(columns)
    .eq('id', wishId)
    .eq('event_id', eventId)
    .maybeSingle();

  if (error || !data) {
    return { error: wishNotFoundResponse() };
  }

  return { event: data as unknown as T };
}

/**
 * Same generic "does not exist / belongs to another studio" response, scoped
 * to Support Ticket lookups. support_tickets carries its own studio_id
 * (migration 0034), so ownership is proven directly, same pattern as
 * getOwnedPartnerById.
 */
function supportTicketNotFoundResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: 'Support ticket not found' },
    { status: 404 }
  );
}

/**
 * Loads a Support Ticket scoped to both `id` and `studioId` in a single
 * query, so a caller can never load a ticket belonging to another studio.
 */
export async function getOwnedSupportTicketById<T = Record<string, unknown>>(
  db: unknown,
  ticketId: string | null | undefined,
  studioId: string | null | undefined,
  columns: string = '*'
): Promise<OwnershipResult<T>> {
  if (!ticketId || !studioId) {
    return { error: supportTicketNotFoundResponse() };
  }

  const queryableDb = db as QueryableDb;

  const { data, error } = await queryableDb
    .from('support_tickets')
    .select(columns)
    .eq('id', ticketId)
    .eq('studio_id', studioId)
    .maybeSingle();

  if (error || !data) {
    return { error: supportTicketNotFoundResponse() };
  }

  return { event: data as unknown as T };
}

/**
 * Loads an event scoped to both `slug` and `studioId` in a single query.
 * Used by routes that only receive a slug from the client (e.g. media
 * channel controls) and still need to prove studio ownership before acting.
 */
export async function getOwnedEventBySlug<T = Record<string, unknown>>(
  db: unknown,
  slug: string | null | undefined,
  studioId: string | null | undefined,
  columns: string = '*'
): Promise<OwnershipResult<T>> {
  if (!slug || !studioId) {
    return { error: eventNotFoundResponse() };
  }

  // Centralized cast: asserting once here (rather than typing `db` as
  // QueryableDb at each route call site) avoids forcing TypeScript to
  // structurally instantiate Supabase's deeply generic client type
  // wherever this helper is called.
  const queryableDb = db as QueryableDb;

  const { data, error } = await queryableDb
    .from('events')
    .select(columns)
    .eq('slug', slug)
    .eq('studio_id', studioId)
    .maybeSingle();

  if (error || !data) {
    return { error: eventNotFoundResponse() };
  }

  return { event: data as unknown as T };
}
