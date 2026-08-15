import weddingTemplate01 from '../templates/wedding-template-01/index.html';
import {
  buildR2Key,
  fallbackCacheControl,
  fallbackContentType,
  isValidPlaybackId,
  parseHlsAssetPath,
  rewriteManifest,
} from './hls-playback.mjs';
import {
  buildB2PlaylistKey,
  buildB2SegmentKey,
  buildSignedB2GetRequest,
  parseB2VodAssetPath,
  rewriteB2Manifest,
} from './b2playback.mjs';
import { renderEvent, type EventRow, type PhotographerRow } from '../../../eventcast-admin/src/lib/weddingTemplateRenderer';
import {
  primaryPublicEventCreditToPhotographerRow,
  type PublicEventCredit,
} from '../../../eventcast-admin/src/lib/eventContract';
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
  /**
   * Private R2 bucket holding Media Agent output (manifests + segments).
   * Read exclusively through this binding — the bucket is never public and
   * no direct R2 URL is ever constructed or returned.
   *
   * Optional at the type level on purpose: the binding is configured in a
   * follow-up slice, and until then every playback request must fail as an
   * ordinary 404 rather than a runtime exception.
   */
  MEDIA_R2?: R2Bucket;

  /**
   * Backblaze B2 authoritative-VOD read credentials. B2 has no
   * Cloudflare-native binding, so this is a plain S3-compatible endpoint +
   * key pair used to sign an outbound GET (`b2playback.mjs`), never a
   * bucket URL or credential returned to a browser. Names mirror the
   * eventcast-admin `b2Client.ts` convention. All optional at the type
   * level: no B2 credentials are configured in any environment today (only
   * the Media Agent's separate write-capable credentials exist, and those
   * are never reused here), so every B2-VOD request must fail as the same
   * ordinary 404 rather than a runtime exception until a read-only
   * credential pair is explicitly provisioned as a Worker secret.
   */
  B2_S3_ENDPOINT?: string;
  B2_REGION?: string;
  B2_BUCKET_NAME?: string;
  B2_ACCESS_KEY_ID?: string;
  B2_SECRET_ACCESS_KEY?: string;
  /** Matches the Media Agent's own EVENTCAST_B2_OBJECT_PREFIX; empty by default. */
  B2_KEY_PREFIX?: string;
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

/**
 * The public event row as PostgREST returns it for `select=*`, plus the
 * Publish-time public Event Credit snapshot column (`published_credits`,
 * migration 0030). The snapshot is written only by the controlled Publish
 * endpoint, already redacted through `projectPublicEventCredits()`; the
 * Worker consumes it as-is and never reads `partners`/`event_credits`.
 */
