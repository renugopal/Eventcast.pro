import weddingTemplate01 from '../templates/wedding-template-01/index.html';
import dhotiTemplate from '../templates/dhoti-ceremony-template-01/index.html';
import halfSareeTemplate from '../templates/half-saree-template-01/index.html';
import engagementTemplate from '../templates/harika-adithya-engagement/index.html';
import birthdayTemplate from '../templates/ishaan-birthday/index.html';

// ---------------------------------------------------------------------------
// Env bindings (declared in wrangler.toml / Cloudflare dashboard secrets)
// ---------------------------------------------------------------------------
export interface Env {
  SUPABASE_URL: string;
  /** Service-role key — server-side only, bypasses RLS for event reads */
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Anon key — injected into window.WEDDING_CONFIG for client-side Supabase calls */
  SUPABASE_ANON_KEY: string;
}

// Map template_id → bundled HTML string. Add new entries here as you add templates.
const TEMPLATES: Record<string, string> = {
  'wedding-template-01': weddingTemplate01,
  'dhoti-ceremony-template-01': dhotiTemplate,
  'half-saree-template-01': halfSareeTemplate,
  'engagement-template-01': engagementTemplate,
  'birthday-template-01': birthdayTemplate,
};
const DEFAULT_TEMPLATE_ID = 'wedding-template-01';

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Only handle GET /events/:slug — pass everything else through unchanged.
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 });
    }
    const eventMatch = url.pathname.match(/^\/events\/([^/]+)$/);
    const manifestMatch = url.pathname.match(/^\/events\/([^/]+)\/manifest\.json$/);
    const swMatch = url.pathname.match(/^\/events\/([^/]+)\/sw\.js$/);

    if (!eventMatch && !manifestMatch && !swMatch) {
      return new Response('Not Found', { status: 404 });
    }

    const slug = decodeURIComponent(eventMatch ? eventMatch[1] : (manifestMatch ? manifestMatch[1] : swMatch![1]));
    const hostname = url.hostname;

    // Handle sw.js immediately to save database queries
    if (swMatch) {
      const swCode = `const CACHE_NAME = 'eventcast-pwa-v1';
const ASSETS_TO_CACHE = [
  'https://cdn.plyr.io/3.7.8/plyr.css',
  'https://cdn.plyr.io/3.7.8/plyr.js',
  'https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js',
  'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // CRITICAL: NEVER cache live stream playlists (.m3u8) or segments (.ts)
  if (url.pathname.endsWith('.m3u8') || url.pathname.endsWith('.ts') || url.hostname.includes('restreamer')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});`;

      return new Response(swCode, {
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
        },
      });
    }

    try {
      const sbHeaders = {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      };

      // -----------------------------------------------------------------------
      // 1. Resolve studio — prefer custom_domain match, fall back to 'eventcast'
      // -----------------------------------------------------------------------
      let studioId: string | null = null;

      const domainRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/studios?select=id&custom_domain=eq.${encodeURIComponent(hostname)}&limit=1`,
        { headers: sbHeaders },
      );
      const domainRows: { id: string }[] = await domainRes.json();

      if (domainRows.length > 0) {
        studioId = domainRows[0].id;
      } else {
        const defaultRes = await fetch(
          `${env.SUPABASE_URL}/rest/v1/studios?select=id&slug=eq.eventcast&limit=1`,
          { headers: sbHeaders },
        );
        const defaultRows: { id: string }[] = await defaultRes.json();
        studioId = defaultRows[0]?.id ?? null;
      }

      if (!studioId) {
        return htmlError(404, 'Studio not found');
      }

      // -----------------------------------------------------------------------
      // 2. Fetch event row + related photographer in one PostgREST call
      // -----------------------------------------------------------------------
      const eventRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/events` +
          `?slug=eq.${encodeURIComponent(slug)}` +
          `&studio_id=eq.${studioId}` +
          `&select=*,photographers(*)` +
          `&limit=1`,
        { headers: sbHeaders },
      );
      const events: EventRow[] = await eventRes.json();

      if (!events || events.length === 0) {
        return htmlError(404, `Event "${slug}" not found`);
      }

      const event = events[0];
      // PostgREST returns a nested array for the foreign-key join
      const photographer: PhotographerRow | null = Array.isArray(event.photographers)
        ? (event.photographers[0] ?? null)
        : (event.photographers ?? null);

      // Handle manifest.json dynamic compilation
      if (manifestMatch) {
        const type = event.event_type || 'Wedding';
        let title = '';
        let shortName = '';
        
        if (type === 'Wedding' || type === 'Engagement') {
          const gName = event.groom_name || 'Groom';
          const bName = event.bride_name || 'Bride';
          title = `${gName} & ${bName} ${type} Live Broadcast`;
          shortName = `${gName} & ${bName}`;
        } else {
          const cName = event.celebrant_name || 'Celebrant';
          title = `${cName}'s ${type} Live Broadcast`;
          shortName = cName;
        }

        // Dynamic icons utilizing Cloudinary face-cropping / center fill to create a square avatar icon
        const rawThumb = event.thumbnail_url || 'https://eventcast.pro/assets/img/default-thumbnail.jpg';
        let icon192 = rawThumb;
        let icon512 = rawThumb;

        if (rawThumb.includes('cloudinary.com')) {
          icon192 = rawThumb.replace('/upload/', '/upload/c_fill,g_auto,w_192,h_192,f_auto,q_auto/');
          icon512 = rawThumb.replace('/upload/', '/upload/c_fill,g_auto,w_512,h_512,f_auto,q_auto/');
        }

        const manifestJSON = {
          name: title,
          short_name: shortName,
          description: `Watch the live broadcast of ${shortName}'s ${type.toLowerCase()} celebration on Eventcast.pro`,
          start_url: `/events/${slug}`,
          display: 'standalone',
          background_color: '#0a0a0f',
          theme_color: '#0a0a0f',
          orientation: 'portrait',
          icons: [
            {
              src: icon192,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: icon512,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any'
            }
          ]
        };

        return new Response(JSON.stringify(manifestJSON, null, 2), {
          headers: {
            'Content-Type': 'application/manifest+json; charset=utf-8',
            'Cache-Control': 'public, s-maxage=3600', // Cache 1 hour at edge
          },
        });
      }

      // -----------------------------------------------------------------------
      // 3. Pick template, render, return
      // -----------------------------------------------------------------------
      const templateHtml = TEMPLATES[event.template_id ?? DEFAULT_TEMPLATE_ID]
        ?? TEMPLATES[DEFAULT_TEMPLATE_ID];

      // Resolve visitor country at the edge — Cloudflare provides CF-IPCountry
      // automatically for all requests (free, zero-latency, no external API).
      // Falls back to 'Unknown' on local dev or if the header is absent.
      const countryCode = request.headers.get('CF-IPCountry') ?? 'Unknown';

      const rendered = renderEvent(templateHtml, event, photographer, slug, env, countryCode);

      return new Response(rendered, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          // Cache 60 s at edge; stale responses still served for 5 min while revalidating
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
          'X-Rendered-By': 'render-event-page-worker',
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[render-event-page]', msg);
      return new Response('Internal Server Error', { status: 500 });
    }
  },
};

