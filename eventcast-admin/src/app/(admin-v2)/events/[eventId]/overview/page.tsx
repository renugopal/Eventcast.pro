"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Copy, ExternalLink, MapPin } from "lucide-react";
import { authFetch, AuthError } from "@/lib/client-auth";
import { fetchEventMedia } from "@/lib/mediaEngagementClient";
import { fetchEventCredits } from "@/lib/partnerCreditClient";
import { fetchLivestreamStatus } from "@/lib/livestreamClient";
import { deriveEventReadiness, deriveNextAction, countItemsNeedingAttention, type ReadinessItem } from "@/lib/eventReadiness";
import { publicEventUrl } from "@/lib/publicEventUrl";
import { useEventWorkspace } from "../../../_components/event-workspace/EventWorkspaceShell";
import { ReadinessChecklist } from "../../../_components/event-workspace/ReadinessChecklist";
import { NextActionCard } from "../../../_components/event-workspace/NextActionCard";

/**
 * Event Workspace Overview tab (Provider Event Workspace Premium Redesign
 * package). The workspace's "command center" — a provider opening this tab
 * should immediately understand the event's state, what's ready, what needs
 * attention, and the single most useful next click.
 *
 * Deliberately its own small parallel fetch (Media, Event Credits,
 * Livestream status), not something the shared shell fetches on every tab —
 * this data is only actually needed here, so the shell (loaded on every tab)
 * stays lightweight. Each of the three calls reuses an already-completed
 * client helper; no new backend route was added for this tab.
 */

interface SupportingData {
  invitationVideoUrl: string | null;
  slideshowImageCount: number;
  creditCount: number;
  hasPrimaryCredit: boolean;
  livestreamEnabled: boolean | null;
  youtubeWatchUrl: string | null;
}

export default function EventWorkspaceOverviewPage() {
  const router = useRouter();
  const { state, lifecycle } = useEventWorkspace();
  const eventId = state.status === "ready" ? state.event.id : null;

  const [supporting, setSupporting] = useState<SupportingData>({
    invitationVideoUrl: null,
    slideshowImageCount: 0,
    creditCount: 0,
    hasPrimaryCredit: false,
    livestreamEnabled: null,
    youtubeWatchUrl: null,
  });
  const [supportingError, setSupportingError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;

    (async () => {
      try {
        const [media, credits, livestream] = await Promise.all([
          fetchEventMedia(authFetch, eventId),
          fetchEventCredits(authFetch, eventId),
          fetchLivestreamStatus(authFetch, eventId),
        ]);
        if (cancelled) return;
        setSupporting({
          invitationVideoUrl: media.invitationVideoUrl,
          slideshowImageCount: media.slideshowImages.length,
          creditCount: credits.length,
          hasPrimaryCredit: credits.some((c) => c.is_primary),
          livestreamEnabled: livestream.status.enabled,
          youtubeWatchUrl: livestream.youtubeWatchUrl,
        });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof AuthError) {
          router.push("/login");
          return;
        }
        // Non-fatal: the Overview tab's core identity/schedule facts below
        // still render from the already-loaded shared event data even if
        // this supporting fetch fails — only the readiness section degrades.
        setSupportingError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [eventId, router]);

  if (state.status !== "ready" || !lifecycle) return null;
  const { event } = state;

  const readinessItems: ReadinessItem[] = deriveEventReadiness({
    pageState: event.page_state,
    thumbnailUrl: event.thumbnail_url,
    venueMapLink: event.venue_map_link,
    hasInvitationVideo: Boolean(supporting.invitationVideoUrl),
    slideshowImageCount: supporting.slideshowImageCount,
    creditCount: supporting.creditCount,
    hasPrimaryCredit: supporting.hasPrimaryCredit,
    livestreamEnabled: Boolean(supporting.livestreamEnabled),
    youtubeWatchUrl: supporting.youtubeWatchUrl,
  });
  const attentionCount = countItemsNeedingAttention(readinessItems);

  // deriveNextAction ignores livestreamEnabled entirely for the draft/
  // archived branches, so it's always safe to pass the real (possibly still
  // "loading" / null) value straight through.
  const nextAction = deriveNextAction({ lifecycle, livestreamEnabled: supporting.livestreamEnabled });

  const pageUrl = event.page_state === "published" ? publicEventUrl(event.slug) : null;

  async function handleCopyLink() {
    if (!pageUrl) return;
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can fail (permissions, insecure context) — the link
      // is still shown and openable, so this is non-fatal.
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <NextActionCard eventId={event.id} action={nextAction} />

      <div className="ec-card space-y-3">
        <h3 className="ec-section-title flex items-center gap-2">
          <Calendar size={16} /> Event details
        </h3>
        <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>
          {event.scheduled_start_at
            ? new Intl.DateTimeFormat("en-IN", {
                timeZone: "Asia/Kolkata",
                dateStyle: "full",
                timeStyle: "short",
              }).format(new Date(event.scheduled_start_at))
            : "Schedule not set"}
        </div>
        <div style={{ fontSize: "14px", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>
          <MapPin size={14} /> {event.venue_name || "Venue not set"}
        </div>
        <div style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>
          Template: {event.template_id} {event.template_version ? `(v${event.template_version})` : ""}
        </div>

        {pageUrl ? (
          <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: "4px" }}>
            <code style={{ fontSize: "12px", background: "var(--surface-hover)", padding: "4px 8px", borderRadius: "4px" }}>
              {pageUrl}
            </code>
            <button type="button" className="ec-btn ec-btn-secondary ec-btn-sm" onClick={handleCopyLink}>
              <Copy size={12} /> {copied ? "Copied" : "Copy"}
            </button>
            <a href={pageUrl} target="_blank" rel="noopener noreferrer" className="ec-btn ec-btn-secondary ec-btn-sm">
              <ExternalLink size={12} /> Open
            </a>
          </div>
        ) : (
          <p style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>
            {event.page_state === "draft" ? "No public link yet — publish the page first." : "Not published."}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="ec-section-title" style={{ marginBottom: 0 }}>
            Readiness
          </h3>
          {attentionCount > 0 && (
            <span className="ec-status-pill ec-status-pill--required">
              {attentionCount} item{attentionCount === 1 ? "" : "s"} need attention
            </span>
          )}
        </div>
        {supportingError && (
          <p style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
            Some readiness details couldn&rsquo;t load ({supportingError}) — the page details above are still accurate.
          </p>
        )}
        <ReadinessChecklist eventId={event.id} items={readinessItems} />
      </div>
    </div>
  );
}
