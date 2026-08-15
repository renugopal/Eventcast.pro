import { describe, expect, it, vi } from 'vitest';
import {
  attachEventCredit,
  attachQueuedCreditsSequentially,
  canManagePartners,
  createPartner,
  deleteEventCredit,
  deletePartner,
  EMPTY_PARTNER_FORM,
  fetchEventCredits,
  fetchPartners,
  filterPartners,
  partnerFormToPayload,
  partnerToFormValues,
  updateEventCredit,
  updatePartner,
  type EventCreditRecord,
  type Fetcher,
  type PartnerFormValues,
  type PartnerRecord,
  type QueuedCredit,
} from '@/lib/partnerCreditClient';

/**
 * Focused unit tests for the Create/Edit Event Partner Credit integration
 * UI's client-side data layer. These are pure functions (no React/DOM), so
 * they run under the repository's existing Node-environment Vitest setup
 * without needing a new component-testing framework.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const PARTNER_A: PartnerRecord = {
  id: 'partner-a',
  partner_type: 'photographer',
  business_name: 'Studio Light Photography',
  contact_person: 'Ravi Kumar',
  phone: null,
  whatsapp: null,
  city: 'Hyderabad',
  instagram_url: null,
  facebook_url: null,
  youtube_url: null,
  website_url: null,
  logo_url: null,
  internal_notes: null,
};

const PARTNER_B: PartnerRecord = {
  ...PARTNER_A,
  id: 'partner-b',
  business_name: 'Grand Hall Venue',
  contact_person: 'Anita Rao',
  city: 'Vijayawada',
};

describe('filterPartners', () => {
  it('returns every partner for an empty/whitespace query', () => {
    expect(filterPartners([PARTNER_A, PARTNER_B], '')).toHaveLength(2);
    expect(filterPartners([PARTNER_A, PARTNER_B], '   ')).toHaveLength(2);
  });

  it('matches case-insensitively by business name, contact person, or city', () => {
    expect(filterPartners([PARTNER_A, PARTNER_B], 'studio light')).toEqual([PARTNER_A]);
    expect(filterPartners([PARTNER_A, PARTNER_B], 'anita')).toEqual([PARTNER_B]);
    expect(filterPartners([PARTNER_A, PARTNER_B], 'VIJAYAWADA')).toEqual([PARTNER_B]);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterPartners([PARTNER_A, PARTNER_B], 'no such partner')).toEqual([]);
  });
});

describe('fetchPartners / createPartner', () => {
  it('fetchPartners calls GET /api/partners and returns the list', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(jsonResponse({ success: true, partners: [PARTNER_A] }));
    const result = await fetchPartners(fetcher);
    expect(fetcher).toHaveBeenCalledWith('/api/partners');
    expect(result).toEqual([PARTNER_A]);
  });

  it('fetchPartners surfaces the server error message on failure', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(jsonResponse({ success: false, error: 'boom' }, 500));
    await expect(fetchPartners(fetcher)).rejects.toThrow('boom');
  });

  it('createPartner POSTs the payload and returns the created partner', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(jsonResponse({ success: true, partner: PARTNER_A }));
    const result = await createPartner(fetcher, { partnerType: 'photographer', businessName: 'Studio Light Photography' });

    expect(fetcher).toHaveBeenCalledWith('/api/partners', {
      method: 'POST',
      body: JSON.stringify({ partnerType: 'photographer', businessName: 'Studio Light Photography' }),
    });
    expect(result).toEqual(PARTNER_A);
  });

  it('createPartner surfaces a validation error from the API', async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValue(jsonResponse({ success: false, error: 'businessName is required', field: 'businessName' }, 400));
    await expect(createPartner(fetcher, { partnerType: 'venue', businessName: '' })).rejects.toThrow(
      'businessName is required'
    );
  });
});

const CREDIT_PRIMARY: EventCreditRecord = {
  id: 'credit-1',
  event_id: 'event-1',
  partner_id: 'partner-a',
  role_label: 'photographer',
  is_primary: true,
  created_at: '2026-08-10T00:00:00Z',
};

describe('event credit attach/update/delete', () => {
  it('fetchEventCredits calls the scoped list endpoint', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(jsonResponse({ success: true, credits: [CREDIT_PRIMARY] }));
    const result = await fetchEventCredits(fetcher, 'event-1');
    expect(fetcher).toHaveBeenCalledWith('/api/events/event-1/credits');
    expect(result).toEqual([CREDIT_PRIMARY]);
  });

  it('attachEventCredit POSTs to the scoped endpoint and returns the created credit', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(jsonResponse({ success: true, credit: CREDIT_PRIMARY }));
    const result = await attachEventCredit(fetcher, 'event-1', { partnerId: 'partner-a', roleLabel: 'photographer', isPrimary: true });

    expect(fetcher).toHaveBeenCalledWith('/api/events/event-1/credits', {
      method: 'POST',
      body: JSON.stringify({ partnerId: 'partner-a', roleLabel: 'photographer', isPrimary: true }),
    });
    expect(result).toEqual(CREDIT_PRIMARY);
  });

  it('attachEventCredit surfaces the existing 409 duplicate/primary-conflict message', async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValue(
        jsonResponse(
          { success: false, error: 'This event already has a primary credit. Update or remove it before assigning a new one.' },
          409
        )
      );
    await expect(
      attachEventCredit(fetcher, 'event-1', { partnerId: 'partner-b', roleLabel: 'venue', isPrimary: true })
    ).rejects.toThrow('This event already has a primary credit');
  });

  it('updateEventCredit PATCHes only the provided fields', async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValue(jsonResponse({ success: true, credit: { ...CREDIT_PRIMARY, is_primary: false } }));
    await updateEventCredit(fetcher, 'event-1', 'credit-1', { isPrimary: false });

    expect(fetcher).toHaveBeenCalledWith('/api/events/event-1/credits/credit-1', {
      method: 'PATCH',
      body: JSON.stringify({ isPrimary: false }),
    });
  });

  it('deleteEventCredit DELETEs the scoped endpoint', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(jsonResponse({ success: true }));
    await deleteEventCredit(fetcher, 'event-1', 'credit-1');

    expect(fetcher).toHaveBeenCalledWith('/api/events/event-1/credits/credit-1', { method: 'DELETE' });
  });

  it('deleteEventCredit surfaces a server failure', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(jsonResponse({ success: false, error: 'Event credit not found' }, 404));
    await expect(deleteEventCredit(fetcher, 'event-1', 'missing')).rejects.toThrow('Event credit not found');
  });
});

describe('attachQueuedCreditsSequentially — new-Draft credit attach sequencing', () => {
  const PRIMARY: QueuedCredit = {
    tempId: 'q1',
    partnerId: 'partner-a',
    partnerLabel: 'Studio Light Photography',
    roleLabel: 'photographer',
    isPrimary: true,
  };
  const ADDITIONAL: QueuedCredit = {
    tempId: 'q2',
    partnerId: 'partner-b',
    partnerLabel: 'Grand Hall Venue',
    roleLabel: 'venue',
    isPrimary: false,
  };

  it('attaches the primary credit first, then additional credits, all succeeding', async () => {
    const fetcher = vi.fn<Fetcher>().mockImplementation(async (url) => {
      if (url === '/api/events/event-1/credits') {
        return jsonResponse({ success: true, credit: { ...CREDIT_PRIMARY, id: `credit-for-${fetcher.mock.calls.length}` } });
      }
      throw new Error(`unexpected url ${url}`);
    });

    // Queue additional before primary — sequencing must still attach primary first.
    const result = await attachQueuedCreditsSequentially(fetcher, 'event-1', [ADDITIONAL, PRIMARY]);

    expect(result.failures).toEqual([]);
    expect(result.attached).toHaveLength(2);
    const firstCallBody = JSON.parse((fetcher.mock.calls[0][1]?.body as string) ?? '{}');
    expect(firstCallBody.partnerId).toBe('partner-a'); // primary attached first
  });

  it('continues past a per-credit failure and reports it without aborting the batch', async () => {
    let call = 0;
    const fetcher = vi.fn<Fetcher>().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        // Primary attach fails (e.g. a stale primary conflict).
        return jsonResponse({ success: false, error: 'This event already has a primary credit.' }, 409);
      }
      return jsonResponse({ success: true, credit: { ...CREDIT_PRIMARY, id: 'credit-2', is_primary: false } });
    });

    const result = await attachQueuedCreditsSequentially(fetcher, 'event-1', [ADDITIONAL, PRIMARY]);

    expect(fetcher).toHaveBeenCalledTimes(2); // both attempted, no abort after the first failure
    expect(result.attached).toHaveLength(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].credit.tempId).toBe('q1');
    expect(result.failures[0].error).toContain('already has a primary credit');
  });

  it('returns empty attached/failures for an empty queue without calling the fetcher', async () => {
    const fetcher = vi.fn<Fetcher>();
    const result = await attachQueuedCreditsSequentially(fetcher, 'event-1', []);
    expect(result).toEqual({ attached: [], failures: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

/**
 * Standalone Partner Directory client behavior (Baseline V2.1 PART-001/002).
 * Account-level master-data management against the same Partner CRUD API —
 * no second backend, no second data model.
 */
