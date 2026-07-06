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
