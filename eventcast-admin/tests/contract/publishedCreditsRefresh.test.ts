import { describe, expect, it } from 'vitest';
import type { PublicEventCredit } from '@/lib/eventContract';
import { derivePublishedCreditsStatus, publishedCreditsEqual } from '@/lib/publishedCreditsRefresh';

const PRIMARY: PublicEventCredit = {
  businessName: 'Primary Studio',
  roleLabel: 'photographer',
  isPrimary: true,
  logoUrl: 'https://cdn.example.com/logo.png',
  websiteUrl: null,
  instagramUrl: null,
  facebookUrl: null,
  youtubeUrl: null,
};

const ADDITIONAL: PublicEventCredit = {
  businessName: 'Additional Venue',
  roleLabel: 'venue',
  isPrimary: false,
  logoUrl: null,
  websiteUrl: null,
  instagramUrl: null,
  facebookUrl: null,
  youtubeUrl: null,
};

describe('publishedCreditsEqual', () => {
  it('treats identical lists as equal', () => {
    expect(publishedCreditsEqual([PRIMARY, ADDITIONAL], [PRIMARY, ADDITIONAL])).toBe(true);
  });

  it('treats two empty lists as equal (a credit-less page that is up to date)', () => {
    expect(publishedCreditsEqual([], [])).toBe(true);
  });

  it('is order-sensitive — a reordering is a visible page change', () => {
    expect(publishedCreditsEqual([ADDITIONAL, PRIMARY], [PRIMARY, ADDITIONAL])).toBe(false);
  });

  it('detects a changed public field (e.g. a Partner logo edit)', () => {
    expect(publishedCreditsEqual([PRIMARY], [{ ...PRIMARY, logoUrl: 'https://cdn.example.com/new.png' }])).toBe(false);
  });

  it('detects an added or removed credit', () => {
    expect(publishedCreditsEqual([PRIMARY], [PRIMARY, ADDITIONAL])).toBe(false);
    expect(publishedCreditsEqual([PRIMARY, ADDITIONAL], [PRIMARY])).toBe(false);
  });

  it('treats a missing optional field and null as the same value', () => {
    const { youtubeUrl: _omitted, ...withoutYoutube } = PRIMARY;
    void _omitted;
    expect(publishedCreditsEqual([withoutYoutube as PublicEventCredit], [{ ...PRIMARY, youtubeUrl: null }])).toBe(true);
  });

  it('never equals when the frozen value is null or malformed (fails toward "update needed")', () => {
    expect(publishedCreditsEqual(null, [])).toBe(false);
    expect(publishedCreditsEqual(undefined, [PRIMARY])).toBe(false);
    expect(publishedCreditsEqual('not-an-array', [PRIMARY])).toBe(false);
    expect(publishedCreditsEqual([null], [PRIMARY])).toBe(false);
  });
});

describe('derivePublishedCreditsStatus', () => {
  it('reports needsUpdate only for a Published, non-archived event whose snapshot differs', () => {
    const status = derivePublishedCreditsStatus({
      pageState: 'published',
      archivedAt: null,
      frozen: [PRIMARY],
      current: [PRIMARY, ADDITIONAL],
    });
    expect(status).toEqual({ needsUpdate: true, frozenCount: 1, currentCount: 2 });
  });

  it('reports no update needed when the snapshot matches', () => {
    const status = derivePublishedCreditsStatus({
      pageState: 'published',
      archivedAt: null,
      frozen: [PRIMARY],
      current: [PRIMARY],
    });
    expect(status.needsUpdate).toBe(false);
  });

  it('never reports needsUpdate for a Draft, and exposes a null frozen count', () => {
    const status = derivePublishedCreditsStatus({
      pageState: 'draft',
      archivedAt: null,
      frozen: null,
      current: [PRIMARY],
    });
    expect(status).toEqual({ needsUpdate: false, frozenCount: null, currentCount: 1 });
  });

  it('never reports needsUpdate for an archived event even when the snapshot differs', () => {
    const status = derivePublishedCreditsStatus({
      pageState: 'published',
      archivedAt: '2026-09-01T00:00:00+00:00',
      frozen: [],
      current: [PRIMARY],
    });
    expect(status.needsUpdate).toBe(false);
    expect(status.frozenCount).toBe(0);
  });
});
