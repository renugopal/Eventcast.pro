/**
 * The one canonical event-template renderer (baseline TPL-002/TPL-003: one
 * canonical template source, one shared renderer for Admin preview and
 * public production). Deliberately environment-agnostic — no Next.js,
 * Supabase, Cloudflare, filesystem, or network I/O — so it can be imported
 * directly by both the Admin Draft preview route (`@/lib/weddingTemplateRenderer`,
 * a normal local import) and the public Cloudflare Worker
 * (`workers/render-event-page/src/index.ts`, which imports this exact file
 * by relative path).
 *
 * This module physically lives inside the `eventcast-admin` project tree
 * rather than the Worker's, specifically so Turbopack (the Next.js 16
 * dev/build bundler here) can resolve it as a normal local import. Two
 * narrower fixes were tried and rejected first: widening `turbopack.root`
 * broke Tailwind/PostCSS resolution app-wide, and a `turbopack.resolveAlias`
 * pointed at the Worker's copy of this file still failed — Turbopack applied
 * the alias but then refused to read the resolved path because it was
 * physically outside the detected project root. Moving the implementation
 * itself (rather than aliasing across the boundary) is what actually works.
 * The Worker's esbuild/Wrangler bundler has no equivalent project-root
 * restriction, so it resolves the reverse (`eventcast-admin` -> `workers`)
 * relative import without any special configuration.
 */

// ---------------------------------------------------------------------------
// Types (minimal shape — extend as the schema evolves)
// ---------------------------------------------------------------------------
export interface EventRow {
  id: string;
  slug: string;
  studio_id: string;
  template_id?: string | null;
  event_type?: string | null;
  groom_name?: string | null;
  bride_name?: string | null;
  celebrant_name?: string | null;
  custom_top_title?: string | null;
  event_date?: string | null;
  event_time?: string | null;
  timer_target_time?: string | null;
  show_timer?: boolean | null;
  venue_name?: string | null;
  venue_map_link?: string | null;
  thumbnail_url?: string | null;
  gallery_urls?: string[] | null;
  invitation_video_url?: string | null;
  vod_link?: string | null;
  youtube_broadcast_id?: string | null;
  privacy_status?: string | null;
  custom_initials?: string | null;
  hide_loader_photo?: boolean | null;
  loader_photo_url?: string | null;
  restreamer_ingest_url?: string | null;
  restreamer_hls_url?: string | null;
  restreamer_player_url?: string | null;
  youtube_url?: string | null;
  photographer_id?: string | null;
  photographers?: PhotographerRow | PhotographerRow[] | null;
  guest_photo_limit?: number | null;
  guest_photo_wall_enabled?: boolean | null;
  deployed_at?: string | null;
  created_at?: string | null;
  notes?: string | null;
  /** Ordered public-safe Event Credits, primary first (Baseline V2.1 PART-005). */
  event_credits?: EventCreditConfig[] | null;
}

export interface PhotographerRow {
  id: string;
  name?: string | null;
  instagram?: string | null;
  website?: string | null;
  logo_url?: string | null;
  [key: string]: unknown;
}

/**
 * The public-safe Event Credit shape threaded through into
 * `window.WEDDING_CONFIG.eventCredits` (Baseline V2.1 PART-005/PART-006).
 * Structurally the same public-safe fields as `PublicEventCredit`
 * (`@/lib/eventContract`) — redefined locally rather than imported so this
 * module stays a plain, dependency-free renderer (see the module docstring).
 * `renderEvent` itself only threads this list through; it does not decide
 * how it is redacted — callers must only ever pass an already-redacted list.
 */
export interface EventCreditConfig {
  businessName: string;
  roleLabel: string;
  isPrimary: boolean;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  youtubeUrl?: string | null;
}

/**
 * The minimal env shape `renderEvent` needs — just enough to fill
 * `window.WEDDING_CONFIG.supabaseUrl`/`supabaseKey` for the template's own
 * client-side Supabase calls (Wishes, Guest Memories, etc). Deliberately
 * narrower than the Worker's own `Env` (which additionally carries the
 * service-role key and the R2 binding, neither of which this pure renderer
 * ever touches) so a caller outside the Worker runtime — e.g. the Admin
 * Draft preview route — can satisfy it without any Cloudflare-specific type.
 */
