import { describe, expect, it } from 'vitest';
import {
  computeEventSlug,
  DEFAULT_PRIVACY_STATUS,
  LEGACY_ROW_PRIVACY_FALLBACK,
  dbRowToFormState,
  formStateToGeneratePayload,
  galleryFormStringToArray,
  invitationVideoDbValueToFormString,
  invitationVideoUrlsToDbValue,
  normalizeGenerateRequest,
  type EventDbRow,
  type EventFormState,
  // Canonical contract (V2.1 Draft Event Foundation)
  CANONICAL_TEMPLATES,
  combineIstDateTimeToScheduledStartAt,
  deriveLegacySchedule,
  draftInputToCanonicalRecord,
  canonicalRecordToPublicConfig,
  canonicalRecordToWeddingTemplateRenderRow,
  primaryPublicEventCreditToPhotographerRow,
  projectPublicEventCredits,
  resolveCanonicalTemplate,
  scheduledStartAtToIstDateTimeLocal,
  type CanonicalEventRecord,
  type EventCreditWithPartner,
  type EventDraftInput,
  type PublicEventCredit,
} from '@/lib/eventContract';

function makeFormState(overrides: Partial<EventFormState> = {}): EventFormState {
  return {
    eventType: 'Wedding',
    groomName: 'Raj',
    brideName: 'Priya',
    celebrantName: '',
    customTopTitle: 'Wedding Invitation',
    eventDate: '2026-08-01',
    eventTime: '10:30 AM',
    timerTargetTime: '10:30',
    showTimer: true,
    venueName: 'Taj Krishna',
    venueMapLink: 'https://maps.google.com/xyz',
    invitationVideoUrls: 'https://r2.example/video1.mp4',
    thumbnailUrl: 'https://r2.example/thumb.jpg',
    privacyStatus: DEFAULT_PRIVACY_STATUS,
    galleryUrls: 'https://r2.example/g1.jpg\nhttps://r2.example/g2.jpg',
    vodLink: '',
    templateId: 'wedding-template-01',
    youtubePrivacy: 'unlisted',
    customInitials: 'R & P',
    hideLoaderPhoto: false,
    loaderPhotoUrl: 'https://r2.example/loader.jpg',
    notes: 'VIP guest list attached',
    youtube_broadcast_id: '',
    youtube_stream_key: '',
    youtube_url: '',
    slug: '',
    photographerName: 'Dream Captures',
    photographerPhone: '9999999999',
    photographerInsta: 'https://instagram.com/dreamcaptures',
    guestPhotoWallEnabled: true,
    ...overrides,
  };
}

function makeDbRow(overrides: Partial<EventDbRow> = {}): EventDbRow {
  return {
    id: 'evt-1',
    event_type: 'Wedding',
    groom_name: 'Raj',
    bride_name: 'Priya',
    celebrant_name: null,
    custom_top_title: 'Wedding Invitation',
    event_date: '2026-08-01',
    event_time: '10:30 AM',
    timer_target_time: '10:30',
    show_timer: true,
    venue_name: 'Taj Krishna',
    venue_map_link: 'https://maps.google.com/xyz',
    invitation_video_url: 'https://r2.example/video1.mp4',
    thumbnail_url: 'https://r2.example/thumb.jpg',
    privacy_status: 'Public (Visible Everywhere)',
    gallery_urls: ['https://r2.example/g1.jpg', 'https://r2.example/g2.jpg'],
    vod_link: 'https://youtube.com/watch?v=live123',
    template_id: 'wedding-template-01',
    custom_initials: 'R & P',
    hide_loader_photo: false,
    loader_photo_url: 'https://r2.example/loader.jpg',
    notes: 'VIP guest list attached',
    youtube_broadcast_id: 'yt-broadcast-1',
    youtube_stream_key: 'yt-stream-key-1',
    youtube_url: 'https://youtube.com/watch?v=live123',
    slug: 'raj-priya-wedding',
    photographer_id: 'pg-1',
    guest_photo_wall_enabled: true,
    ...overrides,
  };
}

