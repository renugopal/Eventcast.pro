import { describe, expect, it } from 'vitest';
import { createFromMock } from './support/mocks';
import { freezePublishedEventCredits } from '@/lib/publishedCreditsSnapshot';

const OWNED_EVENT_NEVER_FROZEN = { id: 'event-1', published_credits: null };
const OWNED_EVENT_ALREADY_FROZEN = {
  id: 'event-1',
  published_credits: [{ businessName: 'Existing Studio', roleLabel: 'photographer', isPrimary: true, logoUrl: null, websiteUrl: null, instagramUrl: null, facebookUrl: null, youtubeUrl: null }],
};

const PRIMARY_CREDIT_ROW = {
  role_label: 'photographer',
  is_primary: true,
  partners: {
    business_name: 'Primary Studio',
    logo_url: 'https://cdn.example.com/logo.png',
    website_url: 'https://primary.example.com',
    instagram_url: null,
    facebook_url: null,
    youtube_url: null,
  },
};

const ADDITIONAL_CREDIT_ROW = {
  role_label: 'venue',
  is_primary: false,
  partners: {
    business_name: 'Additional Venue',
    logo_url: null,
    website_url: null,
    instagram_url: null,
    facebook_url: null,
    youtube_url: null,
  },
};

const UPDATE_OK = { data: { id: 'event-1' }, error: null };

describe('freezePublishedEventCredits', () => {
  it('rejects a cross-tenant or nonexistent event with a generic not_found, before any credit read', async () => {
    const mockDb = { from: createFromMock({ events: [{ data: null, error: null }] }) };

    const result = await freezePublishedEventCredits(mockDb, 'event-1', 'studio-a');

    expect(result).toEqual({ status: 'not_found' });
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('freezes a valid empty public-credit snapshot for a no-credit event rather than leaking or failing silently', async () => {
    const mockDb = {
      from: createFromMock({
        events: [{ data: OWNED_EVENT_NEVER_FROZEN, error: null }, UPDATE_OK],
        event_credits: [{ data: [], error: null }],
      }),
    };

    const result = await freezePublishedEventCredits(mockDb, 'event-1', 'studio-a');

    expect(result).toEqual({ status: 'ok', snapshot: [] });
  });

  it('projects primary-first ordering and only public-safe fields into the frozen snapshot', async () => {
    const mockDb = {
      from: createFromMock({
        events: [{ data: OWNED_EVENT_NEVER_FROZEN, error: null }, UPDATE_OK],
        event_credits: [{ data: [ADDITIONAL_CREDIT_ROW, PRIMARY_CREDIT_ROW], error: null }],
      }),
    };

    const result = await freezePublishedEventCredits(mockDb, 'event-1', 'studio-a');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.snapshot).toEqual([
      {
        businessName: 'Primary Studio',
        roleLabel: 'photographer',
        isPrimary: true,
        logoUrl: 'https://cdn.example.com/logo.png',
        websiteUrl: 'https://primary.example.com',
        instagramUrl: null,
        facebookUrl: null,
        youtubeUrl: null,
      },
      {
        businessName: 'Additional Venue',
        roleLabel: 'venue',
        isPrimary: false,
        logoUrl: null,
        websiteUrl: null,
        instagramUrl: null,
        facebookUrl: null,
        youtubeUrl: null,
      },
    ]);
    for (const credit of result.snapshot) {
      expect(Object.keys(credit).sort()).toEqual(
        ['businessName', 'facebookUrl', 'instagramUrl', 'isPrimary', 'logoUrl', 'roleLabel', 'websiteUrl', 'youtubeUrl'].sort()
      );
    }
  });

  it('does not overwrite an already-frozen snapshot, and never queries event_credits to get there', async () => {
    const mockDb = {
      from: createFromMock({
        events: [{ data: OWNED_EVENT_ALREADY_FROZEN, error: null }],
      }),
    };

    const result = await freezePublishedEventCredits(mockDb, 'event-1', 'studio-a');

    expect(result).toEqual({ status: 'already_frozen', snapshot: OWNED_EVENT_ALREADY_FROZEN.published_credits });
    expect(mockDb.from).toHaveBeenCalledTimes(1);
    expect(mockDb.from).not.toHaveBeenCalledWith('event_credits');
  });

  it('fails closed on a credit-query failure and never attempts the write', async () => {
    const mockDb = {
      from: createFromMock({
        events: [{ data: OWNED_EVENT_NEVER_FROZEN, error: null }],
        event_credits: [{ data: null, error: { message: 'boom' } }],
      }),
    };

    const result = await freezePublishedEventCredits(mockDb, 'event-1', 'studio-a');

    expect(result).toEqual({ status: 'query_failed' });
    // Only the ownership read touched `events` — no second call for the write.
    expect(mockDb.from).toHaveBeenCalledTimes(2);
  });

  it('surfaces a database write failure clearly instead of reporting success', async () => {
    const mockDb = {
      from: createFromMock({
        events: [
          { data: OWNED_EVENT_NEVER_FROZEN, error: null },
          { data: null, error: { message: 'connection reset' } },
        ],
        event_credits: [{ data: [PRIMARY_CREDIT_ROW], error: null }],
      }),
    };

    const result = await freezePublishedEventCredits(mockDb, 'event-1', 'studio-a');

    expect(result).toEqual({ status: 'write_failed' });
  });

  it('scopes the write to both the event id and the authenticated studio id, writing only published_credits', async () => {
    const mockDb = {
      from: createFromMock({
        events: [{ data: OWNED_EVENT_NEVER_FROZEN, error: null }, UPDATE_OK],
        event_credits: [{ data: [PRIMARY_CREDIT_ROW], error: null }],
      }),
    };

    await freezePublishedEventCredits(mockDb, 'event-1', 'studio-a');

    // `.from()` is shared across tables/calls in call order (events, then
    // event_credits, then events again for the write) — find the second
    // `.from('events')` call specifically rather than assuming an index.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fromMock = mockDb.from as any;
    const eventsCallIndexes: number[] = fromMock.mock.calls
      .map((args: unknown[], i: number) => (args[0] === 'events' ? i : -1))
      .filter((i: number) => i !== -1);
    expect(eventsCallIndexes).toHaveLength(2);
    const writeBuilder = fromMock.mock.results[eventsCallIndexes[1]].value;

    expect(writeBuilder.update).toHaveBeenCalledWith({ published_credits: [expect.objectContaining({ businessName: 'Primary Studio' })] });
    expect(writeBuilder.eq).toHaveBeenNthCalledWith(1, 'id', 'event-1');
    expect(writeBuilder.eq).toHaveBeenNthCalledWith(2, 'studio_id', 'studio-a');
  });
});
