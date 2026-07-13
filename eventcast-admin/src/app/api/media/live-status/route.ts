import { NextResponse } from 'next/server';
import { RestreamerClient } from '@/lib/restreamer';
import { requireAdmin } from '@/lib/auth';
import { supabase, supabaseAdmin } from '@/lib/supabase';

export const runtime = 'edge';

interface OwnedEventRef {
  id: string;
  slug: string;
}

interface RestreamerProcessRef {
  id?: unknown;
  state?: unknown;
  config?: unknown;
}

interface LiveProcessDto {
  id: string;
  eventId: string;
  state: string;
  bitrateKbps: number;
  fps: number;
  runtime_seconds: number;
  youtubeEnabled: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function processState(process: RestreamerProcessRef): string {
  if (typeof process.state === 'string') return process.state;
  if (isRecord(process.state) && typeof process.state.exec === 'string') {
    return process.state.exec;
  }
  return 'unknown';
}

function hasYoutubeOutput(process: RestreamerProcessRef): boolean {
  if (!isRecord(process.config) || !Array.isArray(process.config.output)) {
    return false;
  }

  return process.config.output.some(
    (output) => isRecord(output) && output.id === 'youtube'
  );
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const db = supabaseAdmin ?? supabase;
    const { data: ownedEvents, error: ownedEventsError } = await db
      .from('events')
      .select('id, slug')
      .eq('studio_id', auth.studioId);

    if (ownedEventsError) {
      throw new Error(`Failed to load studio events: ${ownedEventsError.message}`);
    }

    const eventBySlug = new Map<string, OwnedEventRef>();
    for (const event of (ownedEvents ?? []) as OwnedEventRef[]) {
      if (event.id && event.slug) eventBySlug.set(event.slug, event);
    }

    if (eventBySlug.size === 0) {
      return NextResponse.json({ success: true, activeProcesses: [] });
    }

    const restreamer = new RestreamerClient({
      url: process.env.RESTREAMER_URL || 'https://media.eventcast.pro',
      username: process.env.RESTREAMER_USERNAME || 'admin',
      password: process.env.RESTREAMER_PASSWORD
    });

    const allProcesses: unknown = await restreamer.getAllProcesses();
    const ownedProcesses = (Array.isArray(allProcesses) ? allProcesses : [])
      .filter((process): process is RestreamerProcessRef => {
        return isRecord(process) && typeof process.id === 'string' && eventBySlug.has(process.id);
      });

    const activeProcesses: LiveProcessDto[] = await Promise.all(
      ownedProcesses.map(async (process) => {
        const slug = process.id as string;
        const event = eventBySlug.get(slug)!;
        const health = await restreamer.getProcessHealth(slug);

        return {
          id: slug,
          eventId: event.id,
          state: health?.state ?? processState(process),
          bitrateKbps: health?.bitrateKbps ?? 0,
          fps: health?.fps ?? 0,
          runtime_seconds: health?.runtimeSeconds ?? 0,
          youtubeEnabled: hasYoutubeOutput(process),
        };
      })
    );

    return NextResponse.json({ success: true, activeProcesses });
  } catch (err: unknown) {
    console.error('Fetch Live Status Error:', err);
    return NextResponse.json({ error: 'Failed to fetch live status' }, { status: 500 });
  }
}