describe('Partner Directory — role gating', () => {
  it('treats owner and admin as writable', () => {
    expect(canManagePartners('owner')).toBe(true);
    expect(canManagePartners('admin')).toBe(true);
  });

  it('treats member as read-only', () => {
    expect(canManagePartners('member')).toBe(false);
  });

  it('fails closed on an unknown role', () => {
    expect(canManagePartners('viewer')).toBe(false);
    expect(canManagePartners('')).toBe(false);
  });
});

describe('Partner Directory — form serialization', () => {
  const FILLED_FORM: PartnerFormValues = {
    partnerType: 'venue',
    businessName: '  Grand Hall Venue  ',
    contactPerson: 'Anita Rao',
    phone: '+91 90000 00000',
    whatsapp: '',
    city: 'Vijayawada',
    instagramUrl: '',
    facebookUrl: '',
    youtubeUrl: '',
    websiteUrl: 'https://grandhall.example',
    logoUrl: 'https://cdn.example/logo.png',
    internalNotes: 'Prefers evening calls',
  };

  it('trims values and converts blank optional fields to null', () => {
    const payload = partnerFormToPayload(FILLED_FORM);

    expect(payload.businessName).toBe('Grand Hall Venue');
    expect(payload.city).toBe('Vijayawada');
    expect(payload.whatsapp).toBeNull();
    expect(payload.instagramUrl).toBeNull();
  });

  it('never emits ownership or system-managed fields', () => {
    const payload = partnerFormToPayload(FILLED_FORM) as unknown as Record<string, unknown>;

    for (const forbidden of ['id', 'studioId', 'studio_id', 'createdAt', 'created_at', 'updatedAt', 'updated_at']) {
      expect(payload).not.toHaveProperty(forbidden);
    }
    expect(Object.keys(payload).sort()).toEqual([
      'businessName',
      'city',
      'contactPerson',
      'facebookUrl',
      'instagramUrl',
      'internalNotes',
      'logoUrl',
      'partnerType',
      'phone',
      'websiteUrl',
      'whatsapp',
      'youtubeUrl',
    ]);
  });

  it('ignores any extra ownership field smuggled into form state', () => {
    const tainted = { ...FILLED_FORM, studio_id: 'studio-b', id: 'partner-x' } as PartnerFormValues;
    const payload = partnerFormToPayload(tainted) as unknown as Record<string, unknown>;

    expect(payload).not.toHaveProperty('studio_id');
    expect(payload).not.toHaveProperty('id');
  });

  it('keeps internalNotes inside the Partner CRUD payload only', () => {
    const payload = partnerFormToPayload(FILLED_FORM);

    // Present for the Partner master record...
    expect(payload.internalNotes).toBe('Prefers evening calls');
    // ...and this directory code produces no Event Credit / public snapshot
    // object at all — it emits only the Partner writable field set.
    expect(payload).not.toHaveProperty('roleLabel');
    expect(payload).not.toHaveProperty('isPrimary');
    expect(payload).not.toHaveProperty('eventCredits');
    expect(payload).not.toHaveProperty('publishedCredits');
  });

  it('round-trips an existing partner into editable form values', () => {
    const values = partnerToFormValues(PARTNER_A);

    expect(values.businessName).toBe('Studio Light Photography');
    expect(values.contactPerson).toBe('Ravi Kumar');
    // Null columns become empty strings for controlled inputs...
    expect(values.whatsapp).toBe('');
    // ...and serialize straight back to null, not to an empty string.
    expect(partnerFormToPayload(values).whatsapp).toBeNull();
  });
});

