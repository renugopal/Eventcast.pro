/**
 * Shared, non-gating existence check for `public.events`. Used identically
 * by both `assignmentActivation.ts` and `assignmentDeactivation.ts` —
 * confirms the target event row exists without ever gating the assignment
 * write itself; the assignment table's own guarded `UPDATE` is what
 * actually decides success in both directions. Extracted here rather than
 * duplicated so the two modules share one implementation.
 */

export interface DbResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

export interface MaybeSingleBuilder<T> {
  eq: (column: string, value: unknown) => MaybeSingleBuilder<T>;
  maybeSingle: () => PromiseLike<DbResult<T>>;
}

interface EventsExistsDb {
  from: (table: string) => {
    select: (columns: string) => MaybeSingleBuilder<{ id: string }>;
  };
}

export async function eventExists(db: unknown, eventId: string): Promise<boolean> {
  const queryableDb = db as EventsExistsDb;
  const { data, error } = await queryableDb.from('events').select('id').eq('id', eventId).maybeSingle();
  return !error && data !== null;
}
