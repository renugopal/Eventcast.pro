import { describe, expect, it } from 'vitest';
import {
  getOwnedEventById,
  getOwnedEventBySlug,
  isOwnershipError,
} from '@/lib/ownership';
import { createFromMock } from './support/mocks';

describe('getOwnedEventById', () => {
  it('returns the event for a same-studio lookup, scoped by both id and studio_id', async () => {
    const fromMock = createFromMock({
      events: [{ data: { id: 'evt-1', slug: 'evt-1-slug' }, error: null }],
    });

    const result = await getOwnedEventById({ from: fromMock }, 'evt-1', 'studio-a', 'id, slug');

    expect(isOwnershipError(result)).toBe(false);
    if (isOwnershipError(result)) throw new Error('unreachable');
    expect(result.event).toEqual({ id: 'evt-1', slug: 'evt-1-slug' });

    const builder = fromMock.mock.results[0].value;
    expect(builder.eq.mock.calls).toEqual([
      ['id', 'evt-1'],
      ['studio_id', 'studio-a'],
    ]);
  });

  it('returns a generic 404 for a cross-tenant lookup', async () => {
    const fromMock = createFromMock({
      events: [{ data: null, error: null }],
    });

    const result = await getOwnedEventById({ from: fromMock }, 'evt-1', 'studio-b');
    expect(isOwnershipError(result)).toBe(true);
    if (!isOwnershipError(result)) throw new Error('unreachable');
    expect(result.error.status).toBe(404);
    expect(await result.error.json()).toEqual({ success: false, error: 'Event not found' });
  });

  it('returns the identical generic 404 for a nonexistent event id', async () => {
    const fromMock = createFromMock({
      events: [{ data: null, error: null }],
    });

    const result = await getOwnedEventById({ from: fromMock }, 'does-not-exist', 'studio-a');
    expect(isOwnershipError(result)).toBe(true);
    if (!isOwnershipError(result)) throw new Error('unreachable');
    expect(result.error.status).toBe(404);
    expect(await result.error.json()).toEqual({ success: false, error: 'Event not found' });
  });
});

describe('getOwnedEventBySlug', () => {
  it('returns the event for a same-studio lookup, scoped by both slug and studio_id', async () => {
    const fromMock = createFromMock({
      events: [{ data: { slug: 'evt-1-slug', youtube_stream_key: 'key' }, error: null }],
    });

    const result = await getOwnedEventBySlug(
      { from: fromMock },
      'evt-1-slug',
      'studio-a',
      'slug, youtube_stream_key'
    );

    expect(isOwnershipError(result)).toBe(false);
    if (isOwnershipError(result)) throw new Error('unreachable');
    expect(result.event).toEqual({ slug: 'evt-1-slug', youtube_stream_key: 'key' });

    const builder = fromMock.mock.results[0].value;
    expect(builder.eq.mock.calls).toEqual([
      ['slug', 'evt-1-slug'],
      ['studio_id', 'studio-a'],
    ]);
  });

  it('returns a generic 404 for a cross-tenant slug lookup', async () => {
    const fromMock = createFromMock({
      events: [{ data: null, error: null }],
    });

    const result = await getOwnedEventBySlug({ from: fromMock }, 'evt-1-slug', 'studio-b');
    expect(isOwnershipError(result)).toBe(true);
    if (!isOwnershipError(result)) throw new Error('unreachable');
    expect(result.error.status).toBe(404);
    expect(await result.error.json()).toEqual({ success: false, error: 'Event not found' });
  });

  it('returns the identical generic 404 for a nonexistent slug', async () => {
    const fromMock = createFromMock({
      events: [{ data: null, error: null }],
    });

    const result = await getOwnedEventBySlug({ from: fromMock }, 'does-not-exist', 'studio-a');
    expect(isOwnershipError(result)).toBe(true);
    if (!isOwnershipError(result)) throw new Error('unreachable');
    expect(result.error.status).toBe(404);
    expect(await result.error.json()).toEqual({ success: false, error: 'Event not found' });
  });
});
