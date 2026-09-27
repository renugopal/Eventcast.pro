// Test-only harness that executes the REAL Worker entry point (index.ts)
// under `node --test` with no added dependency:
//   - Node 24 strips TypeScript types natively;
//   - a module load hook turns bundled `*.html` templates into string
//     default exports (what Wrangler's Text rule does);
//   - a resolve hook adds the `.ts` extension to extension-less relative
//     imports (what esbuild does);
//   - Supabase PostgREST is served by an in-memory `fetch` stub;
//   - MEDIA_R2 is an in-memory fake exposing get/head with `uploaded`.
//
// Never imported by index.ts; only by *.test.mjs files.

import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let hooksRegistered = false;

export function registerWorkerTestHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (err) {
        if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[A-Za-z0-9]+$/.test(specifier)) {
          return nextResolve(`${specifier}.ts`, context);
        }
        throw err;
      }
    },
    load(url, context, nextLoad) {
      if (url.endsWith('.html')) {
        const text = readFileSync(fileURLToPath(url), 'utf8');
        return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
}

export async function loadWorker() {
  registerWorkerTestHooks();
  const mod = await import('./index.ts');
  return mod.default;
}

export const SUPABASE_URL = 'https://supabase.test';
export const EVENT_ID = '11111111-1111-4111-8111-111111111111';
export const STUDIO_ID = '22222222-2222-4222-8222-222222222222';
export const SLUG = 'demo-wedding';

/** In-memory R2 bucket exposing the subset of the binding index.ts uses. */
export function createFakeBucket() {
  const objects = new Map();
  return {
    objects,
    put(key, text, { uploaded = new Date(), contentType, cacheControl } = {}) {
      objects.set(key, { text, uploaded, httpMetadata: { contentType, cacheControl } });
    },
    async head(key) {
      const o = objects.get(key);
      return o ? { key, uploaded: o.uploaded, httpMetadata: o.httpMetadata } : null;
    },
    async get(key) {
      const o = objects.get(key);
      if (!o) return null;
      return {
        key,
        uploaded: o.uploaded,
        httpMetadata: o.httpMetadata,
        body: new Response(o.text).body,
        text: async () => o.text,
      };
    },
  };
}

/**
 * Mutable database state served through a PostgREST-shaped fetch stub.
 * `assignment` is the single media_event_assignments row (or null);
 * `recording` is the single event_recordings row (or null).
 */
export function createDb(overrides = {}) {
  return {
    event: {
      id: EVENT_ID,
      slug: SLUG,
      studio_id: STUDIO_ID,
      template_id: 'wedding-template-01',
      event_type: 'Wedding',
      groom_name: 'Groom',
      bride_name: 'Bride',
      event_date: '2026-09-01',
      event_time: '10:00',
      vod_link: null,
      youtube_url: null,
      youtube_broadcast_id: null,
      published_credits: [],
      photographers: null,
      ...overrides.event,
    },
    assignment: overrides.assignment === undefined ? null : overrides.assignment,
    recording: overrides.recording === undefined ? null : overrides.recording,
  };
}

export function installSupabaseFetch(db) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith(SUPABASE_URL)) {
      return new Response('unexpected upstream', { status: 599 });
    }
    const json = (rows) => new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const path = new URL(url).pathname;
    if (path === '/rest/v1/studios') {
      return json(url.includes('custom_domain=') ? [] : [{ id: STUDIO_ID }]);
    }
    if (path === '/rest/v1/events') return json(db.event ? [db.event] : []);
    if (path === '/rest/v1/media_event_assignments') return json(db.assignment ? [db.assignment] : []);
    if (path === '/rest/v1/event_recordings') return json(db.recording ? [db.recording] : []);
    return new Response('[]', { status: 200 });
  };
  return () => {
    globalThis.fetch = original;
  };
}

export function baseEnv(bucket, extra = {}) {
  return {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
    SUPABASE_ANON_KEY: 'test-anon',
    MEDIA_R2: bucket,
    ...extra,
  };
}

export function request(path) {
  return new Request(`https://eventcast.pro${path}`);
}

/** A media playlist whose every segment line is under one playback id. */
export function playlist(playbackId, { endlist = false, segments = ['seg-1.ts', 'seg-2.ts'], sessionId = 'sess1' } = {}) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:4', '#EXT-X-MEDIA-SEQUENCE:0'];
  for (const s of segments) {
    lines.push('#EXTINF:4.000,');
    lines.push(`/events/${playbackId}/media/${sessionId}/${s}`);
  }
  if (endlist) lines.push('#EXT-X-ENDLIST');
  return `${lines.join('\n')}\n`;
}

/** Extracts the injected window.WEDDING_CONFIG string fields we assert on. */
export function readConfig(html) {
  const pick = (name) => {
    const m = html.match(new RegExp(`${name}: "([^"]*)"`));
    return m ? m[1] : null;
  };
  return {
    restreamerUrl: pick('restreamerUrl'),
    playbackMode: pick('playbackMode'),
    youtubeId: pick('youtubeId'),
  };
}
