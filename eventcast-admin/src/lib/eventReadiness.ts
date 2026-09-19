/**
 * Event Workspace readiness projection (Provider Event Workspace Premium
 * Redesign package). Pure derivation only — every input here is data the
 * Overview tab already loads from already-completed routes (the shared
 * Draft/event row, `GET /api/events/[eventId]/media`,
 * `GET /api/events/[eventId]/credits`, `GET /api/events/[eventId]/livestream/status`).
 * Nothing here talks to the network, fabricates a value, or invents a
 * capability the backend doesn't already have.
 *
 * Baseline V2.1 §5 names Invitation Video, Photo Slideshow, Wishes, Guest
 * Memories, Maps, Private Livestream, and YouTube as "explicit optional
 * modules" whose absence "must not block a Draft" — those items are
 * deliberately never shown with an "attention" state here, only
 * complete/not_set, so the checklist can never read as a blocker for them.
 * Publishing the page is the one `required` item (V2.1 §8: a Draft page is
 * simply not reachable yet). SEO thumbnail and Partner Credits are
 * `recommended` — PART-008 describes at least one public Event Credit as
 * something that "should normally" be selected before publishing, i.e.
 * advisory, not a hard gate (the Publish route itself does not require one).
 */

export type ReadinessTier = 'required' | 'recommended' | 'optional';
export type ReadinessState = 'complete' | 'attention' | 'not_set';

export interface ReadinessItem {
  id: string;
  tier: ReadinessTier;
  label: string;
  state: ReadinessState;
  detail: string;
  /** Workspace tab segment (e.g. "event-page") this item's action links to. */
  actionTab: string;
  actionLabel: string;
}

export interface EventReadinessInput {
  pageState: string | null;
  thumbnailUrl: string | null;
  venueMapLink: string | null;
  hasInvitationVideo: boolean;
  slideshowImageCount: number;
  creditCount: number;
  hasPrimaryCredit: boolean;
  livestreamEnabled: boolean;
  youtubeWatchUrl: string | null;
}

export function deriveEventReadiness(input: EventReadinessInput): ReadinessItem[] {
  const isPublished = input.pageState === 'published';

  const items: ReadinessItem[] = [
    {
      id: 'publish',
      tier: 'required',
      label: 'Publish your page',
      state: isPublished ? 'complete' : 'attention',
      detail: isPublished
        ? 'Live and reachable at your event link.'
        : "Still a Draft — guests can't see this page yet.",
      actionTab: 'event-page',
      actionLabel: isPublished ? 'View page settings' : 'Review & Publish',
    },
    {
      id: 'seo-thumbnail',
      tier: 'recommended',
      label: 'SEO / social thumbnail',
      state: input.thumbnailUrl ? 'complete' : 'attention',
      detail: input.thumbnailUrl
        ? 'Set — used as the share preview image.'
        : 'Add one so shared links show a real preview image.',
      actionTab: 'event-page',
      actionLabel: input.thumbnailUrl ? 'Replace thumbnail' : 'Add thumbnail',
    },
    {
      id: 'partner-credits',
      tier: 'recommended',
      label: 'Partner credits',
      state: input.creditCount > 0 ? 'complete' : 'attention',
      detail:
        input.creditCount > 0
          ? `${input.creditCount} credit${input.creditCount === 1 ? '' : 's'}${input.hasPrimaryCredit ? ' (primary set)' : ''}.`
          : 'No one is credited on this event yet.',
      actionTab: 'event-page',
      actionLabel: input.creditCount > 0 ? 'Manage credits' : 'Add a credit',
    },
    {
      id: 'invitation-video',
      tier: 'optional',
      label: 'Invitation video',
      state: input.hasInvitationVideo ? 'complete' : 'not_set',
      detail: input.hasInvitationVideo ? 'Added.' : 'Optional — not added.',
      actionTab: 'media',
      actionLabel: input.hasInvitationVideo ? 'Manage video' : 'Add video',
    },
    {
      id: 'photo-slideshow',
      tier: 'optional',
      label: 'Photo slideshow',
      state: input.slideshowImageCount > 0 ? 'complete' : 'not_set',
      detail: input.slideshowImageCount > 0 ? `${input.slideshowImageCount} photo(s) added.` : 'Optional — not added.',
      actionTab: 'media',
      actionLabel: input.slideshowImageCount > 0 ? 'Manage photos' : 'Add photos',
    },
    {
      id: 'venue-map',
      tier: 'optional',
      label: 'Venue map link',
      state: input.venueMapLink ? 'complete' : 'not_set',
      detail: input.venueMapLink ? 'Added.' : 'Optional — not set.',
      actionTab: 'event-page',
      actionLabel: input.venueMapLink ? 'Edit' : 'Add map link',
    },
    {
      id: 'livestream',
      tier: 'optional',
      label: 'Private livestream',
      state: input.livestreamEnabled ? 'complete' : 'not_set',
      detail: input.livestreamEnabled ? 'Enabled.' : 'Optional — not set up yet.',
      actionTab: 'live',
      actionLabel: input.livestreamEnabled ? 'Open Live Control Room' : 'Set up livestream',
    },
    {
      id: 'youtube',
      tier: 'optional',
      label: 'YouTube watch link',
      state: input.youtubeWatchUrl ? 'complete' : 'not_set',
      detail: input.youtubeWatchUrl ? 'Added.' : 'Optional — not set.',
      actionTab: 'live',
      actionLabel: input.youtubeWatchUrl ? 'Edit link' : 'Add link',
    },
  ];

  return items;
}

