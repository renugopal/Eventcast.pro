import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdmin';
import { extendEventRetention } from '@/lib/eventRecording';

/**
 * POST /api/platform/events/[eventId]/retention-extension — an audited
 * Super Admin manual retention extension (STO-008). `requireSuperAdmin`-gated.
 *
 * Delegates to `extendEventRetention()`, which calls the
 * `apply_event_retention_extension` database RPC: the retention_expires_at
 * update, the event_retention_extensions history row, and the
 * platform_audit_log row are one atomic operation. The RPC itself also
 * enforces that retention is already frozen and that the new expiry is
 * strictly later than the current one — this route does not duplicate or
 * weaken those checks.
 */

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

interface PostBody {
  newExpiresAt?: unknown;
  reason?: unknown;
}

export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { eventId } = await params;

  let body: PostBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.newExpiresAt !== 'string') {
    return NextResponse.json(
      { success: false, error: 'newExpiresAt is required', field: 'newExpiresAt' },
      { status: 400 }
    );
  }
  const newExpiresAt = new Date(body.newExpiresAt);
  if (Number.isNaN(newExpiresAt.getTime())) {
    return NextResponse.json(
      { success: false, error: 'newExpiresAt must be a valid date', field: 'newExpiresAt' },
      { status: 400 }
    );
  }

  if (typeof body.reason !== 'string' || body.reason.trim() === '') {
    return NextResponse.json(
      { success: false, error: 'A non-empty reason is required', field: 'reason' },
      { status: 400 }
    );
  }

  const result = await extendEventRetention(eventId, newExpiresAt, body.reason, auth.userId);

  if (result.status === 'rejected') {
    return NextResponse.json({ success: false, error: result.message }, { status: 409 });
  }

  return NextResponse.json({
    success: true,
    eventId,
    retentionExpiresAt: result.recording.retention_expires_at,
  });
}