// ---------------------------------------------------------------------------
// Types (minimal shape — extend as the schema evolves)
// ---------------------------------------------------------------------------
interface EventRow {
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
}

interface PhotographerRow {
  id: string;
  name?: string | null;
  instagram?: string | null;
  website?: string | null;
  logo_url?: string | null;
  [key: string]: unknown;
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

// ---------------------------------------------------------------------------
// Venue / map URL helpers
// ---------------------------------------------------------------------------
function buildEmbedUrl(vMap: string | null | undefined, vName: string | null | undefined): string {
  const name = vName ?? '';
  if (!vMap && !name) return '';
  if (vMap && vMap.includes('<iframe')) {
    const m = vMap.match(/src="([^"]+)"/);
    return m ? m[1] : '';
  }
  let q = name;
  if (vMap) {
    try {
      const urlStr = vMap.startsWith('http') ? vMap : `https://${vMap}`;
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
  if (vMap && !vMap.includes('<iframe')) return vMap;
  if (vName) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(vName)}`;
  return '';
}

// ---------------------------------------------------------------------------
// Core renderer — mirrors every HTML mutation that used to happen in route.ts
// ---------------------------------------------------------------------------
function renderEvent(
  templateHtml: string,
  event: EventRow,
  photographer: PhotographerRow | null,
  slug: string,
  env: Env,
  countryCode: string = 'Unknown',
): string {
  const groom      = event.groom_name ?? event.celebrant_name ?? 'Event';
  const bride      = event.bride_name ?? 'Family';
  const type       = event.event_type ?? 'wedding';
  const thumbnailUrl = event.thumbnail_url ?? '';
  const vName      = event.venue_name ?? '';
  const vMap       = event.venue_map_link ?? '';

  const formattedDate = formatDate(event.event_date ?? '');
  const formattedTime = formatTime(event.event_time ?? '');

  const isSinglePerson = !bride || bride.toLowerCase() === 'family';
  const mainName   = isSinglePerson ? groom : `${groom} & ${bride}`;
  const typeLabel  = type.charAt(0).toUpperCase() + type.slice(1);
  const displayTitle = `✨ ${mainName} ${typeLabel} Live | ${formattedDate}`;
  const displayDesc  = 'Join us live to celebrate this beautiful traditional occasion filled with blessings, happiness, culture, and family moments.';

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
  const timerTime = event.timer_target_time ?? event.event_time ?? '09:00';

  // YouTube
  const youtubeId = (event.vod_link ?? '').split('/').pop() ?? '';

  // Map URLs
  const embedUrl    = buildEmbedUrl(vMap, vName);
  const navigateUrl = buildNavigateUrl(vMap, vName);

  // Config object strings — escape for safe JS string literal embedding
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

  const configScript = `<script>
window.WEDDING_CONFIG = {
  groom: "${esc(event.groom_name ?? event.celebrant_name ?? '')}",
  bride: "${esc(event.bride_name ?? 'Family')}",
  date: "${esc(formattedDate)}",
  time: "${esc(formattedTime)}",
  timeLabel: "${esc(type)}",
  timeSubtext: "",
  timerTarget: "${esc(event.event_date ?? '')}T${esc(timerTime)}",
  venue: "${esc(vName)}",
  venueSubtext: "",
  venueUrl: ${embedUrl ? JSON.stringify(embedUrl) : 'null'},
  venueNavigateUrl: ${navigateUrl ? JSON.stringify(navigateUrl) : 'null'},
  youtubeId: "${esc(youtubeId)}",
  restreamerUrl: "${esc(event.restreamer_hls_url ?? '')}",
  restreamerPlayer: "${esc(event.restreamer_player_url ?? '')}",
  invitationVideo: "${esc(invitationVideos[0] ?? '')}",
  invitationVideos: ${JSON.stringify(invitationVideos)},
  thumbnail: "${esc(thumbnailUrl)}",
  gallery: ${JSON.stringify(galleryArray)},
  supabaseUrl: "${esc(env.SUPABASE_URL)}",
  supabaseKey: "${esc(env.SUPABASE_ANON_KEY)}",
  eventId: "${esc(event.id)}",
  eventType: "${esc(type)}",
  introText: "${esc(event.custom_top_title ?? '')}",
  photographer: ${JSON.stringify(photographer)},
  customInitials: "${esc(customInitials)}",
  hideLoaderPhoto: ${hideLoaderPhoto ? 'true' : 'false'},
  loaderPhotoUrl: "${esc(loaderPhotoUrl)}",
  country: "${esc(countryCode)}",
  guestPhotoWallEnabled: ${event.guest_photo_wall_enabled !== false ? 'true' : 'false'},
  guestPhotoLimit: ${event.guest_photo_limit ?? 50}
};
</script>`;

  let html = templateHtml;

  // --- SEO meta tags ---
  html = html.replace(/<title>.*?<\/title>/gs,       `<title>${displayTitle}</title>`);
  html = html.replace(/<meta property="og:title" content=".*?">/g,       `<meta property="og:title" content="${displayTitle}">`);
  html = html.replace(/<meta name="description" content=".*?">/g,        `<meta name="description" content="${displayDesc}">`);
  html = html.replace(/<meta property="og:description" content=".*?">/g, `<meta property="og:description" content="${displayDesc}">`);
  html = html.replace(/<meta property="og:image" content=".*?">/g,       `<meta property="og:image" content="${thumbnailUrl}">`);
  html = html.replace(/<meta property="og:url" content=".*?">/g,         `<meta property="og:url" content="https://eventcast.pro/events/${slug}">`);
  html = html.replace(/<meta name="twitter:image" content=".*?">/g,      `<meta name="twitter:image" content="${thumbnailUrl}">`);

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

// ---------------------------------------------------------------------------
// Helper — return a minimal HTML error page
// ---------------------------------------------------------------------------
function htmlError(status: number, message: string): Response {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${message}</title></head>`
    + `<body style="font-family:sans-serif;padding:2rem"><h1>${message}</h1></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}
