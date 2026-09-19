import { describe, expect, it } from 'vitest';
import { publicEventUrl } from '@/lib/publicEventUrl';

describe('publicEventUrl', () => {
  it('builds the exact existing public event URL format', () => {
    expect(publicEventUrl('raj-priya-wedding')).toBe('https://eventcast.pro/events/raj-priya-wedding');
  });

  it('returns null for a missing or empty slug', () => {
    expect(publicEventUrl(null)).toBeNull();
    expect(publicEventUrl(undefined)).toBeNull();
    expect(publicEventUrl('')).toBeNull();
  });
});