describe('computeEventSlug', () => {
  it('slugifies groom/bride/type, replacing spaces with hyphens', () => {
    expect(
      computeEventSlug({ groomName: 'Raj Kumar', brideName: 'Priya Reddy', eventType: 'Wedding' })
    ).toBe('raj-kumar-priya-reddy-wedding');
  });

  it('falls back to celebrantName when there is no groomName', () => {
    expect(
      computeEventSlug({ celebrantName: 'Baby Ananya', eventType: 'Birthday' })
    ).toBe('baby-ananya-family-birthday');
  });
});

describe('invitation video conversion', () => {
  it('preserves multiple newline-separated URLs as one scalar text value', () => {
    const raw = 'https://r2.example/a.mp4\nhttps://r2.example/b.mp4\nhttps://r2.example/c.mp4';
    expect(invitationVideoUrlsToDbValue(raw)).toBe(raw);
  });

  it('remains backward-compatible with a single existing URL', () => {
    expect(invitationVideoUrlsToDbValue('https://r2.example/only.mp4')).toBe(
      'https://r2.example/only.mp4'
    );
    expect(invitationVideoDbValueToFormString('https://r2.example/only.mp4')).toBe(
      'https://r2.example/only.mp4'
    );
  });

  it('trims blank lines and returns null for empty input', () => {
    expect(invitationVideoUrlsToDbValue('\n\n  \n')).toBeNull();
    expect(invitationVideoUrlsToDbValue(null)).toBeNull();
  });

  it('also accepts a legacy array value for display hydration', () => {
    expect(
      invitationVideoDbValueToFormString(['https://r2.example/a.mp4', 'https://r2.example/b.mp4'])
    ).toBe('https://r2.example/a.mp4\nhttps://r2.example/b.mp4');
  });
});

describe('galleryFormStringToArray', () => {
  it('splits a newline-separated string into a clean array', () => {
    expect(galleryFormStringToArray('a.jpg\n\nb.jpg\n  c.jpg  ')).toEqual([
      'a.jpg',
      'b.jpg',
      'c.jpg',
    ]);
  });
});

describe('dbRowToFormState', () => {
  it('hydrates a complete edit form state from a database row, preserving hidden fields', () => {
    const row = makeDbRow();
    const photographer = { name: 'Dream Captures', phone_number: '9999999999', instagram_url: 'https://instagram.com/dreamcaptures' };
    const state = dbRowToFormState(row, { mode: 'edit', photographer });

    expect(state).toEqual(
      makeFormState({
        youtubePrivacy: 'public',
        vodLink: 'https://youtube.com/watch?v=live123',
        youtube_broadcast_id: 'yt-broadcast-1',
        youtube_stream_key: 'yt-stream-key-1',
        youtube_url: 'https://youtube.com/watch?v=live123',
        slug: 'raj-priya-wedding',
        privacyStatus: 'Public (Visible Everywhere)',
      })
    );
  });

  it('keeps a single legacy invitation-video URL working unchanged', () => {
    const row = makeDbRow({ invitation_video_url: 'https://r2.example/legacy-only.mp4' });
    const state = dbRowToFormState(row, { mode: 'edit' });
    expect(state.invitationVideoUrls).toBe('https://r2.example/legacy-only.mp4');
  });

  it('preserves every existing invitation video URL as newline-separated text on hydration', () => {
    const row = makeDbRow({
      invitation_video_url: 'https://r2.example/a.mp4\nhttps://r2.example/b.mp4\nhttps://r2.example/c.mp4',
    });
    const state = dbRowToFormState(row, { mode: 'edit' });
    expect(state.invitationVideoUrls).toBe(
      'https://r2.example/a.mp4\nhttps://r2.example/b.mp4\nhttps://r2.example/c.mp4'
    );
  });

  it('preserves the verified DB slug on edit regardless of what computeEventSlug would produce from the (possibly changed) names', () => {
    const row = makeDbRow({ groom_name: 'ChangedGroom', bride_name: 'ChangedBride', slug: 'raj-priya-wedding' });
    const state = dbRowToFormState(row, { mode: 'edit' });
    expect(state.slug).toBe('raj-priya-wedding');
    expect(state.slug).not.toBe(computeEventSlug({ groomName: 'ChangedGroom', brideName: 'ChangedBride', eventType: 'Wedding' }));
  });

  it('clears slug, YouTube identifiers, stream key, and VOD link in duplicate mode while preserving ordinary content', () => {
    const row = makeDbRow();
    const state = dbRowToFormState(row, { mode: 'duplicate' });

    expect(state.slug).toBe('');
    expect(state.youtube_broadcast_id).toBe('');
    expect(state.youtube_stream_key).toBe('');
    expect(state.youtube_url).toBe('');
    expect(state.vodLink).toBe('');

    // Ordinary event content is still carried over.
    expect(state.venueName).toBe('Taj Krishna');
    expect(state.customTopTitle).toBe('Wedding Invitation');
    expect(state.invitationVideoUrls).toBe('https://r2.example/video1.mp4');
    expect(state.groomName).toBe('Raj (Copy)');
    expect(state.celebrantName).toBe(' (Copy)');
    expect(state.brideName).toBe('Priya');
  });

  it('remains fully compatible with an old row that has no privacy_status set', () => {
    const row = makeDbRow({ privacy_status: null });
    const state = dbRowToFormState(row, { mode: 'edit' });
    expect(state.privacyStatus).toBe(LEGACY_ROW_PRIVACY_FALLBACK);
    expect(state.privacyStatus).toBe('Unlisted (Link Only)');
  });

  it('defaults guestPhotoWallEnabled to true for legacy rows predating the column', () => {
    const row = makeDbRow({ guest_photo_wall_enabled: undefined });
    const state = dbRowToFormState(row, { mode: 'edit' });
    expect(state.guestPhotoWallEnabled).toBe(true);
  });

  it('preserves an explicit false guestPhotoWallEnabled on hydration', () => {
    const row = makeDbRow({ guest_photo_wall_enabled: false });
    const state = dbRowToFormState(row, { mode: 'edit' });
    expect(state.guestPhotoWallEnabled).toBe(false);
  });
});