describe('Partner Directory — update/delete client helpers', () => {
  it('updatePartner PATCHes the scoped partner endpoint', async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValue(jsonResponse({ success: true, partner: { ...PARTNER_A, city: 'Chennai' } }));
    const result = await updatePartner(fetcher, 'partner-a', { city: 'Chennai' });

    expect(fetcher).toHaveBeenCalledWith('/api/partners/partner-a', {
      method: 'PATCH',
      body: JSON.stringify({ city: 'Chennai' }),
    });
    expect(result.city).toBe('Chennai');
  });

  it('updatePartner surfaces a server validation error', async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValue(jsonResponse({ success: false, error: 'businessName cannot be empty' }, 400));

    await expect(updatePartner(fetcher, 'partner-a', { businessName: '' })).rejects.toThrow(
      'businessName cannot be empty'
    );
  });

  it('updatePartner surfaces the role-authorization failure rather than swallowing it', async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValue(
        jsonResponse({ success: false, error: 'Forbidden: your studio role cannot modify partners' }, 403)
      );

    await expect(updatePartner(fetcher, 'partner-a', { city: 'Chennai' })).rejects.toThrow(
      'Forbidden: your studio role cannot modify partners'
    );
  });

  it('deletePartner DELETEs the scoped partner endpoint', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(jsonResponse({ success: true }));
    await deletePartner(fetcher, 'partner-a');

    expect(fetcher).toHaveBeenCalledWith('/api/partners/partner-a', { method: 'DELETE' });
  });

  it('deletePartner surfaces the 409 "still credited on an event" conflict verbatim', async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValue(
        jsonResponse(
          { success: false, error: 'This partner is credited on one or more events and cannot be deleted.' },
          409
        )
      );

    await expect(deletePartner(fetcher, 'partner-a')).rejects.toThrow(
      'This partner is credited on one or more events and cannot be deleted.'
    );
  });

  it('createPartner sends the full directory field set', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(jsonResponse({ success: true, partner: PARTNER_A }));
    await createPartner(fetcher, partnerFormToPayload(EMPTY_PARTNER_FORM));

    const body = JSON.parse((fetcher.mock.calls[0][1]?.body as string) ?? '{}');
    expect(body.partnerType).toBe('photographer');
    expect(body).toHaveProperty('logoUrl', null);
    expect(body).toHaveProperty('internalNotes', null);
    expect(body).not.toHaveProperty('studio_id');
  });
});
