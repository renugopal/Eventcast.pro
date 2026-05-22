import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { RestreamerClient, StreamHealth } from '@/lib/restreamer';

export const runtime = 'edge';

/**
 * STREAM HEALTH MONITOR — Cron Route
 *
 * Polls the Restreamer media server for every event currently inside its live window,
 * evaluates stream health, and dispatches alerts for unhealthy streams.
 *
 * Recommended schedule: every 5 minutes during peak hours (e.g. 06:00–22:00 IST)
 *
 * Invoke:
 *   GET /api/cron/stream-health-monitor?secret=<CRON_SECRET>
 *
 * Alert delivery:
 *   1. Always: JSON response + console logs (visible in Cloudflare/Vercel dashboard)
 *   2. Always: Supabase `stream_alerts` table insert (non-fatal if table doesn't exist)
 *   3. Optional WhatsApp via CallMeBot — enable by adding to .env.local:
 *        ALERT_WHATSAPP_PHONE=+91XXXXXXXXXX   (your number with country code)
 *        ALERT_WHATSAPP_APIKEY=XXXXXX          (from callmebot.com)
 *
 * Supabase schema (run once in Supabase SQL editor to enable DB logging):
 *   CREATE TABLE stream_alerts (
 *     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     event_id    uuid REFERENCES events(id) ON DELETE CASCADE,
 *     slug        text NOT NULL,
 *     event_name  text,
 *     alert_type  text NOT NULL,   -- 'stream_not_found' | 'stream_dead' | 'no_signal' | 'low_bitrate'
 *     severity    text NOT NULL,   -- 'critical' | 'warning'
 *     message     text,
 *     bitrate_kbps numeric,
 *     stream_state text,
 *     created_at  timestamptz DEFAULT now()
 *   );
 */

// Bitrate below this (kbps) while state='running' = degraded/dying stream.
// Override via STREAM_BITRATE_THRESHOLD_KBPS env var. Default: 300 kbps.
// (Your diary notes 5000 kbps as the safe ceiling for quality; 300 kbps means the
//  encoder is connected but barely transmitting — effectively a broken stream.)
const BITRATE_THRESHOLD_KBPS =
  Number(process.env.STREAM_BITRATE_THRESHOLD_KBPS ?? 300);

const WHATSAPP_ALERT_COOLDOWN_MINUTES =
  Number(process.env.WHATSAPP_ALERT_COOLDOWN_MINUTES ?? 30);

const ADMIN_PUBLIC_URL =
  process.env.ADMIN_PUBLIC_URL ||
  process.env.NEXT_PUBLIC_ADMIN_URL ||
  'https://eventcast-admin.pages.dev';

// ─── Types ────────────────────────────────────────────────────────────────────

type AlertType = 'stream_not_found' | 'stream_dead' | 'no_signal' | 'low_bitrate';
type AlertSeverity = 'critical' | 'warning';

