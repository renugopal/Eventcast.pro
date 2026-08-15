import { type PartnerType } from './partnerFields';

/**
 * Client-side data helpers for the Create/Edit Event Partner Credit
 * integration UI. Pure functions (no JSX) so the request shapes and the
 * new-Draft attach-sequencing behavior can be unit tested without a DOM.
 * Wraps the already-completed Partner CRUD and Event Credit APIs only —
 * no new backend route is introduced here.
 */

export interface PartnerRecord {
  id: string;
  partner_type: PartnerType;
  business_name: string;
  contact_person: string | null;
  phone: string | null;
  whatsapp: string | null;
  city: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  youtube_url: string | null;
  website_url: string | null;
  logo_url: string | null;
  internal_notes: string | null;
}

export interface EventCreditRecord {
  id: string;
  event_id: string;
  partner_id: string;
  role_label: PartnerType;
  is_primary: boolean;
  created_at: string;
}

export interface PartnerCreatePayload {
  partnerType: PartnerType;
  businessName: string;
  contactPerson?: string;
  phone?: string;
  city?: string;
}

/**
 * The full writable Partner field set accepted by the Partner CRUD API.
 * Deliberately excludes `id`, `studio_id`, `created_at`, and `updated_at` —
 * ownership and timestamps are the API's responsibility and are never sent
 * from the client.
 */
export interface PartnerWritableFields {
  partnerType: PartnerType;
  businessName: string;
  contactPerson?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  city?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  youtubeUrl?: string | null;
  websiteUrl?: string | null;
  logoUrl?: string | null;
  internalNotes?: string | null;
}

/** Form state for the standalone Partner Directory create/edit form. */
export interface PartnerFormValues {
  partnerType: PartnerType;
  businessName: string;
  contactPerson: string;
  phone: string;
  whatsapp: string;
  city: string;
  instagramUrl: string;
  facebookUrl: string;
  youtubeUrl: string;
  websiteUrl: string;
  logoUrl: string;
  internalNotes: string;
}

export const EMPTY_PARTNER_FORM: PartnerFormValues = {
  partnerType: 'photographer',
  businessName: '',
  contactPerson: '',
  phone: '',
  whatsapp: '',
  city: '',
  instagramUrl: '',
  facebookUrl: '',
  youtubeUrl: '',
  websiteUrl: '',
  logoUrl: '',
  internalNotes: '',
};

export function partnerToFormValues(partner: PartnerRecord): PartnerFormValues {
  return {
    partnerType: partner.partner_type,
    businessName: partner.business_name,
    contactPerson: partner.contact_person ?? '',
    phone: partner.phone ?? '',
    whatsapp: partner.whatsapp ?? '',
    city: partner.city ?? '',
    instagramUrl: partner.instagram_url ?? '',
    facebookUrl: partner.facebook_url ?? '',
    youtubeUrl: partner.youtube_url ?? '',
    websiteUrl: partner.website_url ?? '',
    logoUrl: partner.logo_url ?? '',
    internalNotes: partner.internal_notes ?? '',
  };
}

/**
 * Serializes directory form state into the API payload. Blank optional fields
 * become `null` so clearing a value in the edit form actually clears the
 * column — the PATCH route accepts `null` or `string` for these, and the POST
 * route already stores omitted fields as `null`. Only the writable field set
 * is emitted; no ownership or timestamp field can leak in from form state.
 */
export function partnerFormToPayload(values: PartnerFormValues): PartnerWritableFields {
  const optional = (value: string): string | null => {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  };

  return {
    partnerType: values.partnerType,
    businessName: values.businessName.trim(),
    contactPerson: optional(values.contactPerson),
    phone: optional(values.phone),
    whatsapp: optional(values.whatsapp),
    city: optional(values.city),
    instagramUrl: optional(values.instagramUrl),
    facebookUrl: optional(values.facebookUrl),
    youtubeUrl: optional(values.youtubeUrl),
    websiteUrl: optional(values.websiteUrl),
    logoUrl: optional(values.logoUrl),
    internalNotes: optional(values.internalNotes),
  };
}

/**
 * Whether a studio-member role may manage Partner records. Mirrors the
 * server-side rule (owner/admin may mutate, member is read-only) so the UI
 * renders honest controls. The server remains the authorization boundary —
 * this only decides what to show. Unknown values fail closed.
 */
export function canManagePartners(studioMemberRole: string): boolean {
  return studioMemberRole === 'owner' || studioMemberRole === 'admin';
}

/** A credit not yet attached to a real Event (no eventId exists yet). */
export interface QueuedCredit {
  tempId: string;
  partnerId: string;
  partnerLabel: string;
  roleLabel: PartnerType;
  isPrimary: boolean;
}

/** Minimal fetch-like signature — satisfied by both `fetch` and `authFetch`. */
export type Fetcher = (url: string, options?: RequestInit) => Promise<Response>;

