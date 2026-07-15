/**
 * Slice 3: minimal write-side stub for `media_event_assignments`.
 *
 * Ensures exactly one assignment row exists per event, idempotently. Sets
 * only `event_id` — every other column (`assigned_media_node_id`,
 * `ingest_id`, `playback_id`, `stream_secret_hash`, both publish-window
 * bounds, `enabled`, `youtube_enabled`, `config_version`, `updated_at`)
 * is left at its schema default or NULL. `enabled` defaults to `false`,
 * so the row satisfies `media_event_assignments_core_eligibility_chk`
 * trivially (that check only constrains non-null fields when
 * `enabled = true`).
 *
 * Deliberately has no update/upsert/delete path: node selection, ID
 * generation, publish-secret generation/hashing, and activation
 * (`enabled: true`) are all out of scope here and belong to a later
 * slice, which will `UPDATE` this same row rather than ever needing this
 * module to touch an existing one. Relies on the `event_id` UNIQUE
 * constraint (migration 0020) for idempotency: a `23505` on insert means
 * a row already exists for this event — from an earlier create, a
 * retry, or a later edit calling this same function again — and that is
 * reported as success, not as a duplicate to be reconciled.
 */

interface DbInsertResult {
  error: { message: string; code?: string } | null;
}

interface AssignmentWriterDb {
  from: (table: string) => {
    insert: (values: { event_id: string }) => PromiseLike<DbInsertResult>;
  };
}

export type AssignmentWriteResult = 'created' | 'exists' | 'error';

/**
 * Inserts `{ event_id: eventId }` into `media_event_assignments`. Returns
 * `'created'` on a fresh insert, `'exists'` if a row for this event
 * already exists (`23505`), or `'error'` for any other database failure
 * — never propagating `error.message` to the caller.
 */
export async function ensureDraftAssignment(
  db: unknown,
  eventId: string
): Promise<AssignmentWriteResult> {
  const queryableDb = db as AssignmentWriterDb;
  const { error } = await queryableDb.from('media_event_assignments').insert({ event_id: eventId });

  if (!error) return 'created';
  return error.code === '23505' ? 'exists' : 'error';
}