export const READINESS_TIER_LABELS: Record<ReadinessTier, string> = {
  required: 'Required',
  recommended: 'Recommended',
  optional: 'Optional',
};

/** Count of `required` + `recommended` items still needing attention — used for a compact summary count, never to gate anything. */
export function countItemsNeedingAttention(items: ReadinessItem[]): number {
  return items.filter((item) => item.tier !== 'optional' && item.state === 'attention').length;
}

export type NextActionTone = 'primary' | 'secondary';

export interface NextAction {
  label: string;
  description: string;
  actionTab: string;
  tone: NextActionTone;
}

export interface NextActionInput {
  lifecycle: 'draft' | 'upcoming' | 'published' | 'archived';
  /** null while the Live status fetch hasn't resolved yet — a loading state, not "disabled". */
  livestreamEnabled: boolean | null;
}

/**
 * The single most useful next click for this event, derived only from
 * already-known lifecycle + livestream-enabled state — never from date math
 * alone (EVT-003) and never a one-click Publish action (Publish always
 * requires an explicit Public/Unlisted choice on the Event Page tab).
 */
export function deriveNextAction(input: NextActionInput): NextAction | null {
  if (input.lifecycle === 'archived') {
    return {
      label: 'Restore this event',
      description: 'This event is archived and hidden from your Events list.',
      actionTab: 'settings',
      tone: 'secondary',
    };
  }

  if (input.lifecycle === 'draft') {
    return {
      label: 'Review & Publish',
      description: 'Your page is ready to review. Publishing lets you choose Public or Unlisted visibility.',
      actionTab: 'event-page',
      tone: 'primary',
    };
  }

  // Published or Upcoming — the page is live either way (EVT-003: date math
  // alone never claims "Live").
  if (input.livestreamEnabled === null) {
    return null; // still loading; Overview shows nothing rather than a guess
  }

  if (input.livestreamEnabled) {
    return {
      label: 'Open Live Control Room',
      description: 'Your private livestream is enabled.',
      actionTab: 'live',
      tone: 'primary',
    };
  }

  return {
    label: 'Set up your livestream (optional)',
    description: 'Your page is published. Livestream setup is optional and can be done any time.',
    actionTab: 'live',
    tone: 'secondary',
  };
}
