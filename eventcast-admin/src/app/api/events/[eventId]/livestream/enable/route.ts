import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin, canMutateStudioResources } from '@/lib/auth';
import { getOwnedEventById, isOwnershipError } from '@/lib/ownership';
import { ensureDraftAssignment } from '@/lib/media-agent/assignmentWriter';
import { activateAssignment } from '@/lib/media-agent/assignmentActivation';

/**
 * POST /api/events/[eventId]/livestream/enable
 *
 * Explicit provider-facing Private Livestream enablement (Baseline V2.1
 * LIV-004: "A draft does not activate a stream. The user enables Private
 * Livestream, after which ownership, capacity, plan, and schedule checks
 * occur."). Draft creation and Page Publish never call this — it is the one
 * and only path that ever activates a real SRS/Media Agent assignment for a
 * studio's own event, and it is reached only by an authenticated owner/admin
 * explicit action from the Live Control Room.
 *
 * Reuses the existing server-side control plane exactly as built —
 * `ensureDraftAssignment` (idempotent row bootstrap) then `activateAssignment`
 * (concurrency-safe node selection + capacity enforcement + credential
 * issuance, migration 0024) — the same functions the operator-only
 * `/internal/media/assignments/{event_id}/activate` route calls, just
 * reached here through normal studio-JWT `requireAdmin()` + tenant ownership
 * instead of the operator shared-secret scheme, since this route has its own
 * complete authorization boundary and never needs that secret.
 *
 * Test Stream (LIV-006) needs no separate schema or endpoint: the public
 * Worker already refuses to serve *any* page or HLS asset for a
 * `page_state = 'draft'` event (its event lookup itself requires
 * `page_state=eq.published` before an HLS request is ever reached), so
 * enabling here while the page is still a Draft is already a fully private
 * test — the UI frames this action as "Start Test Stream" vs. "Enable
 * Private Livestream" based on the event's current page_state, but the
 * backend action is identical either way.
 *
 * No billing/entitlement check exists here: no authoritative beta-entitlement
 * or plan-quantity mechanism exists yet in this schema (BIL-002 is an
 * accepted *future* operating model, not yet backed by a column), and
 * inventing one would be inventing commercial policy, which this package
 * explicitly must not do. Ownership, archive state, existing-assignment
 * idempotency, and live SRS node capacity are the checks that ARE
 * authoritatively implementable today, so those are the ones enforced below.
 *
 * The raw publish token is returned exactly once, only on the branch where
 * this call activated the row — it is never persisted in plaintext anywhere
 * (only `hashPublishSecret`'s hash is stored) and can never be retrieved
 * again after this response. Ending the stream and enabling it again issues
 * fresh credentials (activation always regenerates ingest_id/playback_id/
 * token for a currently-disabled row) — that is the only "rotation" path
 * that exists, and it is a deliberate reuse of already-built mechanics, not
 * a new credential-rotation architecture.
 *
 * `streamUrl`/`streamKey` shape: `02_V1_ARCHITECTURE_SPEC.md` "Protocols"
 * ("The encoder-facing stream key SHOULD use the form
 * `<ingest_id>?token=<secret>`") is the authoritative encoder-facing
 * contract, matching the Go Media Agent's own `on_publish` handler
 * (`extractToken` reads `token` only from the RTMP publish *query string*,
 * i.e. from SRS's callback `param` field — never from the stream path).
 * `streamUrl` is therefore the bare app URL (`rtmp://<host>/live`, no
 * ingest id) and `streamKey` is the combined `<ingest_id>?token=<secret>`
 * encoder-facing key, so a studio can paste these two values verbatim into
 * OBS/any RTMP encoder's plain "Server" + "Stream Key" fields and get
 * exactly the required `rtmp://<host>/live/<ingest_id>?token=<secret>`
 * publish target — OBS concatenates Server + "/" + Stream Key itself. An
 * earlier version of this route returned `streamUrl` with the ingest id
 * already embedded in the path and a bare token as `streamKey`; pasted
 * verbatim into OBS's two fields, that produced
 * `.../live/<ingest_id>/<raw_token>` (token as an extra path segment, never
 * reaching SRS as a query parameter), which the Media Agent correctly
 * rejects as an empty/invalid token. This is a presentation-shape fix only
 * — `assignmentActivation.ts`'s id/token generation and SRS's auth
 * contract are unchanged.
 */

const db = supabaseAdmin || supabase;

interface LivestreamEventRow {
  id: string;
  archived_at: string | null;
}

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  if (!canMutateStudioResources(auth.studioMemberRole)) {
    return NextResponse.json({ success: false, error: 'Forbidden: read-only studio role' }, { status: 403 });
  }

  const { eventId } = await params;
  const ownership = await getOwnedEventById<LivestreamEventRow>(db, eventId, auth.studioId, 'id, archived_at');
  if (isOwnershipError(ownership)) return ownership.error;
  const event = ownership.event;

  if (event.archived_at) {
    return NextResponse.json(
      { success: false, error: 'Cannot enable Private Livestream for an archived event.' },
      { status: 409 }
    );
  }

  const writeResult = await ensureDraftAssignment(db, event.id);
  if (writeResult === 'error') {
    return NextResponse.json({ success: false, error: 'Failed to prepare the stream assignment.' }, { status: 500 });
  }

  const activation = await activateAssignment(db, event.id);

  switch (activation.outcome) {
    case 'activated':
      return NextResponse.json(
        {
          success: true,
          streamUrl: `rtmp://${activation.ingestHostname}/live`,
          streamKey: `${activation.ingestId}?token=${activation.token}`,
        },
        { status: 201 }
      );
    case 'already_activated':
      return NextResponse.json(
        { success: false, error: 'Private Livestream is already enabled for this event.', code: 'already_activated' },
        { status: 409 }
      );
    case 'event_not_found':
      return NextResponse.json({ success: false, error: 'Event not found' }, { status: 404 });
    case 'no_draft_assignment':
      return NextResponse.json({ success: false, error: 'Failed to prepare the stream assignment.' }, { status: 500 });
    case 'no_eligible_node':
    case 'node_at_capacity':
      return NextResponse.json(
        { success: false, error: 'No streaming capacity is available right now. Please try again shortly.', code: activation.outcome },
        { status: 503 }
      );
    case 'error':
    default:
      return NextResponse.json({ success: false, error: 'Failed to enable Private Livestream.' }, { status: 500 });
  }
}
