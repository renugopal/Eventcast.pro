import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { RestreamerClient } from '@/lib/restreamer';
import { generateYoutubeSEO } from '@/lib/youtube-seo';
import { requireAdmin } from '@/lib/auth';
import { getOwnedEventById, isOwnershipError } from '@/lib/ownership';
import { ensureDraftAssignment } from '@/lib/media-agent/assignmentWriter';

interface EditingEventRef {
  id: string;
}

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

    // ─── Ownership check for edits — must happen before any mutation or ──────
    // ─── external side effect. Cross-tenant and nonexistent events return ────
    // ─── the same generic response so resource existence isn't leaked. ───────
    // eventId is set here, once, from the verified DB row — never from the
    // raw client editingId — and is never reassigned from client input again.
    if (!isNewEvent) {
      const ownership = await getOwnedEventById<EditingEventRef>(supabase, event.editingId, studioId, 'id');
      if (isOwnershipError(ownership)) return ownership.error;
      eventId = ownership.event.id;
    }

    // ─── Compute the slug up front so the global collision guard below can ───
    // ─── run before any wallet debit, photographer write, or event mutation. ─
    const groom = event.groom_name || event.groomName || event.celebrant_name || event.celebrantName || 'event';
    const bride = event.bride_name || event.brideName || 'family';
    const type = event.event_type || event.eventType || 'wedding';
    const slug = `${groom.toLowerCase().replace(/\s+/g, '-')}-${bride.toLowerCase().replace(/\s+/g, '-')}-${type.toLowerCase()}`;

    // ─── Global slug-collision guard ──────────────────────────────────────────
    // Events are served at a global (non-studio-scoped) URL, so any other
    // event already using this slug — same studio or a different one — must
    // be rejected. Only the event currently being edited is excluded, using
    // the verified `eventId` from the ownership check above (never the raw
    // client editingId). A brand-new event has no id yet, so no exclusion
    // applies. maybeSingle() is not used here: the schema permits the same
    // slug to exist across multiple studios, so this query can legitimately
    // match more than one row.
    let slugQuery = supabase.from('events').select('id').eq('slug', slug);
    if (eventId) {
      slugQuery = slugQuery.neq('id', eventId);
    }
    const { data: slugMatches, error: slugCheckError } = await slugQuery.limit(1);

    if (slugCheckError) {
      throw new Error("Slug Availability Check Error: " + slugCheckError.message);
    }

    if (slugMatches && slugMatches.length > 0) {
      return NextResponse.json({
        success: false,
        error: 'This event link is already taken. Please adjust the names to generate a unique link.'
      }, { status: 409 });
    }

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

    if (isNewEvent && !auth.isSuperAdmin) {
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

    // --- NEW: Handle Photographer Details ---
    let finalPhotographerId = event.photographer_id || event.photographerId || null;
    const { photographerName, photographerPhone, photographerInsta } = event;
    
    if (photographerName || photographerPhone || photographerInsta) {
      // Find existing photographer for this studio or insert a new one
      const { data: existingPhotographers } = await supabase
        .from('photographers')
        .select('id')
        .eq('studio_id', studioId)
        .ilike('name', photographerName)
        .limit(1);

      const existingId = existingPhotographers?.[0]?.id;

      const { data: pData, error: pError } = await supabase
        .from('photographers')
        .upsert({
          ...(existingId ? { id: existingId } : {}),
          studio_id: studioId,
          name: photographerName || null,
          phone_number: photographerPhone || null,
          instagram_url: photographerInsta || null,
          studio_name: photographerName || null // Fallback
        })
        .select()
        .single();
        
      if (!pError && pData) {
        finalPhotographerId = pData.id;
      }
    }

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
      photographer_id: finalPhotographerId,
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
      restreamer_ingest_url: `rtmp://34.100.142.25/${slug}`,
      restreamer_stream_key: 'live',
      // studio_id is only ever set on creation. Edits must never accept or
      // rewrite it — the event's existing ownership is always preserved.
      ...(isNewEvent ? { studio_id: studioId } : {}),
    };

    if (event.isEditing && event.editingId) {
      const { error: dbError } = await supabase
        .from('events')
        .update({ ...dbPayload, deployment_status: 'deploying', deployment_error: null })
        .eq('id', eventId);
      if (dbError) throw new Error("Database Update Error: " + dbError.message);

      // --- Update YouTube Broadcast if it exists ---
      if (event.youtube_broadcast_id) {
        try {
          const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            body: new URLSearchParams({
              client_id: process.env.GOOGLE_CLIENT_ID!,
              client_secret: process.env.GOOGLE_CLIENT_SECRET!,
              refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
              grant_type: "refresh_token",
            }),
          });
          if (tokenRes.ok) {
            const tokenData = await tokenRes.json();
            const accessToken = tokenData.access_token;
            if (accessToken) {
              const { title, description, tags } = generateYoutubeSEO({
                groomName: dbPayload.groom_name,
                brideName: dbPayload.bride_name,
                eventType: dbPayload.event_type
              });

              const snippet = {
                title,
                description,
                categoryId: '22',
                tags,
                scheduledStartTime: new Date(`${dbPayload.event_date}T${dbPayload.event_time || '09:00'}:00+05:30`).toISOString()
              };

              const updateRes = await fetch("https://youtube.googleapis.com/youtube/v3/liveBroadcasts?part=snippet", {
                method: "PUT",
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ id: event.youtube_broadcast_id, snippet }),
              });

              if (!updateRes.ok) {
                const data = await updateRes.json();
                console.error("YouTube Broadcast Update Error:", data);
              }
            }
          }
        } catch (ytError) {
          console.error("Failed to update YouTube Broadcast:", ytError);
        }
      }
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

    // --- NEW: Media Agent draft assignment (Slice 3) ---
    // Ensures a media_event_assignments row exists for this event. Disabled,
    // stub-only (event_id set, nothing else) — non-fatal by design, exactly
    // like the Restreamer block above: a failure here must never block
    // event creation/edit, and this never affects the HTTP response shape.
    if (eventId) {
      try {
        await ensureDraftAssignment(supabase, eventId);
      } catch (assignmentError: any) {
        console.error("Media Agent draft assignment failed:", assignmentError);
        // Non-fatal: do not throw, do not alter the response.
      }
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
