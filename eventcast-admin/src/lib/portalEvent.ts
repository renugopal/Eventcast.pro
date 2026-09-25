/**
 * Public-safe event read for the legacy unauthenticated `/portal/[slug]`
 * page (S3 security containment, 2026-09-25).
 *
 * That page runs in the browser with the public anon key, so every column it
 * selects is readable by anyone. It previously used `select('*')`, which
 * shipped every column of a published public event — including the legacy
 * `youtube_stream_key` — to every visitor's browser. It now selects exactly
 * the fields it renders, and additionally projects the returned row through
 * the same allowlist so an unexpected extra column can never reach component
 * state even if the query shape changes.
 *
 * `/portal/[slug]` is retired by Baseline LEG-003 but was deliberately
 * retained at the Milestone O cutover for out-of-band shared links; this is
 * containment only, not a portal rebuild.
 */

export const PORTAL_EVENT_FIELDS = [
  'id',
  'slug',
  'event_type',
  'groom_name',
  'bride_name',
  'celebrant_name',
] as const;

export type PortalEventField = (typeof PORTAL_EVENT_FIELDS)[number];

export type PortalEvent = { [K in PortalEventField]: string | null };

export const PORTAL_EVENT_SELECT = PORTAL_EVENT_FIELDS.join(', ');

/** Copies only allowlisted fields; anything else on the row is dropped. */
export function projectPortalEvent(row: Record<string, unknown>): PortalEvent {
  const projected = {} as PortalEvent;
  for (const field of PORTAL_EVENT_FIELDS) {
    const value = row[field];
    projected[field] = typeof value === 'string' ? value : null;
  }
  return projected;
}

interface PortalEventQuery {
  eq: (column: string, value: unknown) => PortalEventQuery;
  is: (column: string, value: null) => PortalEventQuery;
  single: () => PromiseLike<{ data: Record<string, unknown> | null; error: unknown }>;
}

interface PortalEventClient {
  from: (table: string) => { select: (columns: string) => PortalEventQuery };
}

/**
 * `client` is untyped (matching `eventExistence.ts`'s `eventExists` and other
 * generic-db helpers in this codebase) and cast internally, rather than
 * accepting the real Supabase client's own deeply generic type: assigning it
 * structurally to a narrow interface here causes TypeScript's "Type
 * instantiation is excessively deep" error at the call site.
 */
export async function fetchPortalEvent(client: unknown, slug: string): Promise<PortalEvent | null> {
  const queryableClient = client as PortalEventClient;
  const { data, error } = await queryableClient
    .from('events')
    .select(PORTAL_EVENT_SELECT)
    .eq('slug', slug)
    .eq('event_visibility', 'public')
    .is('archived_at', null)
    .single();

  if (error || !data) return null;
  return projectPortalEvent(data);
}