interface PublicEventRow extends EventRow {
  published_credits?: PublicEventCredit[] | null;
  event_visibility?: string | null;
}

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
    const eventMatch = url.pathname.match(/^\/events\/([^/]+?)\/?$/);
    const manifestMatch = url.pathname.match(/^\/events\/([^/]+?)\/manifest\.json$/);
    const swMatch = url.pathname.match(/^\/events\/([^/]+?)\/sw\.js$/);
    const hlsMatch = url.pathname.match(/^\/events\/([^/]+)\/hls\/(.+)$/);
    const b2VodMatch = url.pathname.match(/^\/events\/([^/]+)\/vod\/b2\/(.+)$/);

    if (!eventMatch && !manifestMatch && !swMatch && !hlsMatch && !b2VodMatch) {
      return fetch(request);
    }

    const slug = decodeURIComponent(
      eventMatch
        ? eventMatch[1]
        : manifestMatch
          ? manifestMatch[1]
          : swMatch
            ? swMatch[1]
            : hlsMatch
              ? hlsMatch[1]
              : b2VodMatch![1],
    );
    const hostname = url.hostname;
    let deferredServiceWorkerResponse: Response | null = null;

    // Build sw.js without returning it yet; every event-specific response is
    // authorized by the public-and-unarchived event lookup below first.
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

      deferredServiceWorkerResponse = new Response(swCode, {
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
        return htmlError(404);
      }

      // -----------------------------------------------------------------------
      // 2. Fetch event row + related photographer in one PostgREST call
      //
      // `page_state=eq.published` is the public-page availability gate: this
      // Worker reads with the service-role key, which bypasses the
      // `events_public_select_policy` RLS rule (migration 0029) installed for
      // anonymous reads, so the same Published requirement is applied here
      // explicitly. Without it a Draft would be renderable before the
      // controlled Publish action ran.
      //
      // Widening event_visibility to also accept "unlisted" here is the
      // Visibility Foundation Gate's deliberate security boundary: this
      // Worker (service-role,
      // single exact-slug lookup only, never a listing query) is the sole
      // path that delivers a Published + Unlisted page by direct link.
      // `events_public_select_policy` (the anonymous Supabase SELECT policy,
      // migration 0031) is intentionally left Public-only and NOT widened
      // here or anywhere else, so an Unlisted row can never be anonymously
      // enumerated through a direct Supabase query — only resolved one exact
      // slug at a time by this Worker. Legacy `private`/`synthetic` values
      // remain excluded from both paths, unchanged. This gates page
      // availability only; it is unrelated to livestream start/activation.
      // -----------------------------------------------------------------------
      let eventRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/events` +
          `?slug=eq.${encodeURIComponent(slug)}` +
          `&studio_id=eq.${studioId}` +
          `&page_state=eq.published` +
          `&event_visibility=in.(public,unlisted)` +
          `&archived_at=is.null` +
          `&select=*,photographers(*)` +
          `&limit=1`,
        { headers: sbHeaders },
      );
      let events: PublicEventRow[] = await eventRes.json();

      if (!events || events.length === 0) {
        const hyphenatedSlug = slug.replace(/\s+/g, '-');
        if (hyphenatedSlug !== slug) {
          eventRes = await fetch(
            `${env.SUPABASE_URL}/rest/v1/events` +
              `?slug=eq.${encodeURIComponent(hyphenatedSlug)}` +
              `&studio_id=eq.${studioId}` +
              `&page_state=eq.published` +
              `&event_visibility=in.(public,unlisted)` +
              `&archived_at=is.null` +
              `&select=*,photographers(*)` +
              `&limit=1`,
            { headers: sbHeaders },
          );
          events = await eventRes.json();
        }
      }

      if (!events || events.length === 0) {
        return htmlError(404);
      }

      const event = events[0];
      // PostgREST returns a nested array for the foreign-key join
      const legacyPhotographer: PhotographerRow | null = Array.isArray(event.photographers)
        ? (event.photographers[0] ?? null)
        : (event.photographers ?? null);

      // A published page renders the credit snapshot frozen into this row at
      // Publish time (baseline PART-006: "published events preserve a snapshot
      // of public credit details so that later partner-profile edits do not
      // rewrite historical event pages"). The mutable `partners` /
      // `event_credits` tables are deliberately never queried here — the
      // snapshot is already the redacted `PublicEventCredit` projection, so
      // the Worker re-projects nothing and can expose no private Partner field.
      const publishedCredits: PublicEventCredit[] = Array.isArray(event.published_credits)
        ? event.published_credits
        : [];
      event.event_credits = publishedCredits;

      // Same single footer credit slot the Admin Draft Preview already fills
      // (preview/production parity, CRT-011) — no second credit surface. Rows
      // with no snapshot (legacy events published before this capability) keep
      // their existing legacy `photographers` footer behavior unchanged.
      const photographer: PhotographerRow | null =
        primaryPublicEventCreditToPhotographerRow(publishedCredits) ?? legacyPhotographer;

      if (hlsMatch) {
        return serveHlsAssetFromR2(env, slug, event.id, hlsMatch[2]);
      }

      if (b2VodMatch) {
        return serveB2VodAsset(env, slug, event.id, b2VodMatch[2]);
      }

      if (deferredServiceWorkerResponse) {
        return deferredServiceWorkerResponse;
      }

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

      // Live playback is offered only when this event currently has an
      // enabled media assignment; the playback_id itself never reaches the
      // page, only the fact that the public live route is servable.
      const hasLivePlayback = (await resolveEnabledPlaybackId(env, event.id)) !== null;

      // B2-authoritative replay (Milestone N): resolved independently of
      // live state so a page can offer the finalized recording once the
      // stream has ended, and stops offering it once retention expires.
      const recordingEvidence = await loadEventRecordingEvidence(env, event.id);
      const hasB2Replay = !hasLivePlayback && isB2ReplayEligible(env, recordingEvidence);
      // Verified YouTube fallback (STO-005) only ever displaces the player
      // once neither live nor B2 replay can be offered — never before.
      // `youtube_fallback_verified` has no producer yet anywhere in this
      // repository (see event_recordings migration 0035's own comment), so
      // this resolves to null for every event today; the wiring exists so a
      // future verification mechanism has nothing left to build in the
      // delivery path itself.
      const verifiedYoutubeFallbackUrl =
        !hasLivePlayback && !hasB2Replay && recordingEvidence?.youtube_fallback_verified === true
          ? (recordingEvidence.youtube_fallback_url ?? null)
          : null;

      const rendered = renderEvent(
        templateHtml, event, photographer, slug, env, countryCode, hostname,
        hasLivePlayback, hasB2Replay, verifiedYoutubeFallbackUrl,
      );

      const responseHeaders: Record<string, string> = {
        'Content-Type': 'text/html; charset=utf-8',
        // Cache 60 s at edge; stale responses still served for 5 min while revalidating
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        'X-Rendered-By': 'render-event-page-worker',
      };
      // Unlisted pages stay link-accessible but must not be publicly
      // indexed/discovered (Visibility Foundation Gate). Public responses
      // never receive this header.
      if (event.event_visibility === 'unlisted') {
        responseHeaders['X-Robots-Tag'] = 'noindex';
      }

      return new Response(rendered, {
        status: 200,
        headers: responseHeaders,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[render-event-page]', msg);
      return new Response('Internal Server Error', { status: 500 });
    }
  },
};

/**
 * Look up this event's currently-enabled playback_id via the service-role
 * PostgREST endpoint. Returns null for a disabled/absent assignment, a
 * malformed playback_id, or any upstream failure — callers must treat every
 * null identically so a caller can never distinguish "no assignment" from
 * "assignment disabled" from "lookup failed".
 */
async function resolveEnabledPlaybackId(env: Env, eventId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/media_event_assignments` +
        `?event_id=eq.${encodeURIComponent(eventId)}` +
        `&enabled=is.true` +
        `&select=playback_id` +
        `&limit=1`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
      },
    );
    if (!res.ok) return null;

    const rows: { playback_id?: string | null }[] = await res.json();
    const playbackId = rows[0]?.playback_id;
    return isValidPlaybackId(playbackId) ? (playbackId as string) : null;
  } catch {
    // Log the failure class only — never the event id or the playback id.
    console.error('[render-event-page] playback assignment lookup failed');
    return null;
  }
}

