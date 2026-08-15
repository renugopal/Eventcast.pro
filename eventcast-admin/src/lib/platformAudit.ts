import { supabase, supabaseAdmin } from './supabase';

const db = supabaseAdmin || supabase;

/**
 * Discriminated union of the small allowlisted set of known Platform
 * Operations audit actions. Deliberately not a generic
 * `(action: string, before: unknown, after: unknown)` signature — there is
 * no arbitrary-row-dump path to begin with, so no regex/key-name redaction
 * is needed as the primary safety control. Only the minimum before/after
 * facts needed to explain each action are ever stored; never secrets,
 * credentials, tokens, private keys, raw stream keys, or unrelated private
 * customer data.
 *
 * The two retention RPCs (`apply_event_retention_extension`,
 * `apply_platform_retention_policy_update`, `apply_studio_retention_override`)
 * already insert their own audit row atomically with their business
 * mutation inside the same database transaction — this writer exists for
 * any other allowlisted platform action that does not go through one of
 * those RPCs.
 */
export type PlatformAuditEntry = {
  actorUserId: string;
  targetType: string;
  targetId: string | null;
  reason?: string | null;
} & (
  | { action: 'platform_console_note'; before: Record<string, never>; after: Record<string, never> }
  /**
   * ADM-007: private customer content is not routinely browsed. Reading one
   * Support thread's message bodies from the Operations Console requires a
   * stated reason and leaves this evidence row. Only the message count and
   * the ticket's own identity are recorded — never any message body.
   */
  | {
      action: 'support_thread_accessed';
      before: Record<string, never>;
      after: { studioId: string; messageCount: number };
    }
  /** ADM-008: a Super Admin changing a ticket's status records before/after. */
  | {
      action: 'support_ticket_status_changed';
      before: { status: string };
      after: { status: string };
    }
);

/**
 * Writes a single platform_audit_log row via the service-role client. Only
 * called for allowlisted actions not already covered by an atomic RPC — see
 * the module doc comment above.
 */
export async function writeAuditLog(entry: PlatformAuditEntry): Promise<{ error: string | null }> {
  const { error } = await db.from('platform_audit_log').insert({
    actor_user_id: entry.actorUserId,
    actor_platform_role: 'super_admin',
    action: entry.action,
    target_type: entry.targetType,
    target_id: entry.targetId,
    reason: entry.reason ?? null,
    before_state: entry.before,
    after_state: entry.after,
  });

  if (error) {
    return { error: error.message };
  }
  return { error: null };
}