export interface RenderEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

// ---------------------------------------------------------------------------
// SEO title/description — formerly the Worker's standalone wedding-web-seo.ts;
// folded in here since renderEvent is its only caller (avoids reintroducing a
// second cross-package import once the renderer itself moved).
// ---------------------------------------------------------------------------
function formatShortEventDate(rawDate: string): string {
  if (!rawDate) return '';
  const [y, m, d] = rawDate.split('-').map(Number);
  if (!y || !m || !d) return '';
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  const day = dateObj.getUTCDate();
  const suffix =
    day % 10 === 1 && day !== 11 ? 'st' :
    day % 10 === 2 && day !== 12 ? 'nd' :
    day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  const month = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(dateObj);
  return `${day}${suffix} ${month}`;
}

function generateWeddingWebSEO({
  groom,
  bride,
  eventType,
  eventDate,
}: {
  groom: string;
  bride?: string;
  eventType?: string;
  eventDate?: string;
}): { title: string; description: string } {
  const type = (eventType || 'Wedding').trim();
  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
  const typeLower = typeLabel.toLowerCase();
  const shortDate = formatShortEventDate(eventDate ?? '');
  const dateSuffix = shortDate ? ` | ${shortDate}` : '';
  const isSinglePerson = !bride || bride.toLowerCase() === 'family';
  const separator = typeLower.includes('wedding') ? '❤️' : '✨';

  const title = isSinglePerson
    ? `${groom} ${separator} ${typeLabel} Live${dateSuffix}`
    : `${groom} ${separator} ${bride} ${typeLabel} Live${dateSuffix}`;

  const description =
    `Join us live and be part of this beautiful ${typeLower} celebration filled with love, joy, and cherished memories.`;

  return { title, description };
}

// ---------------------------------------------------------------------------
// Date / time helpers — identical logic to the original route.ts
// ---------------------------------------------------------------------------
function formatDate(rawDate: string): string {
  if (!rawDate) return '';
  const [y, m, d] = rawDate.split('-').map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  let formatted = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(dateObj);
  const day = dateObj.getUTCDate();
  const suffix =
    day % 10 === 1 && day !== 11 ? 'st' :
    day % 10 === 2 && day !== 12 ? 'nd' :
    day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  return formatted.replace(String(day), `${day}${suffix}`);
}

function formatTime(rawTime: string): string {
  if (!rawTime) return '';
  const [hours, minutes] = rawTime.split(':');
  const h = parseInt(hours, 10);
  return `${h % 12 || 12}:${minutes} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** Build a browser-safe ISO timer target, e.g. 2026-07-11T09:00:00 */
function normalizeTimerIso(eventDate: string, rawTime: string): string {
  const [hPart = '9', mPart = '0'] = (rawTime || '09:00').split(':');
  const hours = String(parseInt(hPart, 10) || 0).padStart(2, '0');
  const minutes = String(parseInt(mPart, 10) || 0).padStart(2, '0');
  return `${eventDate}T${hours}:${minutes}:00`;
}

/** True only for actual stream/archive URLs — never YouTube links. */
function isNativePlaybackUrl(url: string): boolean {
  if (!url) return false;
  if (/youtube\.com|youtu\.be/i.test(url)) return false;
  return /\.m3u8(\?|$)/i.test(url) || /\/hls\//i.test(url) || /\.mp4(\?|$)/i.test(url);
}

// ---------------------------------------------------------------------------
// Venue / map URL helpers
// ---------------------------------------------------------------------------
function parseVenueMapLinks(vMap: string | null | undefined): { navigate: string; embed: string } {
  if (!vMap) return { navigate: '', embed: '' };
  const lines = vMap.split('\n').map((s) => s.trim()).filter(Boolean);
  const embed = lines.find((l) => /google\.com\/maps\/embed/i.test(l)) ?? '';
  const navigate = lines.find((l) => !/google\.com\/maps\/embed/i.test(l)) ?? lines[0] ?? '';
  return { navigate, embed };
}

function buildEmbedUrl(vMap: string | null | undefined, vName: string | null | undefined): string {
  const { embed, navigate } = parseVenueMapLinks(vMap);
  if (embed) return embed;

  const name = vName ?? '';
  if (!navigate && !name) return '';
  if (navigate && navigate.includes('<iframe')) {
    const m = navigate.match(/src="([^"]+)"/);
    return m ? m[1] : '';
  }
  let q = name;
  const mapLine = navigate || vMap || '';
  if (mapLine) {
    try {
      const urlStr = mapLine.startsWith('http') ? mapLine : `https://${mapLine}`;
      const parsed = new URL(urlStr);
      const coords = parsed.pathname.match(/\/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (coords) {
        q = `${coords[1]},${coords[2]}`;
      } else if (parsed.pathname.includes('/place/')) {
        q = decodeURIComponent(parsed.pathname.split('/place/')[1].split('/')[0]);
      } else if (parsed.searchParams.has('q')) {
        q = parsed.searchParams.get('q') ?? name;
      } else if (parsed.pathname.includes('/search/')) {
        q = decodeURIComponent(parsed.pathname.split('/search/')[1].split('/')[0]);
      }
    } catch (_) { /* malformed URL — fall back to name */ }
  }
  return `https://maps.google.com/maps?q=${encodeURIComponent(q || name)}&t=&z=15&ie=UTF8&iwloc=&output=embed`;
}