/**
 * The provider-facing/public-safe subset of `event_recordings` this Worker
 * ever needs. Never `b2_object_key`/`b2_bucket` directly — those are
 * resolved server-side inside `serveB2VodAsset` from `finalization_generation`
 * via the same deterministic key layout the Media Agent used to write them,
 * so no raw B2 identifier needs to travel through this lookup at all.
 */
interface RecordingEvidenceRow {
  recording_state: string;
  finalization_generation: string | null;
  integrity_verified_at: string | null;
  retention_expires_at: string | null;
  youtube_fallback_url: string | null;
  youtube_fallback_verified: boolean;
}

/**
 * Loads this event's `event_recordings` row (if any) via the service-role
 * PostgREST endpoint. Every failure — no row, upstream error — collapses to
 * `null`, exactly like `resolveEnabledPlaybackId`, so a caller can never
 * distinguish "not recorded yet" from "lookup failed".
 */
async function loadEventRecordingEvidence(env: Env, eventId: string): Promise<RecordingEvidenceRow | null> {
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/event_recordings` +
        `?event_id=eq.${encodeURIComponent(eventId)}` +
        `&select=recording_state,finalization_generation,integrity_verified_at,retention_expires_at,youtube_fallback_url,youtube_fallback_verified` +
        `&limit=1`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
      },
    );
    if (!res.ok) return null;
    const rows: RecordingEvidenceRow[] = await res.json();
    return rows[0] ?? null;
  } catch {
    console.error('[render-event-page] recording evidence lookup failed');
    return null;
  }
}

/**
 * Reads B2 read-credential names only from `env` — mirrors
 * eventcast-admin's `loadB2ConfigFromEnv()` convention. Returns `null`
 * (never throws) if any required binding is absent, which is expected in
 * every environment today: no B2 read credentials have been provisioned as
 * a Worker secret anywhere, so this always resolves `null` in production
 * until that separate, explicit credential-provisioning approval happens.
 */
function loadB2PlaybackConfigFromEnv(env: Env): {
  endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; prefix: string;
} | null {
  const { B2_S3_ENDPOINT, B2_REGION, B2_BUCKET_NAME, B2_ACCESS_KEY_ID, B2_SECRET_ACCESS_KEY } = env;
  if (!B2_S3_ENDPOINT || !B2_REGION || !B2_BUCKET_NAME || !B2_ACCESS_KEY_ID || !B2_SECRET_ACCESS_KEY) return null;
  return {
    endpoint: B2_S3_ENDPOINT,
    region: B2_REGION,
    bucket: B2_BUCKET_NAME,
    accessKeyId: B2_ACCESS_KEY_ID,
    secretAccessKey: B2_SECRET_ACCESS_KEY,
    prefix: env.B2_KEY_PREFIX ?? '',
  };
}

/**
 * The full B2 replay-eligibility gate (Milestone N). Fails closed on any
 * missing evidence, mirroring `eventcast-admin`'s `isR2CleanupEligible()`
 * fail-closed posture for the analogous R2-side question:
 *  - a real B2 read path must actually be configured (never advertise a URL
 *    that cannot be served)
 *  - `recording_state` must be exactly 'b2_finalized'
 *  - `finalization_generation` must be present (it addresses the B2 key)
 *  - `integrity_verified_at` must be present (byte-integrity proven)
 *  - `retention_expires_at` must be present AND still in the future — an
 *    expired recording is not offered, which is what lets the verified
 *    YouTube fallback (STO-005) take over automatically with no extra flag.
 */
function isB2ReplayEligible(env: Env, recording: RecordingEvidenceRow | null): boolean {
  if (!recording) return false;
  if (!loadB2PlaybackConfigFromEnv(env)) return false;
  if (recording.recording_state !== 'b2_finalized') return false;
  if (!recording.finalization_generation) return false;
  if (!recording.integrity_verified_at) return false;
  if (!recording.retention_expires_at) return false;
  return new Date(recording.retention_expires_at).getTime() > Date.now();
}

/**
 * Serve one B2-authoritative VOD asset (manifest or segment) through an
 * authenticated server-to-server B2 fetch. The bucket stays private: no B2
 * host, key, or credential ever reaches the browser — only this Worker's
 * own `/events/{slug}/vod/b2/...` route does, exactly mirroring
 * `serveHlsAssetFromR2`'s posture for the R2 live path.
 *
 * Re-checks eligibility itself (defense in depth: the caller already
 * gated the page's advertised URL on it, but a direct request to this path
 * must be independently authorized, not just trust an earlier decision).
 */
async function serveB2VodAsset(
  env: Env,
  slug: string,
  eventId: string,
  assetPath: string,
): Promise<Response> {
  const asset = parseB2VodAssetPath(assetPath);
  if (!asset) return notFound();

  const config = loadB2PlaybackConfigFromEnv(env);
  if (!config) return notFound();

  const recording = await loadEventRecordingEvidence(env, eventId);
  if (!isB2ReplayEligible(env, recording)) return notFound();

  let key: string | null;
  if (asset.kind === 'manifest') {
    key = buildB2PlaylistKey(config.prefix, eventId, recording!.finalization_generation!);
  } else {
    key = buildB2SegmentKey(config.prefix, eventId, asset.sessionId, asset.objectName);
  }
  if (!key) return notFound();

  let upstream: Response;
  try {
    const signedRequest = await buildSignedB2GetRequest(config, key);
    upstream = await fetch(signedRequest);
  } catch {
    console.error('[render-event-page] B2 read failed');
    return notFound();
  }
  if (!upstream.ok || !upstream.body) return notFound();

  if (asset.kind === 'segment') {
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'video/MP2T',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  const rewritten = rewriteB2Manifest(await upstream.text(), slug);
  if (rewritten === null) return notFound();

  return new Response(rewritten, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * Serve one HLS asset out of the private R2 bucket.
 *
 * Ordering is the security property: the caller has already passed the
 * public-and-unarchived event gate, so this function only ever runs for an
 * event a visitor is allowed to watch. Within it, the request path is
 * validated against a strict allowlist *before* a playback_id is resolved
 * and before any key is constructed.
 *
 * Every failure — unparseable path, no enabled assignment, unconfigured
 * binding, missing object, R2 error, unrewritable manifest — returns the
 * exact same 404, so responses reveal nothing about which objects, buckets,
 * or assignments exist.
 */
async function serveHlsAssetFromR2(
  env: Env,
  slug: string,
  eventId: string,
  assetPath: string,
): Promise<Response> {
  const asset = parseHlsAssetPath(assetPath);
  if (!asset) return notFound();

  const bucket = env.MEDIA_R2;
  if (!bucket) return notFound();

  const playbackId = await resolveEnabledPlaybackId(env, eventId);
  if (!playbackId) return notFound();

  const key = buildR2Key(playbackId, asset.assetPath);
  if (!key) return notFound();

  let object: R2ObjectBody | null;
  try {
    object = await bucket.get(key);
  } catch {
    console.error('[render-event-page] R2 read failed');
    return notFound();
  }
  if (!object) return notFound();

  const contentType = object.httpMetadata?.contentType ?? fallbackContentType(asset);
  const cacheControl = object.httpMetadata?.cacheControl ?? fallbackCacheControl(asset);
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
    'Access-Control-Allow-Origin': '*',
  };

  if (asset.kind === 'segment') {
    // Segments are opaque media bytes — streamed straight through.
    return new Response(object.body, { status: 200, headers });
  }

  // Manifests carry absolute-path segment references addressed by the
  // private playback_id; they must be rewritten onto the public route
  // before leaving the Worker. rewriteManifest fails closed, and a failure
  // is indistinguishable from a missing object.
  const rewritten = rewriteManifest(await object.text(), playbackId, slug);
  if (rewritten === null) return notFound();

  return new Response(rewritten, { status: 200, headers });
}

/**
 * The single 404 used by every playback-path failure. Body, headers, and
 * status are constant so no failure mode is distinguishable from another,
 * and nothing about buckets, keys, playback ids, or object existence leaks.
 */
function notFound(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

// ---------------------------------------------------------------------------
// Helper — return a minimal HTML error page
// ---------------------------------------------------------------------------
function htmlError(status: number, message = 'Not Found'): Response {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${message}</title></head>`
    + `<body style="font-family:sans-serif;padding:2rem"><h1>${message}</h1></body></html>`,
    {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  );
}
