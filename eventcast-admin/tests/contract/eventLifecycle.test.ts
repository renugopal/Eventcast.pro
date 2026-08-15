import { describe, expect, it } from 'vitest';
import { deriveEventLifecycleStatus, EVENT_LIFECYCLE_LABELS, EVENT_LIFECYCLE_BADGE_CLASSES } from '@/lib/eventLifecycle';

const PAST = '2000-01-01T00:00:00+05:30';
const FUTURE = '2999-01-01T00:00:00+05:30';

describe('deriveEventLifecycleStatus', () => {
  it('is archived when archived_at is set, regardless of page_state', () => {
    expect(
      deriveEventLifecycleStatus({ archived_at: '2026-01-01T00:00:00Z', page_state: 'published', scheduled_start_at: FUTURE })
    ).toBe('archived');
    expect(
      deriveEventLifecycleStatus({ archived_at: '2026-01-01T00:00:00Z', page_state: 'draft', scheduled_start_at: FUTURE })
    ).toBe('archived');
  });

  it('is draft when page_state is draft, even if scheduled_start_at is in the future', () => {
    expect(deriveEventLifecycleStatus({ archived_at: null, page_state: 'draft', scheduled_start_at: FUTURE })).toBe('draft');
  });

  it('is upcoming when published with a future scheduled_start_at', () => {
    expect(deriveEventLifecycleStatus({ archived_at: null, page_state: 'published', scheduled_start_at: FUTURE })).toBe(
      'upcoming'
    );
  });

  it('is published (not "completed" or "live") when published with a past scheduled_start_at', () => {
    expect(deriveEventLifecycleStatus({ archived_at: null, page_state: 'published', scheduled_start_at: PAST })).toBe(
      'published'
    );
  });

  it('is published when published with no schedule evidence at all', () => {
    expect(deriveEventLifecycleStatus({ archived_at: null, page_state: 'published', scheduled_start_at: null })).toBe(
      'published'
    );
  });

  it('falls back to legacy event_date only when scheduled_start_at is null', () => {
    expect(
      deriveEventLifecycleStatus({
        archived_at: null,
        page_state: 'published',
        scheduled_start_at: null,
        event_date: '2999-01-01',
      })
    ).toBe('upcoming');
    expect(
      deriveEventLifecycleStatus({
        archived_at: null,
        page_state: 'published',
        scheduled_start_at: null,
        event_date: '2000-01-01',
      })
    ).toBe('published');
  });

  it('prefers scheduled_start_at over event_date when both are present', () => {
    expect(
      deriveEventLifecycleStatus({
        archived_at: null,
        page_state: 'published',
        scheduled_start_at: PAST,
        event_date: '2999-01-01',
      })
    ).toBe('published');
  });

  it('exposes a label and a badge class for every status it can return', () => {
    for (const status of ['draft', 'upcoming', 'published', 'archived'] as const) {
      expect(EVENT_LIFECYCLE_LABELS[status]).toBeTruthy();
      expect(EVENT_LIFECYCLE_BADGE_CLASSES[status]).toBeDefined();
    }
  });
});
