import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';
import {
  CANONICAL_EVENT_TYPES,
  deriveLegacySchedule,
  draftInputToCanonicalRecord,
  type CanonicalEventType,
  type EventDraftInput,
} from '@/lib/eventContract';

/**
 * Draft-safe event creation (V2.1 Route-Based Draft Event Foundation,
 * Milestone D). This is a deliberately separate path from
 * `/api/events/generate`: it never touches billing, YouTube, media upload,
 * SRS, Media Agent activation, or Restreamer, and it always inserts
 * `page_state: 'draft'` — never a publicly visible row.
 */

const db = supabaseAdmin || supabase;

interface DraftCreateBody {
  eventType?: unknown;
  groomName?: unknown;
  brideName?: unknown;
  scheduledStartAtLocal?: unknown;
  venueName?: unknown;
  slug?: unknown;
  templateId?: unknown;
}

function normalizeDraftInput(body: DraftCreateBody): EventDraftInput {
  return {
    eventType: (typeof body.eventType === 'string' ? body.eventType : '') as CanonicalEventType,
    groomName: typeof body.groomName === 'string' ? body.groomName : '',
    brideName: typeof body.brideName === 'string' ? body.brideName : '',
    scheduledStartAtLocal: typeof body.scheduledStartAtLocal === 'string' ? body.scheduledStartAtLocal : '',
    venueName: typeof body.venueName === 'string' ? body.venueName : '',
    slug: typeof body.slug === 'string' ? body.slug : '',
    templateId: typeof body.templateId === 'string' ? body.templateId : '',
  };
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  let body: DraftCreateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const draftInput = normalizeDraftInput(body);

  // Positive scope for this slice is Wedding only — an unsupported event
  // type is rejected with an honest message, never silently mapped.
  if (!(CANONICAL_EVENT_TYPES as readonly string[]).includes(draftInput.eventType)) {
    return NextResponse.json(
      { success: false, error: `Event type "${draftInput.eventType || ''}" is not supported by this Draft flow.`, field: 'eventType' },
      { status: 400 }
    );
  }

  const result = draftInputToCanonicalRecord(draftInput);
  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error.message, field: result.error.field },
      { status: 400 }
    );
  }
  const record = result.record;

  // Tenant-scoped slug uniqueness (UNIQUE (studio_id, slug)) — a Draft must
  // never collide with another event already owned by this same studio.
  const { data: slugMatches, error: slugCheckError } = await db
    .from('events')
    .select('id')
    .eq('studio_id', auth.studioId)
    .eq('slug', record.slug)
    .limit(1);

  if (slugCheckError) {
    return NextResponse.json({ success: false, error: 'Slug availability check failed: ' + slugCheckError.message }, { status: 500 });
  }
  if (slugMatches && slugMatches.length > 0) {
    return NextResponse.json(
      { success: false, error: 'This event link is already in use for your studio. Please choose a different slug.', field: 'slug' },
      { status: 409 }
    );
  }

  const legacy = deriveLegacySchedule(record.scheduledStartAt);

  const { data, error } = await db
    .from('events')
    .insert([
      {
        studio_id: auth.studioId,
        event_type: record.eventType,
        groom_name: record.groomName,
        bride_name: record.brideName,
        venue_name: record.venueName,
        slug: record.slug,
        template_id: record.templateId,
        template_version: record.templateVersion,
        scheduled_start_at: record.scheduledStartAt,
        event_date: legacy.eventDate,
        event_time: legacy.eventTime,
        timer_target_time: legacy.timerTargetTime,
        guest_photo_wall_enabled: record.guestPhotoWallEnabled,
        page_state: 'draft',
        // Persistence-owned canonical visibility default (Visibility
        // Foundation Gate) — never client-supplied. Inert while
        // page_state='draft' (both the Worker and events_public_select_policy
        // require page_state='published' regardless of visibility); this
        // establishes the safe default that Publish must then explicitly
        // confirm or override.
        event_visibility: 'unlisted',
      },
    ])
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: 'Draft creation failed: ' + error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, id: data.id, slug: record.slug });
}