async function parseJsonResponse<T>(res: Response, fallbackError: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.success === false) {
    throw new Error((data && typeof data.error === 'string' && data.error) || fallbackError);
  }
  return data as T;
}

/** Client-side substring search over the studio's existing Partner list. */
export function filterPartners(partners: PartnerRecord[], query: string): PartnerRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return partners;
  return partners.filter((p) => {
    return (
      p.business_name.toLowerCase().includes(q) ||
      (p.contact_person || '').toLowerCase().includes(q) ||
      (p.city || '').toLowerCase().includes(q)
    );
  });
}

export async function fetchPartners(fetcher: Fetcher): Promise<PartnerRecord[]> {
  const res = await fetcher('/api/partners');
  const data = await parseJsonResponse<{ partners: PartnerRecord[] }>(res, 'Failed to load partners');
  return data.partners;
}

export async function createPartner(fetcher: Fetcher, payload: PartnerWritableFields): Promise<PartnerRecord> {
  const res = await fetcher('/api/partners', { method: 'POST', body: JSON.stringify(payload) });
  const data = await parseJsonResponse<{ partner: PartnerRecord }>(res, 'Partner creation failed');
  return data.partner;
}

export async function updatePartner(
  fetcher: Fetcher,
  partnerId: string,
  payload: Partial<PartnerWritableFields>
): Promise<PartnerRecord> {
  const res = await fetcher(`/api/partners/${partnerId}`, { method: 'PATCH', body: JSON.stringify(payload) });
  const data = await parseJsonResponse<{ partner: PartnerRecord }>(res, 'Partner update failed');
  return data.partner;
}

/**
 * Deletes a Partner. The API answers 409 when the Partner is still credited
 * on an event (the FK deliberately blocks the delete); that server message is
 * surfaced verbatim by parseJsonResponse rather than being flattened into a
 * generic failure.
 */
export async function deletePartner(fetcher: Fetcher, partnerId: string): Promise<void> {
  const res = await fetcher(`/api/partners/${partnerId}`, { method: 'DELETE' });
  await parseJsonResponse(res, 'Partner deletion failed');
}

export async function fetchEventCredits(fetcher: Fetcher, eventId: string): Promise<EventCreditRecord[]> {
  const res = await fetcher(`/api/events/${eventId}/credits`);
  const data = await parseJsonResponse<{ credits: EventCreditRecord[] }>(res, 'Failed to load event credits');
  return data.credits;
}

export async function attachEventCredit(
  fetcher: Fetcher,
  eventId: string,
  payload: { partnerId: string; roleLabel: PartnerType; isPrimary: boolean }
): Promise<EventCreditRecord> {
  const res = await fetcher(`/api/events/${eventId}/credits`, { method: 'POST', body: JSON.stringify(payload) });
  const data = await parseJsonResponse<{ credit: EventCreditRecord }>(res, 'Could not attach this credit');
  return data.credit;
}

export async function updateEventCredit(
  fetcher: Fetcher,
  eventId: string,
  creditId: string,
  payload: Partial<{ roleLabel: PartnerType; isPrimary: boolean }>
): Promise<EventCreditRecord> {
  const res = await fetcher(`/api/events/${eventId}/credits/${creditId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  const data = await parseJsonResponse<{ credit: EventCreditRecord }>(res, 'Could not update this credit');
  return data.credit;
}

export async function deleteEventCredit(fetcher: Fetcher, eventId: string, creditId: string): Promise<void> {
  const res = await fetcher(`/api/events/${eventId}/credits/${creditId}`, { method: 'DELETE' });
  await parseJsonResponse(res, 'Could not remove this credit');
}

export interface AttachQueuedCreditsResult {
  attached: Array<{ credit: EventCreditRecord; queued: QueuedCredit }>;
  failures: Array<{ credit: QueuedCredit; error: string }>;
}

/**
 * Attaches a batch of queued (pre-Draft) credits to a just-created Event, one
 * at a time, via the existing attach API. There is no transaction spanning
 * Draft creation and credit attachment — each attach is independent, and a
 * failure on one credit does not stop the remaining ones from being tried.
 * The primary credit (if any) is attempted first so the "obvious primary"
 * intent is honored even if a later attach fails.
 */
export async function attachQueuedCreditsSequentially(
  fetcher: Fetcher,
  eventId: string,
  queued: QueuedCredit[]
): Promise<AttachQueuedCreditsResult> {
  const ordered = [...queued].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  const attached: Array<{ credit: EventCreditRecord; queued: QueuedCredit }> = [];
  const failures: Array<{ credit: QueuedCredit; error: string }> = [];

  for (const credit of ordered) {
    try {
      const created = await attachEventCredit(fetcher, eventId, {
        partnerId: credit.partnerId,
        roleLabel: credit.roleLabel,
        isPrimary: credit.isPrimary,
      });
      attached.push({ credit: created, queued: credit });
    } catch (err) {
      failures.push({ credit, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { attached, failures };
}