interface StreamAlert {
  eventId: string;
  slug: string;
  eventName: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  bitrateKbps: number;
  streamState: string;
  checkedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildEventName(event: any): string {
  if (event.groom_name && event.bride_name) {
    return `${event.groom_name} & ${event.bride_name} ${event.event_type}`;
  }
  return `${event.groom_name || event.celebrant_name || 'Unknown'} ${event.event_type}`;
}

/**
 * Evaluate a process health snapshot against expected live-window conditions.
 * Returns a StreamAlert if something is wrong, or null if the stream is healthy.
 */
function evaluateHealth(event: any, health: StreamHealth | null): StreamAlert | null {
  const checkedAt = new Date().toISOString();
  const eventName = buildEventName(event);
  const base = { eventId: event.id, slug: event.slug, eventName, checkedAt };

  // No process on the media server at all
  if (health === null) {
    return {
      ...base,
      type: 'stream_not_found',
      severity: 'critical',
      message: `No media server process found for "${eventName}". The stream channel may not have been set up.`,
      bitrateKbps: 0,
      streamState: 'not_found',
    };
  }

  // Process exists but has crashed / errored out
  if (health.state === 'failed') {
    return {
      ...base,
      type: 'stream_dead',
      severity: 'critical',
      message: `Stream FAILED for "${eventName}". Media server process is in an error state. Use "Force Restart" in the admin.`,
      bitrateKbps: health.bitrateKbps,
      streamState: health.state,
    };
  }

  // Process is alive but OBS/encoder is not sending (no RTMP signal)
  if (health.state === 'idle' || health.state === 'stopped') {
    return {
      ...base,
      type: 'no_signal',
      severity: 'critical',
      message: `No signal for "${eventName}". OBS is not sending to the media server (state: ${health.state}). Check the encoder.`,
      bitrateKbps: 0,
      streamState: health.state,
    };
  }

  // Encoder is connected but bitrate is dangerously low — stream is degraded
  if (health.state === 'running' && health.bitrateKbps < BITRATE_THRESHOLD_KBPS) {
    return {
      ...base,
      type: 'low_bitrate',
      severity: 'warning',
      message: `Low bitrate for "${eventName}": ${Math.round(health.bitrateKbps)} kbps (threshold: ${BITRATE_THRESHOLD_KBPS} kbps). Stream may be buffering for viewers.`,
      bitrateKbps: health.bitrateKbps,
      streamState: health.state,
    };
  }

  // All good
  return null;
}

/** Skip duplicate WhatsApp pings for the same event + alert type within the cooldown window. */
async function shouldSendWhatsApp(alert: StreamAlert): Promise<boolean> {
  if (!supabaseAdmin) return true;

  const since = new Date(
    Date.now() - WHATSAPP_ALERT_COOLDOWN_MINUTES * 60 * 1000
  ).toISOString();

  const { data, error } = await supabaseAdmin
    .from('stream_alerts')
    .select('id')
    .eq('event_id', alert.eventId)
    .eq('alert_type', alert.type)
    .gte('created_at', since)
    .limit(1);

  if (error) {
    // Table missing or RLS — allow send so ops are not blind
    return true;
  }

  return !data || data.length === 0;
}

/**
 * Deliver an alert via all configured channels.
 * All channels are non-fatal — a delivery failure never blocks the cron run.
 */
async function sendAlert(alert: StreamAlert): Promise<void> {
  const icon = alert.severity === 'critical' ? '🚨' : '⚠️';
  console.warn(`${icon} [StreamHealthMonitor] ${alert.type.toUpperCase()} | ${alert.message}`);

  const phone = process.env.ALERT_WHATSAPP_PHONE?.trim();
  const apiKey = process.env.ALERT_WHATSAPP_APIKEY?.trim();
  const sendWhatsApp =
    phone && apiKey ? await shouldSendWhatsApp(alert) : false;

  // Channel 1: Supabase stream_alerts table (also powers WhatsApp cooldown)
  if (supabaseAdmin) {
    try {
      await supabaseAdmin.from('stream_alerts').insert({
        event_id: alert.eventId,
        slug: alert.slug,
        event_name: alert.eventName,
        alert_type: alert.type,
        severity: alert.severity,
        message: alert.message,
        bitrate_kbps: alert.bitrateKbps,
        stream_state: alert.streamState,
        created_at: alert.checkedAt,
      });
    } catch {
      // Silently skip — table may not exist yet
    }
  }

  // Channel 2: WhatsApp via CallMeBot (free, no SDK, just a GET request)
  // Setup: docs/WHATSAPP_ALERTS_SETUP.md
  if (!phone || !apiKey) {
    return;
  }

  if (!sendWhatsApp) {
    console.log(
      `[StreamHealthMonitor] WhatsApp skipped (cooldown ${WHATSAPP_ALERT_COOLDOWN_MINUTES}m): ${alert.slug} / ${alert.type}`
    );
    return;
  }

  try {
    const text = encodeURIComponent(
      `${icon} Eventcast Alert [${alert.severity.toUpperCase()}]\n\n` +
      `${alert.message}\n\n` +
      `Event: ${alert.eventName}\n` +
      `Slug: ${alert.slug}\n` +
      `Bitrate: ${Math.round(alert.bitrateKbps)} kbps\n` +
      `State: ${alert.streamState}\n\n` +
      `👉 ${ADMIN_PUBLIC_URL}`
    );
    const res = await fetch(
      `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${text}&apikey=${encodeURIComponent(apiKey)}`
    );
    if (!res.ok) {
      console.error('[StreamHealthMonitor] WhatsApp HTTP', res.status, await res.text());
    }
  } catch (err) {
    console.error('[StreamHealthMonitor] WhatsApp alert delivery failed', err);
  }
}

// ─── Main Route Handler ────────────────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    // Security: fail closed — 401 if CRON_SECRET is unset or secret mismatches
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get('secret');
    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!supabaseAdmin) {
      throw new Error('Supabase Admin client not initialized');
    }

    const now = new Date();

    // 1. Fetch all non-completed events that have a slug and a start time defined
    const { data: events, error: fetchError } = await supabaseAdmin
      .from('events')
      .select('id, slug, groom_name, bride_name, celebrant_name, event_type, event_date, timer_target_time')
      .not('slug', 'is', null)
      .neq('youtube_status', 'completed');

    if (fetchError) throw fetchError;

    // 2. Filter down to events whose 12-hour live window is active right now
    const liveWindowEvents = (events ?? []).filter(event => {
      if (!event.event_date) return false;
      // Always parse event times as IST (UTC+05:30). Without the explicit
      // offset, Vercel Edge (UTC) shifts the window by −5h30m, causing the
      // health monitor to skip active streams during ceremony hours.
      const timerTime = event.timer_target_time || '00:00';
      const startTime = new Date(`${event.event_date}T${timerTime}:00+05:30`);
      const endTime = new Date(startTime.getTime() + 12 * 60 * 60 * 1000);
      return now >= startTime && now < endTime;
    });

    if (liveWindowEvents.length === 0) {
      return NextResponse.json({
        success: true,
        checkedAt: now.toISOString(),
        message: 'No active event windows right now. Nothing to monitor.',
        liveEvents: 0,
        alerts: 0,
      });
    }

    // 3. Poll Restreamer health for all live events concurrently
    const restreamer = new RestreamerClient({
      url: process.env.RESTREAMER_URL || 'https://media.eventcast.pro',
      username: process.env.RESTREAMER_USERNAME || 'admin',
      password: process.env.RESTREAMER_PASSWORD,
    });

    const healthResults = await Promise.allSettled(
      liveWindowEvents.map(event => restreamer.getProcessHealth(event.slug))
    );

    // 4. Evaluate each result — send alerts for any unhealthy streams
    const alerts: StreamAlert[] = [];
    const healthySlugs: string[] = [];

    for (let i = 0; i < liveWindowEvents.length; i++) {
      const event = liveWindowEvents[i];
      const result = healthResults[i];
      const health = result.status === 'fulfilled' ? result.value : null;

      let alert = evaluateHealth(event, health);
      if (alert) {
        // ─── AUTO-RECOVERY ACTIONS ───
        try {
          if (alert.type === 'stream_dead') {
            console.log(`[StreamHealthMonitor] Auto-Recovery: Attempting to restart crashed stream process for "${event.slug}"...`);
            const restarted = await restreamer.restartChannel(event.slug);
            if (restarted) {
              alert.message += ` [AUTO-RECOVERED: Channel process restarted successfully]`;
              alert.severity = 'warning'; // Demote to warning since recovery succeeded
            } else {
              alert.message += ` [AUTO-RECOVERY FAILED: Process restart call failed]`;
            }
          } else if (alert.type === 'stream_not_found') {
            console.log(`[StreamHealthMonitor] Auto-Recovery: Re-creating missing process for "${event.slug}"...`);
            // Fetch the youtube stream key from Supabase for recreation
            const { data: dbEvent } = await supabaseAdmin
              .from('events')
              .select('youtube_stream_key')
              .eq('id', event.id)
              .single();

            const youtubeKey = dbEvent?.youtube_stream_key || undefined;
            const setupResult = await restreamer.setupChannel(event.slug, youtubeKey);
            if (setupResult) {
              alert.message += ` [AUTO-RECOVERED: Channel configuration reconstructed successfully]`;
              alert.severity = 'warning'; // Demote to warning
            } else {
              alert.message += ` [AUTO-RECOVERY FAILED: Channel reconstruction failed]`;
            }
          }
        } catch (recoveryErr: any) {
          console.error(`[StreamHealthMonitor] Auto-Recovery failed for ${event.slug}:`, recoveryErr);
          alert.message += ` [AUTO-RECOVERY ERROR: ${recoveryErr.message || String(recoveryErr)}]`;
        }

        alerts.push(alert);
        await sendAlert(alert);
      } else {
        healthySlugs.push(event.slug);
      }
    }

    // 5. Return a full summary — useful for dashboard integration later
    return NextResponse.json({
      success: true,
      checkedAt: now.toISOString(),
      bitrateThresholdKbps: BITRATE_THRESHOLD_KBPS,
      liveEvents: liveWindowEvents.length,
      healthy: healthySlugs.length,
      alertsTriggered: alerts.length,
      details: {
        healthy: healthySlugs,
        alerts,
      },
    });

  } catch (error: any) {
    console.error('[StreamHealthMonitor] Cron job failed:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
