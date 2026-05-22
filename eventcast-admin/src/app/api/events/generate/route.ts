import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { RestreamerClient } from '@/lib/restreamer';
import { requireAdmin } from '@/lib/auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

export const runtime = 'edge';

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const studioId = auth.studioId;
  let didDebitOccur = false;
  let eventId: string | undefined;

  try {
    const event = await req.json();
    
    // Prepaid billing check for new events (excluding edits)
    const isNewEvent = !(event.isEditing && event.editingId);
    
    // ─── Fetch subscription tier (needed for billing + photo limit) ───────────
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('plan_tier, status')
      .eq('studio_id', studioId)
      .maybeSingle();

    const tier = sub?.plan_tier || 'free';
    const isSubscribed = (tier === 'pro' || tier === 'agency') && sub?.status === 'active';

    // Photo limit: free_trial → 20, all other plans → 50
    const guestPhotoLimit = tier === 'free_trial' ? 20 : 50;

    if (isNewEvent) {
      if (!isSubscribed) {
        // Must charge prepaid event fee: ₹499 (49900 paise)
        const { data: wallet, error: walletError } = await supabase
          .from('wallet_balances')
          .select('balance_paise')
          .eq('studio_id', studioId)
          .maybeSingle();

        if (walletError || !wallet || wallet.balance_paise < 49900) {
          return NextResponse.json({
            success: false,
            error: 'Insufficient balance: A minimum balance of ₹499.00 is required to generate a new event. Please visit the Billing & Wallet tab to add funds.'
          }, { status: 402 });
        }

        // Deduct balance
        const newBalance = wallet.balance_paise - 49900;
        const { error: debitError } = await supabase
          .from('wallet_balances')
          .update({ balance_paise: newBalance })
          .eq('studio_id', studioId);

        if (debitError) {
          return NextResponse.json({ success: false, error: 'Failed to complete transaction debit' }, { status: 500 });
        }

        didDebitOccur = true;

        // Log the debit transaction
        await supabase
          .from('transactions')
          .insert({
            studio_id: studioId,
            kind: 'debit',
            amount_paise: -49900,
            status: 'completed'
          });
      }
    }

    // 2. Define Paths and Slug
    const groom = event.groom_name || event.groomName || event.celebrant_name || event.celebrantName || 'event';
    const bride = event.bride_name || event.brideName || 'family';
    const type = event.event_type || event.eventType || 'wedding';

    const slug = `${groom.toLowerCase().replace(/\s+/g, '-')}-${bride.toLowerCase().replace(/\s+/g, '-')}-${type.toLowerCase()}`;
    // --- NEW: Database First to get Event ID ---
    eventId = event.editingId as string | undefined;
    const dbPayload = {
      event_type: event.event_type || event.eventType,
      groom_name: event.groom_name || event.groomName,
      bride_name: event.bride_name || event.brideName,
      celebrant_name: event.celebrant_name || event.celebrantName,
      custom_top_title: event.custom_top_title || event.customTopTitle,
      event_date: event.event_date || event.eventDate,
      event_time: event.event_time || event.eventTime,
      timer_target_time: event.timer_target_time || event.timerTargetTime,
      show_timer: event.show_timer ?? event.showTimer ?? true,
      venue_name: event.venue_name || event.venueName,
      venue_map_link: event.venue_map_link || event.venueMapLink,
      invitation_video_url: (() => {
        // Support both single URL and multi-URL (newline separated)
        const raw = event.invitation_video_url || event.invitationVideoUrl || event.invitationVideoUrls || '';
        if (Array.isArray(raw)) return raw[0] || null;
        if (typeof raw === 'string') return raw.split('\n').map((u: string) => u.trim()).filter(Boolean)[0] || null;
        return null;
      })(),
      thumbnail_url: event.thumbnail_url || event.thumbnailUrl,
      privacy_status: event.privacy_status || event.privacyStatus,
      gallery_urls: (() => {
        const raw = event.gallery_urls || event.galleryUrls || [];
        if (Array.isArray(raw)) return raw;
        if (typeof raw === 'string') return raw.split('\n').map((u: string) => u.trim()).filter((u: string) => u);
        return [];
      })(),
      vod_link: event.vod_link || event.vodLink,
      template_id: event.template_id || event.templateId,
      slug: slug,
      photographer_id: event.photographer_id || event.photographerId || null,
      // base_design is optional - ensure column exists in Supabase
      ...(event.base_design || event.baseDesign ? { base_design: event.base_design || event.baseDesign } : {}),
      ...(event.youtube_broadcast_id ? { youtube_broadcast_id: event.youtube_broadcast_id } : {}),
      ...(event.youtube_stream_key ? { youtube_stream_key: event.youtube_stream_key } : {}),
      ...(event.youtube_url ? { youtube_url: event.youtube_url } : {}),
      custom_initials: event.custom_initials || event.customInitials || null,
      hide_loader_photo: event.hide_loader_photo ?? event.hideLoaderPhoto ?? false,
      loader_photo_url: event.loader_photo_url || event.loaderPhotoUrl || null,
      ...(event.notes ? { notes: event.notes } : {}),
      // Guest Photo Wall — limit set once at event creation based on plan tier
      guest_photo_limit: guestPhotoLimit,
      // Restreamer Details for the Table (Server app='/', token='live')
      // OBS: Server URL = rtmp://34.100.142.25/{slug}, Stream Key = live
      studio_id: auth.studioId,
      restreamer_ingest_url: `rtmp://34.100.142.25/${slug}`,
      restreamer_stream_key: 'live'
    };

    if (event.isEditing && event.editingId) {
      const { error: dbError } = await supabase
        .from('events')
        .update({ ...dbPayload, deployment_status: 'deploying', deployment_error: null })
        .eq('id', event.editingId);
      if (dbError) throw new Error("Database Update Error: " + dbError.message);
    } else {
      const { data: dbData, error: dbError } = await supabase
        .from('events')
        .insert([{ ...dbPayload, deployment_status: 'deploying' }])
        .select();
      if (dbError) throw new Error("Database Insert Error: " + dbError.message);
      eventId = dbData[0].id;
    }
    // -------------------------------------------

    // --- NEW: Restreamer Automation ---
    let restreamerData = null;
    try {
      const restreamer = new RestreamerClient({
        url: process.env.RESTREAMER_URL || 'https://media.eventcast.pro',
        username: process.env.RESTREAMER_USERNAME || 'admin',
        password: process.env.RESTREAMER_PASSWORD
      });
      
      const youtubeKey = event.youtube_stream_key || event.youtubeStreamKey;
      restreamerData = await restreamer.setupChannel(slug, youtubeKey);
      
      console.log("Restreamer setup successful:", restreamerData);

      if (restreamerData) {
        await supabase
          .from('events')
          .update({
            restreamer_url: restreamerData.hlsUrl,
            restreamer_hls_url: restreamerData.hlsUrl,
            restreamer_player_url: restreamerData.playerUrl
          })
          .eq('id', eventId);
      }
    } catch (rsError: any) {
      console.error("Restreamer Setup Failed:", rsError);
      // Save the error to the database for debugging — but do NOT fail the whole event
      const errorMsg = "Restreamer Error: " + (rsError.message || String(rsError));
      await supabase.from('events').update({
        notes: errorMsg,
        // Restreamer failure = non-fatal; keep 'deploying' state so user knows it's partial
      }).eq('id', eventId);
      // We don't throw here to ensure the site is still generated even if media server is down
    }

    // ─── Mark deployment as LIVE ──────────────────────────────────────────────
    if (eventId) {
      await supabase.from('events').update({
        deployment_status: 'live',
        deployment_error: null,
        deployed_at: new Date().toISOString(),
      }).eq('id', eventId);
    }
    // ─────────────────────────────────────────────────────────────────────────

    return NextResponse.json({ 
      success: true, 
      url: `https://eventcast.pro/events/${slug}`, 
      slug: slug,
      id: eventId,
      restreamer: restreamerData
    });

  } catch (error: any) {
    console.error("Generator Error:", error);
    
    // Auto-refund on failure if debit occurred
    if (didDebitOccur) {
      try {
        const { data: wallet } = await supabase
          .from('wallet_balances')
          .select('balance_paise')
          .eq('studio_id', studioId)
          .maybeSingle();

        if (wallet) {
          await supabase
            .from('wallet_balances')
            .update({ balance_paise: wallet.balance_paise + 49900 })
            .eq('studio_id', studioId);

          await supabase
            .from('transactions')
            .insert({
              studio_id: studioId,
              kind: 'refund',
              amount_paise: 49900,
              status: 'completed'
            });
        }
      } catch (refundErr) {
        console.error("Critical: Failed to auto-refund on generation crash", refundErr);
      }
    }
    // ─── Mark deployment as FAILED ────────────────────────────────────────────
    if (eventId) {
      try {
        await supabase.from('events').update({
          deployment_status: 'failed',
          deployment_error: error.message,
        }).eq('id', eventId);
      } catch {
        // best-effort: ignore errors here
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
