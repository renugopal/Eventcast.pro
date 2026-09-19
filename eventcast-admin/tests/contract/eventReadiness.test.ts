import { describe, expect, it } from 'vitest';
import {
  deriveEventReadiness,
  deriveNextAction,
  countItemsNeedingAttention,
  type EventReadinessInput,
} from '@/lib/eventReadiness';

const EMPTY_INPUT: EventReadinessInput = {
  pageState: 'draft',
  thumbnailUrl: null,
  venueMapLink: null,
  hasInvitationVideo: false,
  slideshowImageCount: 0,
  creditCount: 0,
  hasPrimaryCredit: false,
  livestreamEnabled: false,
  youtubeWatchUrl: null,
};

describe('deriveEventReadiness', () => {
  it('marks Publish as the only required item, and attention when still a Draft', () => {
    const items = deriveEventReadiness(EMPTY_INPUT);
    const publish = items.find((i) => i.id === 'publish')!;
    expect(publish.tier).toBe('required');
    expect(publish.state).toBe('attention');

    const published = deriveEventReadiness({ ...EMPTY_INPUT, pageState: 'published' });
    expect(published.find((i) => i.id === 'publish')!.state).toBe('complete');
  });

  it('never marks an optional item as needing attention, only complete or not_set', () => {
    const items = deriveEventReadiness(EMPTY_INPUT);
    const optionalItems = items.filter((i) => i.tier === 'optional');
    expect(optionalItems.length).toBeGreaterThan(0);
    for (const item of optionalItems) {
      expect(item.state === 'complete' || item.state === 'not_set').toBe(true);
    }
  });

  it('marks optional items complete once their underlying data exists', () => {
    const items = deriveEventReadiness({
      ...EMPTY_INPUT,
      hasInvitationVideo: true,
      slideshowImageCount: 3,
      venueMapLink: 'https://maps.google.com/x',
      livestreamEnabled: true,
      youtubeWatchUrl: 'https://youtube.com/watch?v=1',
    });
    expect(items.find((i) => i.id === 'invitation-video')!.state).toBe('complete');
    expect(items.find((i) => i.id === 'photo-slideshow')!.state).toBe('complete');
    expect(items.find((i) => i.id === 'venue-map')!.state).toBe('complete');
    expect(items.find((i) => i.id === 'livestream')!.state).toBe('complete');
    expect(items.find((i) => i.id === 'youtube')!.state).toBe('complete');
  });

  it('treats SEO thumbnail and Partner credits as recommended, needing attention when absent', () => {
    const items = deriveEventReadiness(EMPTY_INPUT);
    const thumbnail = items.find((i) => i.id === 'seo-thumbnail')!;
    const credits = items.find((i) => i.id === 'partner-credits')!;
    expect(thumbnail.tier).toBe('recommended');
    expect(thumbnail.state).toBe('attention');
    expect(credits.tier).toBe('recommended');
    expect(credits.state).toBe('attention');
  });

  it('marks Partner credits complete once at least one credit exists, even without a primary', () => {
    const items = deriveEventReadiness({ ...EMPTY_INPUT, creditCount: 1, hasPrimaryCredit: false });
    expect(items.find((i) => i.id === 'partner-credits')!.state).toBe('complete');
  });
});

describe('countItemsNeedingAttention', () => {
  it('counts only required/recommended attention items, never optional ones', () => {
    const items = deriveEventReadiness(EMPTY_INPUT);
    // publish + seo-thumbnail + partner-credits = 3 attention items on an
    // otherwise-empty Draft; the 5 optional items never count even though
    // they are all "not_set" here.
    expect(countItemsNeedingAttention(items)).toBe(3);
  });

  it('is zero once every required/recommended item is satisfied', () => {
    const items = deriveEventReadiness({
      ...EMPTY_INPUT,
      pageState: 'published',
      thumbnailUrl: 'https://cdn.example.com/thumb.png',
      creditCount: 1,
      hasPrimaryCredit: true,
    });
    expect(countItemsNeedingAttention(items)).toBe(0);
  });
});

describe('deriveNextAction', () => {
  it('sends an archived event to Settings to restore it', () => {
    const action = deriveNextAction({ lifecycle: 'archived', livestreamEnabled: false });
    expect(action?.actionTab).toBe('settings');
  });

  it('sends a Draft to the Event Page tab for Review & Publish, never a one-click publish', () => {
    const action = deriveNextAction({ lifecycle: 'draft', livestreamEnabled: false });
    expect(action?.actionTab).toBe('event-page');
    expect(action?.label.toLowerCase()).toContain('review');
  });

  it('returns null (loading) for a published event while livestream status is still unknown', () => {
    const action = deriveNextAction({ lifecycle: 'published', livestreamEnabled: null });
    expect(action).toBeNull();
  });

  it('suggests the optional livestream setup for a published event with no stream enabled', () => {
    const action = deriveNextAction({ lifecycle: 'published', livestreamEnabled: false });
    expect(action?.actionTab).toBe('live');
    expect(action?.tone).toBe('secondary');
    expect(action?.label.toLowerCase()).toContain('optional');
  });

  it('opens the Live Control Room for a published event with an enabled livestream', () => {
    const action = deriveNextAction({ lifecycle: 'published', livestreamEnabled: true });
    expect(action?.actionTab).toBe('live');
    expect(action?.tone).toBe('primary');
  });

  it('treats upcoming the same as published for next-action purposes', () => {
    const action = deriveNextAction({ lifecycle: 'upcoming', livestreamEnabled: true });
    expect(action?.actionTab).toBe('live');
    expect(action?.tone).toBe('primary');
  });
});
