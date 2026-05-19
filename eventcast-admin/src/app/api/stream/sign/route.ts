import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { generateSignedStreamUrl } from '@/lib/security';

export const runtime = 'edge';

/**
 * 🛡️ EVENTCAST PRO - SIGNED HLS STREAM API
 * 
 * This endpoint is called by the frontend video player (Hls.js) every few minutes.
 * It returns a fresh, cryptographically signed URL valid for 5 minutes.
 * 
 * GET /api/stream/sign?slug=raj-priya-wedding
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get('slug');

    if (!slug) {
      return NextResponse.json({ error: 'Stream slug is required' }, { status: 400 });
    }

    if (!supabaseAdmin) {
      throw new Error('Supabase Admin client not initialized');
    }

    // 1. Verify that the event actually exists and is not hidden/disabled
    const { data: event, error } = await supabaseAdmin
      .from('events')
      .select('id, privacy_status')
      .eq('slug', slug)
      .single();

    if (error || !event) {
      return NextResponse.json({ error: 'Stream not found' }, { status: 404 });
    }

    // 2. Generate a secure signed URL valid for 5 minutes (300 seconds)
    // The player must request a new URL before this expires!
    const signedUrl = generateSignedStreamUrl(slug, 300);

    return NextResponse.json({
      success: true,
      url: signedUrl,
      expiresIn: 300
    });

  } catch (err: any) {
    console.error('Stream Signing API Error:', err);
    return NextResponse.json({ error: 'Failed to sign stream' }, { status: 500 });
  }
}