describe('formStateToGeneratePayload', () => {
  it('builds a complete create payload from form state', () => {
    const formState = makeFormState();
    const payload = formStateToGeneratePayload(formState, { isEditing: false, editingId: null });

    expect(payload.isEditing).toBe(false);
    expect(payload.editingId).toBeNull();
    expect(payload.galleryUrls).toEqual([
      'https://r2.example/g1.jpg',
      'https://r2.example/g2.jpg',
    ]);
    expect(payload.groomName).toBe('Raj');
    expect(payload.invitationVideoUrls).toBe('https://r2.example/video1.mp4');
  });

  it('round-trips form state through the payload without losing hidden fields', () => {
    const formState = makeFormState();
    const payload = formStateToGeneratePayload(formState, { isEditing: true, editingId: 'evt-1' });

    expect(payload.customInitials).toBe(formState.customInitials);
    expect(payload.hideLoaderPhoto).toBe(formState.hideLoaderPhoto);
    expect(payload.loaderPhotoUrl).toBe(formState.loaderPhotoUrl);
    expect(payload.privacyStatus).toBe(formState.privacyStatus);
    expect(payload.notes).toBe(formState.notes);
    expect(payload.photographerName).toBe(formState.photographerName);
    expect(payload.photographerPhone).toBe(formState.photographerPhone);
    expect(payload.photographerInsta).toBe(formState.photographerInsta);
    expect(payload.timerTargetTime).toBe(formState.timerTargetTime);
    expect(payload.showTimer).toBe(formState.showTimer);
  });

  it('prefers freshly-generated YouTube details over stale form state', () => {
    const formState = makeFormState({ vodLink: 'old', youtube_broadcast_id: 'old-id', youtube_stream_key: 'old-key', youtube_url: 'old-url' });
    const payload = formStateToGeneratePayload(formState, {
      isEditing: false,
      editingId: null,
      youtubeDetails: { youtubeUrl: 'new-url', broadcastId: 'new-id', streamKey: 'new-key' },
    });

    expect(payload.vodLink).toBe('new-url');
    expect(payload.youtube_broadcast_id).toBe('new-id');
    expect(payload.youtube_stream_key).toBe('new-key');
    expect(payload.youtube_url).toBe('new-url');
  });
});

