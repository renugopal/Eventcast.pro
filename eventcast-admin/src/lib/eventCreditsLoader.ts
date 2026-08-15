import type { EventCreditRoleLabel, EventCreditWithPartner } from './eventContract';

/**
 * Shared by the Draft Preview route and the Publish-time credit snapshot
 * freeze helper — both need the same already-owned Event's current Event
 * Credits joined with their Partner's public-safe fields, primary first
 * then by creation time.
 */
export const EVENT_CREDIT_COLUMNS =
  'role_label, is_primary, partners(business_name, logo_url, website_url, instagram_url, facebook_url, youtube_url)';

interface EventCreditPartnerJoinRow {
  business_name: string;
  logo_url: string | null;
  website_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  youtube_url: string | null;
}

interface EventCreditJoinRow {
  role_label: string;
  is_primary: boolean | null;
  // PostgREST returns either a single embedded object or a one-element array
  // for a to-one FK join, depending on relationship inference — same
  // defensive handling the render Worker already uses for `photographers`.
  partners: EventCreditPartnerJoinRow | EventCreditPartnerJoinRow[] | null;
}

interface EventCreditsQueryResult {
  data: EventCreditJoinRow[] | null;
  error: { message: string } | null;
}

interface EventCreditsOrderStage2 {
  order: (column: string, opts?: { ascending: boolean }) => PromiseLike<EventCreditsQueryResult>;
}

interface EventCreditsOrderStage1 {
  order: (column: string, opts?: { ascending: boolean }) => EventCreditsOrderStage2;
}

interface EventCreditsFilterBuilder {
  eq: (column: string, value: unknown) => EventCreditsOrderStage1;
}

interface EventCreditsQueryBuilder {
  select: (columns: string) => EventCreditsFilterBuilder;
}

interface EventCreditsQueryableDb {
  from: (table: string) => EventCreditsQueryBuilder;
}

/**
 * Loads an already-owned Event's current editable Event Credits joined with
 * their referenced Partner's public-safe fields. Internal-only Partner
 * fields (`contact_person`, `phone`, `whatsapp`, `city`, `internal_notes`)
 * are never selected. Returns `null` on any query failure so callers fail
 * closed instead of rendering or freezing an incomplete credit list.
 */
export async function loadOwnedEventCreditsWithPartners(
  db: unknown,
  eventId: string
): Promise<EventCreditWithPartner[] | null> {
  const queryableDb = db as EventCreditsQueryableDb;

  const { data, error } = await queryableDb
    .from('event_credits')
    .select(EVENT_CREDIT_COLUMNS)
    .eq('event_id', eventId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) return null;

  return (data ?? [])
    .map((row): EventCreditWithPartner | null => {
      const partner = Array.isArray(row.partners) ? row.partners[0] : row.partners;
      if (!partner) return null;
      return {
        roleLabel: row.role_label as EventCreditRoleLabel,
        isPrimary: row.is_primary === true,
        partner: {
          businessName: partner.business_name,
          logoUrl: partner.logo_url,
          websiteUrl: partner.website_url,
          instagramUrl: partner.instagram_url,
          facebookUrl: partner.facebook_url,
          youtubeUrl: partner.youtube_url,
        },
      };
    })
    .filter((c): c is EventCreditWithPartner => c !== null);
}