function buildNavigateUrl(vMap: string | null | undefined, vName: string | null | undefined): string {
  const { navigate } = parseVenueMapLinks(vMap);
  if (navigate && !navigate.includes('<iframe') && !/google\.com\/maps\/embed/i.test(navigate)) return navigate;
  if (vName) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(vName)}`;
  return '';
}

function splitVenue(venueName: string): { main: string; subtext: string } {
  const parts = venueName.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { main: parts[0], subtext: parts.slice(1).join(', ') };
  }
  return { main: venueName, subtext: '' };
}

/** Append cache-bust param for WhatsApp/Facebook OG crawlers (they cache og:image aggressively). */
function buildOgImageUrl(thumbnailUrl: string, cacheVersion?: string | null): string {
  if (!thumbnailUrl) return '';
  const base = thumbnailUrl.split('?')[0];
  const version = cacheVersion
    ? String(new Date(cacheVersion).getTime() || cacheVersion).replace(/\D/g, '').slice(0, 14)
    : Date.now().toString();
  return `${base}?v=${version}`;
}

function getHeroTimeLabel(eventType: string, notes?: string | null): string {
  const fromNotes = notes?.match(/(?:^|\n)\s*time_label\s*[:=]\s*(.+?)\s*(?:\n|$)/i)?.[1]?.trim();
  if (fromNotes) return fromNotes;
  const t = (eventType || '').toLowerCase();
  if (t.includes('wedding') || t.includes('engagement')) return 'Sumuhurtham';
  if (!eventType) return 'Event';
  return eventType.charAt(0).toUpperCase() + eventType.slice(1);
}

function getHeroTimeSubtext(notes?: string | null): string {
  return notes?.match(/(?:^|\n)\s*time_subtext\s*[:=]\s*(.+?)\s*(?:\n|$)/i)?.[1]?.trim() ?? '';
}

// ---------------------------------------------------------------------------
// Core renderer — mirrors every HTML mutation that used to happen in route.ts
// ---------------------------------------------------------------------------
const DEFAULT_TEMPLATE_ID = 'wedding-template-01';

export function renderEvent(
  templateHtml: string,
  event: EventRow,
  photographer: PhotographerRow | null,
  slug: string,
  env: RenderEnv,
  countryCode: string = 'Unknown',
  hostname: string = 'eventcast.pro',
  hasLivePlayback: boolean = false,
  /**
   * True only when this event's B2-authoritative recording is fully
   * evidenced (`recording_state = 'b2_finalized'`, integrity verified,
   * retention not yet expired) AND a real B2 read path is actually
   * configured — never inferred, always resolved server-side by the caller
   * (see `resolveB2ReplayEligibility` in the Worker's `index.ts`), since
   * this module has no I/O of its own.
   */
  hasB2Replay: boolean = false,
  /**
   * A manually-linked YouTube fallback URL, but ONLY ever passed here once
   * `event_recordings.youtube_fallback_verified` is true (STO-005). No
   * verification pipeline exists yet in this repository, so
   * `youtube_fallback_verified` stays `false` for every event today and this
   * parameter is therefore never populated in practice — the wiring exists
   * so a future verification mechanism has nothing left to build here.
   */
  verifiedYoutubeFallbackUrl: string | null = null,
): string {
  const groom      = event.groom_name ?? event.celebrant_name ?? 'Event';
  const bride      = event.bride_name ?? 'Family';
  const type       = event.event_type ?? 'wedding';
  const thumbnailUrl = event.thumbnail_url ?? '';
  const ogImageUrl = buildOgImageUrl(thumbnailUrl, event.deployed_at ?? event.created_at);
  const vName      = event.venue_name ?? '';
  const vMap       = event.venue_map_link ?? '';
  const { main: venueMain, subtext: venueSubtext } = splitVenue(vName);

  const formattedDate = formatDate(event.event_date ?? '');
  const formattedTime = formatTime(event.event_time ?? '');
  const heroTimeLabel = getHeroTimeLabel(type, event.notes);
  const heroTimeSubtext = getHeroTimeSubtext(event.notes);

  const isSinglePerson = !bride || bride.toLowerCase() === 'family';
  const mainName   = isSinglePerson ? groom : `${groom} & ${bride}`;
  const typeLabel  = type.charAt(0).toUpperCase() + type.slice(1);
  const templateId = event.template_id ?? DEFAULT_TEMPLATE_ID;
  const isWeddingTemplate = templateId === 'wedding-template-01';
  const weddingSeo = isWeddingTemplate
    ? generateWeddingWebSEO({
        groom,
        bride: isSinglePerson ? undefined : bride,
        eventType: type,
        eventDate: event.event_date ?? '',
      })
    : null;
  const displayTitle = weddingSeo?.title ?? `${mainName} ${typeLabel} Live | `;
  const displayDesc  = weddingSeo?.description
    ?? `Join us live and be part of this beautiful ${typeLabel.toLowerCase()} celebration filled with love and joy.`;
  const introLine = (() => {
    const custom = event.custom_top_title?.trim();
    if (custom) return custom;
    const t = (type || '').toLowerCase();
    if (t.includes('engagement')) return 'Welcome to the Engagement of';
    if (t.includes('wedding')) return 'Welcome to the Wedding of';
    return `Welcome to the ${typeLabel} of`;
  })();

  // Gallery
  const galleryArray: string[] = (() => {
    const raw = event.gallery_urls;
    if (Array.isArray(raw)) return raw.filter(Boolean);
    return [];
  })();

  // Invitation videos
  const invitationVideos: string[] = (() => {
    const raw = event.invitation_video_url ?? '';
    if (Array.isArray(raw)) return (raw as string[]).filter(Boolean);
    if (typeof raw === 'string') return raw.split('\n').map(u => u.trim()).filter(Boolean);
    return [];
  })();

  // Initials
  const customInitials = event.custom_initials ?? '';
  const groomInitial = (event.groom_name ?? event.celebrant_name ?? groom).charAt(0).toUpperCase();
  const brideRaw    = event.bride_name ?? bride;
  const brideIsGeneric = brideRaw.toLowerCase() === 'family' || brideRaw.toLowerCase() === 'event';
  const brideInitial = brideIsGeneric ? '' : brideRaw.charAt(0).toUpperCase();
  const autoInitials = groomInitial && brideInitial
    ? `${groomInitial} & ${brideInitial}`
    : groomInitial || brideInitial || 'E';
  const finalInitials = customInitials || autoInitials;

  // Loader photo
  const hideLoaderPhoto = event.hide_loader_photo ?? false;
  const loaderPhotoUrl  = event.loader_photo_url ?? '';
  const loaderSrc       = loaderPhotoUrl || thumbnailUrl || (galleryArray[0] ?? '');
  const optimizedLoader = loaderSrc.includes('/upload/')
    ? loaderSrc.replace('/upload/', '/upload/f_auto,q_auto/')
    : loaderSrc;

  // Timer
  const timerTime = (event.timer_target_time ?? event.event_time ?? '09:00').slice(0, 5);
  const timerTarget = normalizeTimerIso(event.event_date ?? '', timerTime);

  // YouTube — the verified B2-replay-expiry fallback (STO-005) only ever
  // displaces youtubeId when there is no live/B2 playback to show; the
  // legacy vod_link/youtube_url chain is otherwise unchanged.
  const youtubeId = event.youtube_broadcast_id
    || ((event.vod_link ?? '').split('/').pop() ?? '')
    || ((event.youtube_url ?? '').split('/').pop() ?? '')
    || ((!hasLivePlayback && !hasB2Replay && verifiedYoutubeFallbackUrl)
          ? (verifiedYoutubeFallbackUrl.split('/').pop() ?? '')
          : '');

  // VOD / HLS playback URLs — YouTube links stay on youtubeId only, never HLS player
  const vodArchiveUrl = event.vod_link ?? '';
  // Live playback now comes from the private R2 bucket via this Worker's own
  // route; the legacy Restreamer/memfs URL shape is gone. VOD selection is
  // unchanged: it still follows vod_link exactly as before.
  const liveHlsUrl = hasLivePlayback
    ? `https://${hostname}/events/${encodeURIComponent(slug)}/hls/live/index.m3u8`
    : '';
  // B2-authoritative replay (Milestone N, B2 playback delivery): only
  // offered once the Worker has independently confirmed full evidence
  // (b2_finalized + integrity verified + retention not expired) AND a real
  // B2 read path is configured. Never live — always the finalized archive.
  const b2ReplayUrl = hasB2Replay
    ? `https://${hostname}/events/${encodeURIComponent(slug)}/vod/b2/index.m3u8`
    : '';
  const archivePlaybackUrl = isNativePlaybackUrl(vodArchiveUrl) ? vodArchiveUrl : '';
  // Priority: Live > B2-authoritative replay > legacy manual VOD archive.
  // The verified-YouTube fallback is not an HLS URL — it only ever affects
  // youtubeId above, never this HLS player source.
  const primaryHlsUrl = liveHlsUrl || b2ReplayUrl || archivePlaybackUrl;

  // Map URLs
  const embedUrl    = buildEmbedUrl(vMap, venueMain || vName);
  const navigateUrl = buildNavigateUrl(vMap, venueMain || vName);

  // Config object strings — escape for safe JS string literal embedding
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

  const configScript = `<script>
window.WEDDING_CONFIG = {
  groom: "${esc(event.groom_name ?? event.celebrant_name ?? '')}",
  bride: "${esc(event.bride_name ?? 'Family')}",
  date: "${esc(formattedDate)}",
  time: "${esc(formattedTime)}",
  timeLabel: "${esc(heroTimeLabel)}",
  timeSubtext: "${esc(heroTimeSubtext)}",
  timerTarget: "${esc(timerTarget)}",
  venue: "${esc(venueMain)}",
  venueSubtext: "${esc(venueSubtext)}",
  venueUrl: ${embedUrl ? JSON.stringify(embedUrl) : 'null'},
  venueNavigateUrl: ${navigateUrl ? JSON.stringify(navigateUrl) : 'null'},
  youtubeId: "${esc(youtubeId)}",
  vodArchiveUrl: "${esc(vodArchiveUrl)}",
  restreamerUrl: "${esc(primaryHlsUrl)}",
  restreamerPlayer: "${esc(primaryHlsUrl)}",
  invitationVideo: "${esc(invitationVideos[0] ?? '')}",
  invitationVideos: ${JSON.stringify(invitationVideos)},
  thumbnail: "${esc(thumbnailUrl)}",
  gallery: ${JSON.stringify(galleryArray)},
  supabaseUrl: "${esc(env.SUPABASE_URL)}",
  supabaseKey: "${esc(env.SUPABASE_ANON_KEY)}",
  eventId: "${esc(event.id)}",
  studioId: "${esc(event.studio_id ?? '')}",
  eventDate: "${esc(event.event_date ?? '')}",
  eventType: "${esc(type)}",
  introText: "${esc(event.custom_top_title ?? '')}",
  photographer: ${JSON.stringify(photographer)},
  eventCredits: ${JSON.stringify(event.event_credits ?? [])},
  customInitials: "${esc(customInitials)}",
  hideLoaderPhoto: ${hideLoaderPhoto ? 'true' : 'false'},
  loaderPhotoUrl: "${esc(loaderPhotoUrl)}",
  country: "${esc(countryCode)}",
  guestPhotoWallEnabled: ${event.guest_photo_wall_enabled !== false ? 'true' : 'false'},
  guestPhotoLimit: ${event.guest_photo_limit ?? 50}
};
</script>`;

  let html = templateHtml;

  // --- Inject base tag for relative assets ---
  html = html.replace(/<head>/i, `<head>\n    <base href="/events/${encodeURIComponent(slug)}/">`);

  // --- SEO meta tags ---
  html = html.replace(/<title>.*?<\/title>/gs,       `<title>${displayTitle}</title>`);
  html = html.replace(/<meta property="og:title" content=".*?">/g,       `<meta property="og:title" content="${displayTitle}">`);
  html = html.replace(/<meta name="description" content=".*?">/g,        `<meta name="description" content="${displayDesc}">`);
  html = html.replace(/<meta property="og:description" content=".*?">/g, `<meta property="og:description" content="${displayDesc}">`);
  html = html.replace(/<meta property="og:image" content=".*?">/g,       `<meta property="og:image" content="${ogImageUrl}">`);
  html = html.replace(/<meta property="og:url" content=".*?">/g,         `<meta property="og:url" content="https://eventcast.pro/events/${slug}">`);
  html = html.replace(/<meta name="twitter:image" content=".*?">/g,      `<meta name="twitter:image" content="${ogImageUrl}">`);

  // --- Inject config inline; remove external config.js script tag ---
  const antiTheftScript = `
<style>
  /* Sprint H: IP & Anti-Theft Protection Styles */
  body {
    -webkit-user-select: none !important;
    -moz-user-select: none !important;
    -ms-user-select: none !important;
    user-select: none !important;
  }
  input, textarea, select, [contenteditable="true"] {
    -webkit-user-select: text !important;
    -moz-user-select: text !important;
    -ms-user-select: text !important;
    user-select: text !important;
  }
  img {
    -webkit-user-drag: none !important;
    user-drag: none !important;
    -webkit-touch-callout: none !important;
  }
</style>
<script>
(function() {
  if (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.startsWith('192.168.')
  ) {
    return;
  }

  // 1. Disable context menu
  document.addEventListener('contextmenu', function(e) {
    e.preventDefault();
  }, false);

  // 2. Disable image dragging
  document.addEventListener('dragstart', function(e) {
    if (e.target.tagName === 'IMG') {
      e.preventDefault();
    }
  }, false);

  // 3. Disable DevTools & Inspect shortcuts
  document.addEventListener('keydown', function(e) {
    if (e.keyCode === 123 || e.key === 'F12') {
      e.preventDefault();
      return false;
    }
    if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.keyCode === 73)) {
      e.preventDefault();
      return false;
    }
    if (e.ctrlKey && e.shiftKey && (e.key === 'J' || e.key === 'j' || e.keyCode === 74)) {
      e.preventDefault();
      return false;
    }
    if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c' || e.keyCode === 67)) {
      e.preventDefault();
      return false;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'U' || e.key === 'u' || e.keyCode === 85)) {
      e.preventDefault();
      return false;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'S' || e.key === 's' || e.keyCode === 83)) {
      e.preventDefault();
      return false;
    }
  }, false);

  // 4. Active Anti-Debugging Freeze Loop
  function checkDebugger() {
    var startTime = performance.now();
    debugger;
    var endTime = performance.now();
    if (endTime - startTime > 100) {
      document.body.innerHTML = '<div style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;background:#0d0d12;color:#ff4444;font-family:sans-serif;text-align:center;padding:20px;">' +
        '<h1 style="font-size:2rem;margin-bottom:10px;font-weight:600;letter-spacing:-0.025em;">Unauthorized Access Detected</h1>' +
        '<p style="color:rgba(255,255,255,0.6);font-size:1rem;max-width:400px;line-height:1.5;">To protect photographer intellectual property, developer tools are disabled on this live broadcast page.</p>' +
        '</div>';
    }
  }
  setInterval(checkDebugger, 1000);
})();
</script>`;

  html = html.replace('</head>', `${configScript}\n${antiTheftScript}\n</head>`);
  html = html.replace(/<script\s+src=["']config\.js["'][^>]*><\/script>/g, '');

  // --- Logo / initials ---
  html = html.replace(/<h1 class="logo-text">.*?<\/h1>/gs,   `<h1 class="logo-text">${finalInitials}</h1>`);
  html = html.replace(/<div class="initials">.*?<\/div>/gs,  `<div class="initials">${finalInitials}</div>`);

  // --- Hero names + date/time/venue (SSR fallback before script.js runs) ---
  html = html.replace(/<span class="first-name">[^<]*<\/span>/, `<span class="first-name">${groom}</span>`);
  html = html.replace(/<span class="second-name">[^<]*<\/span>/, `<span class="second-name">${bride}</span>`);
  html = html.replace(
    /<p class="invite-header intro-text">[\s\S]*?<\/p>/,
    `<p class="invite-header intro-text">${introLine}</p>`,
  );
  // Hero info labels: Date / Time|Sumuhurtham / Venue — second label is ceremony time
  {
    let labelIndex = 0;
    const heroLabels = ['Date', heroTimeLabel, 'Venue'];
    html = html.replace(/<span class="info-label">[^<]*<\/span>/g, () => {
      const val = heroLabels[labelIndex++] ?? '';
      return `<span class="info-label">${val}</span>`;
    });
  }
  const heroInfoValues = [formattedDate, formattedTime, venueMain];
  let heroInfoIndex = 0;
  html = html.replace(/<span class="info-text">[^<]*<\/span>/g, () => {
    const val = heroInfoValues[heroInfoIndex++] ?? '';
    return `<span class="info-text">${val}</span>`;
  });
  const heroSubValues = [heroTimeSubtext, venueSubtext];
  let heroSubIndex = 0;
  html = html.replace(/<span class="info-subtext">[^<]*<\/span>/g, () => {
    const val = heroSubValues[heroSubIndex++] ?? '';
    return `<span class="info-subtext">${val}</span>`;
  });

  if (!galleryArray.length) {
    html = html.replace(
      /(<section id="photo-gallery"[^>]*)(>)/,
      '$1 style="display:none"$2',
    );
  }

  if (!invitationVideos.length) {
    html = html.replace(
      /(<section id="invitation-video"[^>]*)(>)/,
      '$1 style="display:none"$2',
    );
  }

  // --- Loader photo ---
  if (hideLoaderPhoto || !optimizedLoader) {
    html = html.replace(
      /<div class="loader-photo">[\s\S]*?<\/div>/g,
      '<div class="loader-photo" style="display:none;"></div>',
    );
  } else {
    html = html.replace(
      /<div class="loader-photo">\s*<img src="[^"]*"/g,
      `<div class="loader-photo">\n                <img src="${optimizedLoader}"`,
    );
  }

  // --- Venue / maps ---
  if (vName || vMap) {
    html = html.replace(/src="https:\/\/(www\.)?google\.com\/maps\/embed[^"]*"/g, `src="${embedUrl}"`);
    html = html.replace(/src="https:\/\/maps\.google\.com\/maps\?q=[^"]*"/g,      `src="${embedUrl}"`);
    html = html.replace(/id="venue-iframe" src=""/g,  `id="venue-iframe" src="${embedUrl}"`);
    html = html.replace(/id="venue-iframe" src=''/g,  `id="venue-iframe" src="${embedUrl}"`);
    html = html.replace(/class="subtitle config-venue-full">[^<]*/g, `class="subtitle config-venue-full">${vName}`);
    html = html.replace(/id="venue-nav-btn" href="#"/g, `id="venue-nav-btn" href="${navigateUrl}"`);
    html = html.replace(/href="https:\/\/(www\.)?google\.com\/maps[^"]*"/g, `href="${navigateUrl}"`);
    html = html.replace(/href="https:\/\/maps\.app\.goo\.gl[^"]*"/g,        `href="${navigateUrl}"`);
  }

  return html;
}