describe('normalizeGenerateRequest', () => {
  it('never emits undefined for any field, even from an empty body', () => {
    const normalized = normalizeGenerateRequest({});
    for (const [key, value] of Object.entries(normalized)) {
      expect(value, `field "${key}" must not be undefined`).not.toBeUndefined();
    }
  });

  it('preserves every invitation video URL as one newline-joined scalar value (not just the first)', () => {
    const normalized = normalizeGenerateRequest({
      groom_name: 'Raj',
      bride_name: 'Priya',
      invitation_video_url: 'https://r2.example/a.mp4\nhttps://r2.example/b.mp4\nhttps://r2.example/c.mp4',
    });
    expect(normalized.invitationVideoUrl).toBe(
      'https://r2.example/a.mp4\nhttps://r2.example/b.mp4\nhttps://r2.example/c.mp4'
    );
  });

  it('stays backward-compatible with a single invitation video URL', () => {
    const normalized = normalizeGenerateRequest({
      groom_name: 'Raj',
      bride_name: 'Priya',
      invitation_video_url: 'https://r2.example/only.mp4',
    });
    expect(normalized.invitationVideoUrl).toBe('https://r2.example/only.mp4');
  });

  it('accepts the camelCase field names CreateEventFlow sends', () => {
    const normalized = normalizeGenerateRequest({
      groomName: 'Raj',
      brideName: 'Priya',
      eventType: 'Wedding',
      invitationVideoUrls: 'https://r2.example/a.mp4\nhttps://r2.example/b.mp4',
      galleryUrls: ['a.jpg', 'b.jpg'],
    });
    expect(normalized.groomName).toBe('Raj');
    expect(normalized.brideName).toBe('Priya');
    expect(normalized.invitationVideoUrl).toBe('https://r2.example/a.mp4\nhttps://r2.example/b.mp4');
    expect(normalized.galleryUrls).toEqual(['a.jpg', 'b.jpg']);
  });

  it('only treats a request as an edit when both isEditing and editingId are present', () => {
    expect(normalizeGenerateRequest({ isEditing: true }).isEditing).toBe(false);
    expect(normalizeGenerateRequest({ isEditing: true, editingId: 'evt-1' }).isEditing).toBe(true);
    expect(normalizeGenerateRequest({ isEditing: true, editingId: 'evt-1' }).editingId).toBe('evt-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Canonical Event Contract (V2.1 Route-Based Draft Event Foundation)
// ═══════════════════════════════════════════════════════════════════════════

function makeDraftInput(overrides: Partial<EventDraftInput> = {}): EventDraftInput {
  return {
    eventType: 'Wedding',
    groomName: 'Raj',
    brideName: 'Priya',
    scheduledStartAtLocal: '2026-12-01T18:30',
    venueName: 'Taj Krishna',
    slug: 'raj-priya-wedding',
    templateId: 'wedding-template-01',
    ...overrides,
  };
}

describe('combineIstDateTimeToScheduledStartAt', () => {
  it('attaches a fixed +05:30 offset to a datetime-local value', () => {
    expect(combineIstDateTimeToScheduledStartAt('2026-12-01T18:30')).toBe('2026-12-01T18:30:00+05:30');
  });

  it('rejects a value that is not YYYY-MM-DDTHH:mm', () => {
    expect(() => combineIstDateTimeToScheduledStartAt('2026-12-01')).toThrow();
    expect(() => combineIstDateTimeToScheduledStartAt('not-a-date')).toThrow();
  });
});

describe('scheduledStartAtToIstDateTimeLocal — inverse of combineIstDateTimeToScheduledStartAt', () => {
  it('recovers the original datetime-local value for edit-form prefill', () => {
    const scheduledStartAt = combineIstDateTimeToScheduledStartAt('2026-12-01T18:30');
    expect(scheduledStartAtToIstDateTimeLocal(scheduledStartAt)).toBe('2026-12-01T18:30');
  });

  it('round-trips through both directions without loss', () => {
    const original = '2026-01-01T00:15';
    const roundTripped = scheduledStartAtToIstDateTimeLocal(combineIstDateTimeToScheduledStartAt(original));
    expect(roundTripped).toBe(original);
  });

  it('rejects a timestamp with no explicit offset or an unparseable shape', () => {
    expect(() => scheduledStartAtToIstDateTimeLocal('not-a-timestamp')).toThrow();
    expect(() => scheduledStartAtToIstDateTimeLocal('2026-12-01T18:30:00')).toThrow();
  });

  it('converts a Supabase-normalized UTC (+00:00) timestamptz to the correct IST local value', () => {
    expect(scheduledStartAtToIstDateTimeLocal('2026-12-01T13:00:00+00:00')).toBe('2026-12-01T18:30');
  });

  it('still accepts the previously-supported +05:30 representation, producing the same local value', () => {
    expect(scheduledStartAtToIstDateTimeLocal('2026-12-01T18:30:00+05:30')).toBe('2026-12-01T18:30');
  });

  it('accepts a Z-suffixed UTC timestamp and converts it to IST', () => {
    expect(scheduledStartAtToIstDateTimeLocal('2026-12-01T18:30:00Z')).toBe('2026-12-02T00:00');
  });

  it('rejects an invalid calendar date instead of silently normalizing it', () => {
    expect(() => scheduledStartAtToIstDateTimeLocal('2026-13-40T25:70:00+05:30')).toThrow();
  });
});

describe('deriveLegacySchedule — one-directional mirror of the authoritative timestamp', () => {
  it('derives event_date, event_time, and timer_target_time consistently from scheduled_start_at', () => {
    const scheduledStartAt = combineIstDateTimeToScheduledStartAt('2026-12-01T18:30');
    const derived = deriveLegacySchedule(scheduledStartAt);

    expect(derived.eventDate).toBe('2026-12-01');
    expect(derived.timerTargetTime).toBe('18:30');
    expect(derived.eventTime).toBe('6:30 PM');
  });

  it('is consistent across the day boundary in Asia/Kolkata (UTC+05:30)', () => {
    // 2026-01-01T00:15+05:30 has no UTC-date ambiguity risk to guard against —
    // this asserts the IST calendar date is used, not a UTC-shifted one.
    const scheduledStartAt = combineIstDateTimeToScheduledStartAt('2026-01-01T00:15');
    const derived = deriveLegacySchedule(scheduledStartAt);
    expect(derived.eventDate).toBe('2026-01-01');
    expect(derived.timerTargetTime).toBe('00:15');
  });

  it('rejects an invalid timestamp', () => {
    expect(() => deriveLegacySchedule('not-a-timestamp')).toThrow();
  });
});

describe('resolveCanonicalTemplate — no silent fallback', () => {
  it('resolves the verified Wedding template', () => {
    const resolved = resolveCanonicalTemplate('wedding-template-01', 'Wedding');
    expect(resolved).toEqual(CANONICAL_TEMPLATES['wedding-template-01']);
    expect(resolved?.templateVersion).toBe('1.0.0');
  });

  it('returns null (never a fallback template) for an unknown templateId', () => {
    expect(resolveCanonicalTemplate('unknown-template', 'Wedding')).toBeNull();
  });

  it('returns null for a template/event-type mismatch', () => {
    expect(resolveCanonicalTemplate('wedding-template-01', 'Birthday')).toBeNull();
  });
});

describe('draftInputToCanonicalRecord', () => {
  it('maps valid Draft Input into the canonical fields, with scheduled_start_at as the sole authority', () => {
    const result = draftInputToCanonicalRecord(makeDraftInput());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    expect(result.record).toEqual({
      slug: 'raj-priya-wedding',
      eventType: 'Wedding',
      groomName: 'Raj',
      brideName: 'Priya',
      scheduledStartAt: '2026-12-01T18:30:00+05:30',
      venueName: 'Taj Krishna',
      templateId: 'wedding-template-01',
      templateVersion: '1.0.0',
      guestPhotoWallEnabled: true,
    });
  });

  it('never produces id, studioId, pageState, visibility, or thumbnailUrl — those are persistence-layer-owned, not client-derived', () => {
    const result = draftInputToCanonicalRecord(makeDraftInput());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    for (const forbidden of ['id', 'studioId', 'pageState', 'visibility', 'thumbnailUrl']) {
      expect(result.record).not.toHaveProperty(forbidden);
    }
  });

  it('rejects an unresolvable template instead of silently falling back', () => {
    const result = draftInputToCanonicalRecord(makeDraftInput({ templateId: 'does-not-exist' }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a validation error');
    expect(result.error.field).toBe('templateId');
  });

  it('rejects a missing groom name', () => {
    const result = draftInputToCanonicalRecord(makeDraftInput({ groomName: '  ' }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a validation error');
    expect(result.error.field).toBe('groomName');
  });

  it('rejects a missing bride name', () => {
    const result = draftInputToCanonicalRecord(makeDraftInput({ brideName: '' }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a validation error');
    expect(result.error.field).toBe('brideName');
  });

  it('rejects an invalid scheduledStartAtLocal', () => {
    const result = draftInputToCanonicalRecord(makeDraftInput({ scheduledStartAtLocal: 'garbage' }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a validation error');
    expect(result.error.field).toBe('scheduledStartAtLocal');
  });
});

describe('canonicalRecordToPublicConfig — guest-safe projection', () => {
  function makeCanonicalRecord(overrides: Partial<CanonicalEventRecord> = {}): CanonicalEventRecord {
    return {
      id: 'event-uuid-1',
      studioId: 'studio-a',
      slug: 'raj-priya-wedding',
      eventType: 'Wedding',
      groomName: 'Raj',
      brideName: 'Priya',
      scheduledStartAt: '2026-12-01T18:30:00+05:30',
      venueName: 'Taj Krishna',
      templateId: 'wedding-template-01',
      templateVersion: '1.0.0',
      pageState: 'published',
      visibility: 'public',
      guestPhotoWallEnabled: true,
      thumbnailUrl: 'https://r2.example/thumb.jpg',
      ...overrides,
    };
  }

  it('exposes only guest-safe fields', () => {
    const config = canonicalRecordToPublicConfig(makeCanonicalRecord());
    expect(config).toEqual({
      id: 'event-uuid-1',
      slug: 'raj-priya-wedding',
      eventType: 'Wedding',
      groomName: 'Raj',
      brideName: 'Priya',
      scheduledStartAt: '2026-12-01T18:30:00+05:30',
      venueName: 'Taj Krishna',
      templateId: 'wedding-template-01',
      templateVersion: '1.0.0',
      guestPhotoWallEnabled: true,
      thumbnailUrl: 'https://r2.example/thumb.jpg',
      eventCredits: [],
    });
  });

  it('excludes studioId, pageState, and visibility — Draft/page-state is never conflated with the public projection', () => {
    const config = canonicalRecordToPublicConfig(makeCanonicalRecord({ pageState: 'draft', visibility: 'unlisted' }));
    for (const forbidden of ['studioId', 'pageState', 'visibility']) {
      expect(config).not.toHaveProperty(forbidden);
    }
  });

  it('threads a supplied public Event Credit projection through unchanged', () => {
    const credits: PublicEventCredit[] = [
      {
        businessName: 'Dream Captures',
        roleLabel: 'photographer',
        isPrimary: true,
        logoUrl: 'https://r2.example/logo.png',
        websiteUrl: null,
        instagramUrl: null,
        facebookUrl: null,
        youtubeUrl: null,
      },
    ];
    const config = canonicalRecordToPublicConfig(makeCanonicalRecord(), credits);
    expect(config.eventCredits).toEqual(credits);
  });
});

describe('projectPublicEventCredits — public-safe Event Credit projection (PART-003/PART-005/PART-006)', () => {
  function makeCredit(overrides: Partial<EventCreditWithPartner> = {}): EventCreditWithPartner {
    return {
      roleLabel: 'photographer',
      isPrimary: false,
      partner: {
        businessName: 'Dream Captures',
        logoUrl: 'https://r2.example/logo.png',
        websiteUrl: 'https://dreamcaptures.example',
        instagramUrl: 'https://instagram.com/dreamcaptures',
        facebookUrl: null,
        youtubeUrl: null,
      },
      ...overrides,
    };
  }

  it('projects only the approved public-safe fields, excluding internal_notes/contact fields entirely', () => {
    // A partner record with private fields attached (as it would arrive from
    // a raw `partners` row) must never leak through — the input type itself
    // has no place to carry them, so this proves the output shape directly.
    const [credit] = projectPublicEventCredits([makeCredit()]);
    expect(credit).toEqual({
      businessName: 'Dream Captures',
      roleLabel: 'photographer',
      isPrimary: false,
      logoUrl: 'https://r2.example/logo.png',
      websiteUrl: 'https://dreamcaptures.example',
      instagramUrl: 'https://instagram.com/dreamcaptures',
      facebookUrl: null,
      youtubeUrl: null,
    });
    for (const forbidden of ['internalNotes', 'phone', 'whatsapp', 'contactPerson', 'city']) {
      expect(credit).not.toHaveProperty(forbidden);
    }
  });

  it('orders the primary credit first, ahead of additional credits', () => {
    const additional = makeCredit({ isPrimary: false, partner: { ...makeCredit().partner, businessName: 'Additional Studio' } });
    const primary = makeCredit({ isPrimary: true, partner: { ...makeCredit().partner, businessName: 'Primary Studio' } });

    const result = projectPublicEventCredits([additional, primary]);

    expect(result.map((c) => c.businessName)).toEqual(['Primary Studio', 'Additional Studio']);
    expect(result[0].isPrimary).toBe(true);
  });

  it('renders additional credits deterministically, preserving the given order among non-primary credits', () => {
    const first = makeCredit({ partner: { ...makeCredit().partner, businessName: 'First Additional' } });
    const second = makeCredit({ partner: { ...makeCredit().partner, businessName: 'Second Additional' } });

    const result = projectPublicEventCredits([first, second]);

    expect(result.map((c) => c.businessName)).toEqual(['First Additional', 'Second Additional']);
  });

  it('returns an empty list for a no-credit event', () => {
    expect(projectPublicEventCredits([])).toEqual([]);
  });
});

describe('primaryPublicEventCreditToPhotographerRow — primary-credit-to-legacy-footer-slot adapter', () => {
  it('maps the primary credit into the existing footer studio-name/logo slot', () => {
    const eventCredits: PublicEventCredit[] = [
      {
        businessName: 'Dream Captures',
        roleLabel: 'photographer',
        isPrimary: true,
        logoUrl: 'https://r2.example/logo.png',
        websiteUrl: 'https://dreamcaptures.example',
        instagramUrl: 'https://instagram.com/dreamcaptures',
        facebookUrl: null,
        youtubeUrl: null,
      },
    ];

    const row = primaryPublicEventCreditToPhotographerRow(eventCredits);
    expect(row).toEqual({
      id: '',
      name: 'Dream Captures',
      studio_name: 'Dream Captures',
      logo_url: 'https://r2.example/logo.png',
      instagram: 'https://instagram.com/dreamcaptures',
      website: 'https://dreamcaptures.example',
    });
    // The public projection never carries a phone number — the footer's
    // phone link must have nothing to render from this adapter.
    expect(row).not.toHaveProperty('phone_number');
  });

  it('returns null when there is no primary credit (including a no-credit event)', () => {
    expect(primaryPublicEventCreditToPhotographerRow([])).toBeNull();

    const nonPrimaryOnly: PublicEventCredit[] = [
      {
        businessName: 'Additional Studio',
        roleLabel: 'venue',
        isPrimary: false,
        logoUrl: null,
        websiteUrl: null,
        instagramUrl: null,
        facebookUrl: null,
        youtubeUrl: null,
      },
    ];
    expect(primaryPublicEventCreditToPhotographerRow(nonPrimaryOnly)).toBeNull();
  });
});

describe('canonicalRecordToWeddingTemplateRenderRow — adapter into the shared wedding-template-01 renderer', () => {
  it('re-derives event_date/event_time/timer_target_time from the one authoritative scheduledStartAt', () => {
    const row = canonicalRecordToWeddingTemplateRenderRow({
      id: 'event-uuid-1',
      studioId: 'studio-a',
      slug: 'raj-priya-wedding',
      eventType: 'Wedding',
      groomName: 'Raj',
      brideName: 'Priya',
      scheduledStartAt: '2026-12-01T18:30:00+05:30',
      venueName: 'Taj Krishna',
      templateId: 'wedding-template-01',
      guestPhotoWallEnabled: true,
      thumbnailUrl: 'https://r2.example/thumb.jpg',
    });

    expect(row).toEqual({
      id: 'event-uuid-1',
      slug: 'raj-priya-wedding',
      studio_id: 'studio-a',
      template_id: 'wedding-template-01',
      event_type: 'Wedding',
      groom_name: 'Raj',
      bride_name: 'Priya',
      event_date: '2026-12-01',
      event_time: '18:30',
      timer_target_time: '18:30',
      venue_name: 'Taj Krishna',
      guest_photo_wall_enabled: true,
      thumbnail_url: 'https://r2.example/thumb.jpg',
      event_credits: [],
    });
  });

  it('threads a supplied public Event Credit projection through as event_credits, defaulting to an empty list', () => {
    const credits: PublicEventCredit[] = [
      {
        businessName: 'Dream Captures',
        roleLabel: 'photographer',
        isPrimary: true,
        logoUrl: null,
        websiteUrl: null,
        instagramUrl: null,
        facebookUrl: null,
        youtubeUrl: null,
      },
    ];
    const row = canonicalRecordToWeddingTemplateRenderRow(
      {
        id: 'event-uuid-1',
        studioId: 'studio-a',
        slug: 'raj-priya-wedding',
        eventType: 'Wedding',
        groomName: 'Raj',
        brideName: 'Priya',
        scheduledStartAt: '2026-12-01T18:30:00+05:30',
        venueName: 'Taj Krishna',
        templateId: 'wedding-template-01',
        guestPhotoWallEnabled: true,
        thumbnailUrl: null,
      },
      credits
    );

    expect(row.event_credits).toEqual(credits);
  });

  it('projects event_time as 24-hour HH:mm, not the 12-hour AM/PM display string — regression test for the renderer double-formatting "6:30 PM" into "6:30 PM AM"', () => {
    const row = canonicalRecordToWeddingTemplateRenderRow({
      id: 'event-uuid-1',
      studioId: 'studio-a',
      slug: 'raj-priya-wedding',
      eventType: 'Wedding',
      groomName: 'Raj',
      brideName: 'Priya',
      scheduledStartAt: '2026-12-01T06:05:00+05:30',
      venueName: 'Taj Krishna',
      templateId: 'wedding-template-01',
      guestPhotoWallEnabled: true,
      thumbnailUrl: null,
    });

    // The renderer's own formatTime() expects 24-hour HH:mm input and does
    // its own 12-hour reformatting — event_time must never already be a
    // 12-hour "h:mm AM/PM" display string (that's what legacy.eventTime is,
    // and it must not be reused here).
    expect(row.event_time).toBe('06:05');
    expect(row.event_time).not.toMatch(/AM|PM/);
  });

  it('carries thumbnailUrl through as thumbnail_url (baseline SEO-001), but still never carries gallery, invitation video, YouTube, or venue-map fields — the Draft slice has none of those yet', () => {
    const row = canonicalRecordToWeddingTemplateRenderRow({
      id: 'event-uuid-1',
      studioId: 'studio-a',
      slug: 'raj-priya-wedding',
      eventType: 'Wedding',
      groomName: 'Raj',
      brideName: 'Priya',
      scheduledStartAt: '2026-12-01T18:30:00+05:30',
      venueName: 'Taj Krishna',
      templateId: 'wedding-template-01',
      guestPhotoWallEnabled: true,
      thumbnailUrl: 'https://r2.example/thumb.jpg',
    });

    expect(row.thumbnail_url).toBe('https://r2.example/thumb.jpg');

    for (const absent of [
      'gallery_urls',
      'invitation_video_url',
      'vod_link',
      'youtube_broadcast_id',
      'venue_map_link',
      'photographer_id',
    ]) {
      expect(row).not.toHaveProperty(absent);
    }
  });

  it('passes a null thumbnailUrl through safely for Drafts that have not had one assigned yet', () => {
    const row = canonicalRecordToWeddingTemplateRenderRow({
      id: 'event-uuid-1',
      studioId: 'studio-a',
      slug: 'raj-priya-wedding',
      eventType: 'Wedding',
      groomName: 'Raj',
      brideName: 'Priya',
      scheduledStartAt: '2026-12-01T18:30:00+05:30',
      venueName: 'Taj Krishna',
      templateId: 'wedding-template-01',
      guestPhotoWallEnabled: true,
      thumbnailUrl: null,
    });

    expect(row.thumbnail_url).toBeNull();
  });
});
