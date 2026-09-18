import { CANONICAL_TEMPLATES } from './eventContract';

/**
 * Minimal template-aware capability map for the Create Event form (V2.1
 * Create Event redesign). Declares which optional sections/fields a given
 * `template_id` actually supports, so the form can show/hide sections per
 * template instead of hardcoding wedding-template-01 forever. Deliberately a
 * flat capability flag map, not a schema/form-builder framework — adding a
 * future template means adding one entry here plus registering it in
 * `CANONICAL_TEMPLATES` (`eventContract.ts`), nothing else.
 */
export interface TemplateFieldSupport {
  /** Venue map link (drives the Map section iframe + "Open in Maps" link). */
  venueMap: boolean;
  /** Custom headline overriding the auto "Welcome to the Wedding of…" intro line. */
  customTopTitle: boolean;
  /** Invitation video + photo gallery/slideshow. */
  media: boolean;
  /** SEO/social share thumbnail (og:image / twitter:image). */
  seoThumbnail: boolean;
  /** Manual YouTube watch-link destination (data only — no ingest/activation). */
  livestreamYoutubeLink: boolean;
  /** Guest Photo Wall toggle + Manual Approval moderation setting. */
  guestEngagement: boolean;
  /** Partner/Event Credit attribution. */
  partnerCredits: boolean;
}

export const TEMPLATE_FIELD_SUPPORT: Record<string, TemplateFieldSupport> = {
  'wedding-template-01': {
    venueMap: true,
    customTopTitle: true,
    media: true,
    seoThumbnail: true,
    livestreamYoutubeLink: true,
    guestEngagement: true,
    partnerCredits: true,
  },
};

/**
 * Templates a provider may actually pick when creating a new event. Distinct
 * from `CANONICAL_TEMPLATES` (which also registers templates still in
 * asset-generation/prototype phase, e.g. `wedding-floral-pastel-01`) — this
 * list is intentionally narrower so Create Event never offers an incomplete
 * template. Grow this list (and `TEMPLATE_FIELD_SUPPORT`) once a template is
 * actually ready for real event creation.
 */
export const CREATABLE_TEMPLATE_IDS: readonly string[] = ['wedding-template-01'];

export function getTemplateFieldSupport(templateId: string): TemplateFieldSupport {
  return (
    TEMPLATE_FIELD_SUPPORT[templateId] || {
      venueMap: false,
      customTopTitle: false,
      media: false,
      seoThumbnail: false,
      livestreamYoutubeLink: false,
      guestEngagement: false,
      partnerCredits: false,
    }
  );
}

/** Creatable templates, resolved against the canonical registry, for a template selector. */
export function listCreatableTemplates() {
  return CREATABLE_TEMPLATE_IDS.map((id) => CANONICAL_TEMPLATES[id]).filter(Boolean);
}
