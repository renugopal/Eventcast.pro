import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { renderEvent } from '@/lib/weddingTemplateRenderer';
import { canonicalRecordToWeddingTemplateRenderRow, type PublicEventCredit } from '@/lib/eventContract';

/**
 * Integration evidence for the canonical/shared TLF-001 preview-renderer
 * foundation: reads the exact template asset the public Worker deploys from
 * (not a copy), maps an owned Wedding Draft's canonical fields through the
 * adapter, and renders it through the one shared `renderEvent` function —
 * proving the whole chain (canonical data -> adapter -> shared renderer ->
 * real template markup) actually works, not just that the pieces typecheck.
 */

const TEMPLATE_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'workers',
  'render-event-page',
  'templates',
  'wedding-template-01',
  'index.html'
);

function loadCanonicalTemplateHtml(): string {
  return fs.readFileSync(TEMPLATE_PATH, 'utf-8');
}

describe('wedding-template-01 Draft preview — canonical renderer integration', () => {
  it('reads the real canonical template asset the public Worker deploys from', () => {
    expect(fs.existsSync(TEMPLATE_PATH)).toBe(true);
    const html = loadCanonicalTemplateHtml();
    expect(html).toContain('<html');
    // The Worker deploys CSS/JS from a public CDN URL, not an inlined bundle —
    // confirms this is the real deployed shell, not a stand-in fixture.
    expect(html).toContain('wedding-template-01/style.css');
  });

  it('renders an owned Wedding Draft end-to-end through the shared renderer with no crash', () => {
    const templateHtml = loadCanonicalTemplateHtml();

    const renderRow = canonicalRecordToWeddingTemplateRenderRow({
      id: 'evt-preview-1',
      studioId: 'studio-a',
      slug: 'raj-priya-wedding',
      eventType: 'Wedding',
      groomName: 'Raj',
      brideName: 'Priya',
      scheduledStartAt: '2026-12-01T18:30:00+05:30',
      venueName: 'Taj Krishna, Banjara Hills',
      templateId: 'wedding-template-01',
      guestPhotoWallEnabled: true,
      thumbnailUrl: null,
    });

    const html = renderEvent(
      templateHtml,
      renderRow,
      null,
      'raj-priya-wedding',
      { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon-key' },
      'Unknown',
      'admin.eventcast.pro',
      false
    );

    // Canonical Draft data actually reached the rendered markup/config.
    expect(html).toContain('window.WEDDING_CONFIG');
    expect(html).toContain('groom: "Raj"');
    expect(html).toContain('bride: "Priya"');
    expect(html).toContain('<span class="first-name">Raj</span>');
    expect(html).toContain('<span class="second-name">Priya</span>');
    expect(html).toContain('Taj Krishna');
    expect(html).toContain('eventId: "evt-preview-1"');
    expect(html).toContain('studioId: "studio-a"');
    // Regression: the renderer previously double-formatted the hero time
    // ("6:30 PM AM") because the adapter fed it a 12-hour display string
    // where it expects 24-hour HH:mm. Must render the correct 12-hour time
    // exactly once, with no "AM"/"PM" ever adjacent to another AM/PM token.
    expect(html).toContain('time: "6:30 PM"');
    expect(html).not.toContain('6:30 PM AM');
    expect(html).not.toMatch(/\d{1,2}:\d{2}\s*(AM|PM)\s*(AM|PM)/);
  });

  it('never activates live playback for a Draft — hasLivePlayback is always passed false, so no SRS/Media Agent URL is ever emitted', () => {
    const templateHtml = loadCanonicalTemplateHtml();
    const renderRow = canonicalRecordToWeddingTemplateRenderRow({
      id: 'evt-preview-1',
      studioId: 'studio-a',
      slug: 'raj-priya-wedding',
      eventType: 'Wedding',
      groomName: 'Raj',
      brideName: 'Priya',
      scheduledStartAt: '2026-12-01T18:30:00+05:30',
      venueName: 'Taj Krishna',
      templateId: 'wedding-template-01',
      guestPhotoWallEnabled: true,
      thumbnailUrl: null,
    });

    const html = renderEvent(
      templateHtml,
      renderRow,
      null,
      'raj-priya-wedding',
      { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon-key' },
      'Unknown',
      'admin.eventcast.pro',
      false
    );

    expect(html).not.toContain('/hls/live/index.m3u8');
    expect(html).toContain('restreamerUrl: ""');
  });

  it('hides the gallery and invitation-video sections a fresh Draft has not populated yet', () => {
    const templateHtml = loadCanonicalTemplateHtml();
    const renderRow = canonicalRecordToWeddingTemplateRenderRow({
      id: 'evt-preview-1',
      studioId: 'studio-a',
      slug: 'raj-priya-wedding',
      eventType: 'Wedding',
      groomName: 'Raj',
      brideName: 'Priya',
      scheduledStartAt: '2026-12-01T18:30:00+05:30',
      venueName: 'Taj Krishna',
      templateId: 'wedding-template-01',
      guestPhotoWallEnabled: true,
      thumbnailUrl: null,
    });

    const html = renderEvent(
      templateHtml,
      renderRow,
      null,
      'raj-priya-wedding',
      { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon-key' },
      'Unknown',
      'admin.eventcast.pro',
      false
    );

    expect(html).toMatch(/<section id="photo-gallery"[^>]*style="display:none"/);
    expect(html).toMatch(/<section id="invitation-video"[^>]*style="display:none"/);
  });

  it('emits an assigned thumbnailUrl into og:image and twitter:image (baseline SEO-001)', () => {
    const templateHtml = loadCanonicalTemplateHtml();
    const renderRow = canonicalRecordToWeddingTemplateRenderRow({
      id: 'evt-preview-1',
      studioId: 'studio-a',
      slug: 'raj-priya-wedding',
      eventType: 'Wedding',
      groomName: 'Raj',
      brideName: 'Priya',
      scheduledStartAt: '2026-12-01T18:30:00+05:30',
      venueName: 'Taj Krishna',
      templateId: 'wedding-template-01',
      guestPhotoWallEnabled: true,
      thumbnailUrl: 'https://r2.example/thumb.jpg',
    });

    const html = renderEvent(
      templateHtml,
      renderRow,
      null,
      'raj-priya-wedding',
      { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon-key' },
      'Unknown',
      'admin.eventcast.pro',
      false
    );

    expect(html).toMatch(/<meta property="og:image" content="https:\/\/r2\.example\/thumb\.jpg\?v=\d+">/);
    expect(html).toMatch(/<meta name="twitter:image" content="https:\/\/r2\.example\/thumb\.jpg\?v=\d+">/);
  });

  it('renders safely with an empty og:image/twitter:image when the Draft has no thumbnailUrl yet', () => {
    const templateHtml = loadCanonicalTemplateHtml();
    const renderRow = canonicalRecordToWeddingTemplateRenderRow({
      id: 'evt-preview-1',
      studioId: 'studio-a',
      slug: 'raj-priya-wedding',
      eventType: 'Wedding',
      groomName: 'Raj',
      brideName: 'Priya',
      scheduledStartAt: '2026-12-01T18:30:00+05:30',
      venueName: 'Taj Krishna',
      templateId: 'wedding-template-01',
      guestPhotoWallEnabled: true,
      thumbnailUrl: null,
    });

    const html = renderEvent(
      templateHtml,
      renderRow,
      null,
      'raj-priya-wedding',
      { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon-key' },
      'Unknown',
      'admin.eventcast.pro',
      false
    );

    expect(html).toContain('<meta property="og:image" content="">');
    expect(html).toContain('<meta name="twitter:image" content="">');
  });

  it('threads the ordered public Event Credit list into window.WEDDING_CONFIG.eventCredits (baseline PART-005)', () => {
    const templateHtml = loadCanonicalTemplateHtml();

    const eventCredits: PublicEventCredit[] = [
      { businessName: 'Primary Studio', roleLabel: 'photographer', isPrimary: true, logoUrl: 'https://r2.example/logo.png', websiteUrl: null, instagramUrl: null, facebookUrl: null, youtubeUrl: null },
      { businessName: 'Additional Venue', roleLabel: 'venue', isPrimary: false, logoUrl: null, websiteUrl: null, instagramUrl: null, facebookUrl: null, youtubeUrl: null },
    ];

    const renderRow = canonicalRecordToWeddingTemplateRenderRow(
      {
        id: 'evt-preview-1',
        studioId: 'studio-a',
        slug: 'raj-priya-wedding',
        eventType: 'Wedding',
        groomName: 'Raj',
        brideName: 'Priya',
        scheduledStartAt: '2026-12-01T18:30:00+05:30',
        venueName: 'Taj Krishna, Banjara Hills',
        templateId: 'wedding-template-01',
        guestPhotoWallEnabled: true,
        thumbnailUrl: null,
      },
      eventCredits
    );

    const html = renderEvent(
      templateHtml,
      renderRow,
      { id: '', name: 'Primary Studio', studio_name: 'Primary Studio', logo_url: 'https://r2.example/logo.png' },
      'raj-priya-wedding',
      { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon-key' },
      'Unknown',
      'admin.eventcast.pro',
      false
    );

    expect(html).toContain(`eventCredits: ${JSON.stringify(eventCredits)}`);
    // Primary credit reuses the existing footer studio-name/logo slot.
    expect(html).toContain('"studio_name":"Primary Studio"');
  });

  it('renders safely with no Event Credits — a no-credit Draft is not a broken preview', () => {
    const templateHtml = loadCanonicalTemplateHtml();
    const renderRow = canonicalRecordToWeddingTemplateRenderRow({
      id: 'evt-preview-1',
      studioId: 'studio-a',
      slug: 'raj-priya-wedding',
      eventType: 'Wedding',
      groomName: 'Raj',
      brideName: 'Priya',
      scheduledStartAt: '2026-12-01T18:30:00+05:30',
      venueName: 'Taj Krishna',
      templateId: 'wedding-template-01',
      guestPhotoWallEnabled: true,
      thumbnailUrl: null,
    });

    const html = renderEvent(
      templateHtml,
      renderRow,
      null,
      'raj-priya-wedding',
      { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon-key' },
      'Unknown',
      'admin.eventcast.pro',
      false
    );

    expect(html).toContain('eventCredits: []');
    expect(html).toContain('photographer: null');
  });

  it('renders notes time_subtext under Sumuhurtham without changing the page date', () => {
    const templateHtml = loadCanonicalTemplateHtml();
    const html = renderEvent(
      templateHtml,
      {
        id: 'evt-namratha',
        slug: 'namratha-sai-teja-wedding',
        studio_id: 'studio-a',
        template_id: 'wedding-template-01',
        event_type: 'Wedding',
        groom_name: 'Namratha',
        bride_name: 'Sai Teja',
        event_date: '2026-08-16',
        event_time: '00:25',
        timer_target_time: '19:30',
        venue_name: 'Sri Vasavi Kanyaka Parameswari Temple, Tenali',
        notes: 'time_subtext:(Early Hours of Monday)',
      },
      null,
      'namratha-sai-teja-wedding',
      { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon-key' },
      'Unknown',
      'eventcast.pro',
      false,
    );

    expect(html).toContain('Namratha');
    expect(html).toContain('Sai Teja');
    expect(html).toContain('Sunday, August 16th');
    expect(html).toContain('time: "12:25 AM"');
    expect(html).toContain('timerTarget: "2026-08-16T19:30:00"');
    expect(html).toContain('timeSubtext: "(Early Hours of Monday)"');
    expect(html).toContain('<span class="info-subtext">(Early Hours of Monday)</span>');
    expect(html).toContain('<title>Namratha ❤️ Sai Teja Wedding Live | 16th August</title>');
  });
});

describe('public Worker shares the exact same canonical renderer — no duplicate renderEvent (baseline TPL-002/TPL-003)', () => {
  it('imports renderEvent from this exact eventcast-admin module by relative path, and defines no local renderEvent of its own', () => {
    const workerSourcePath = path.join(
      __dirname,
      '..',
      '..',
      '..',
      'workers',
      'render-event-page',
      'src',
      'index.ts'
    );
    const workerSource = fs.readFileSync(workerSourcePath, 'utf-8');

    expect(workerSource).toMatch(
      /import\s*\{[^}]*\brenderEvent\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/\.\.\/eventcast-admin\/src\/lib\/weddingTemplateRenderer['"]/
    );
    // No second, divergent implementation defined locally in the Worker.
    expect(workerSource).not.toMatch(/function\s+renderEvent\s*\(/);
    expect(workerSource).not.toMatch(/const\s+renderEvent\s*=/);
  });
});
