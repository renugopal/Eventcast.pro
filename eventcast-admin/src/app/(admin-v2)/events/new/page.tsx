"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Globe, Lock, Sparkles } from "lucide-react";
import { authFetch, AuthError } from "@/lib/client-auth";
import { getTemplateFieldSupport, listCreatableTemplates } from "@/lib/templateModules";
import { CANONICAL_TEMPLATES, type EventPublicVisibility } from "@/lib/eventContract";
import {
  attachQueuedCreditsSequentially,
  createPartner,
  fetchPartners,
  type PartnerRecord,
  type QueuedCredit,
} from "@/lib/partnerCreditClient";
import { DraftEventForm, isDraftEventFormValid, type DraftEventFormValues } from "../../_components/draft-event/DraftEventForm";
import { PartnerCreditSection, type DisplayCredit } from "../../_components/draft-event/PartnerCreditSection";
import { EventMediaAttachSection, type MediaAttachValue } from "../../_components/draft-event/EventMediaAttachSection";
import { EventSeoAttachSection } from "../../_components/draft-event/EventSeoAttachSection";
import { EventLivestreamAttachSection } from "../../_components/draft-event/EventLivestreamAttachSection";
import { EventEngagementAttachSection } from "../../_components/draft-event/EventEngagementAttachSection";
import { EventSummaryRail } from "../../_components/draft-event/EventSummaryRail";

const EMPTY_VALUES: DraftEventFormValues = {
  groomName: "",
  brideName: "",
  scheduledStartAtLocal: "",
  venueName: "",
  venueMapLink: "",
  slug: "",
  customTopTitle: "",
  guestPhotoWallEnabled: true,
};

const EMPTY_MEDIA: MediaAttachValue = { invitationVideoUrl: null, slideshowImages: [] };

// Fail-closed: no silent fallback to any one template id. Empty when no
// template is currently available for creating new events (see
// `templateModules.ts`'s `CREATABLE_TEMPLATE_IDS`).
const INITIAL_TEMPLATE_ID = listCreatableTemplates()[0]?.templateId ?? "";

function queuedToDisplay(credits: QueuedCredit[]): DisplayCredit[] {
  return credits.map((c) => ({
    id: c.tempId,
    partnerId: c.partnerId,
    partnerLabel: c.partnerLabel,
    roleLabel: c.roleLabel,
    isPrimary: c.isPrimary,
  }));
}

async function parseRouteResult(res: Response): Promise<{ ok: boolean; error?: string }> {
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.success === false) {
    return { ok: false, error: (data && typeof data.error === "string" && data.error) || `Request failed (${res.status})` };
  }
  return { ok: true };
}

/**
 * The single comprehensive Create Event form (Create Event redesign). Posts
 * to `/api/events/draft` — never `/api/events/generate` — so creating a
 * Draft can never trigger billing, YouTube, media upload, SRS, Media Agent
 * activation, Restreamer, or public publishing. Every optional module
 * (Media, SEO thumbnail, Livestream YouTube link, Guest Memories manual
 * approval, Partner Credits) is staged locally and attached to the Draft
 * only *after* it exists, through the exact same per-field routes the Event
 * Workspace tabs already use post-creation — no new backend surface. A
 * failure in any one attachment never rolls back the Draft or blocks the
 * others; "Create Event" additionally requires a Public/Unlisted choice and
 * only calls the existing controlled Publish action once every requested
 * attachment has succeeded.
 */
export default function AdminV2NewEventPage() {
  const router = useRouter();
  const [values, setValues] = useState<DraftEventFormValues>(EMPTY_VALUES);
  const [templateId, setTemplateId] = useState(INITIAL_TEMPLATE_ID);
  const support = getTemplateFieldSupport(templateId);

  const [media, setMedia] = useState<MediaAttachValue>(EMPTY_MEDIA);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [manualApprovalEnabled, setManualApprovalEnabled] = useState(false);
  const [visibility, setVisibility] = useState<EventPublicVisibility | null>(null);

  const [partners, setPartners] = useState<PartnerRecord[]>([]);
  const [partnersLoading, setPartnersLoading] = useState(true);
  const [partnersError, setPartnersError] = useState<string | null>(null);
  const [queuedCredits, setQueuedCredits] = useState<QueuedCredit[]>([]);

  const [submitting, setSubmitting] = useState<"draft" | "publish" | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Set only when the Draft was created but one or more optional attachments
  // failed — the Draft itself is never rolled back, so this stays visible
  // with a link into the created Event instead of navigating away.
  const [partialSuccess, setPartialSuccess] = useState<{ eventId: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await fetchPartners(authFetch);
        if (!cancelled) setPartners(list);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof AuthError) {
          router.push("/login");
          return;
        }
        setPartnersError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setPartnersLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const canSaveDraft = isDraftEventFormValid(values, templateId);
  const canCreateEvent = canSaveDraft && visibility !== null;

  // Purely a display restatement of the same checks isDraftEventFormValid
  // already gates Save Draft on — not a new/parallel validation rule.
  const templateReady = Boolean(CANONICAL_TEMPLATES[templateId]);
  const coupleReady = Boolean(values.groomName.trim() && values.brideName.trim());
  const scheduleReady = Boolean(values.scheduledStartAtLocal);
  const venueReady = Boolean(values.venueName.trim() && values.slug.trim());
  const requiredReadyCount = [templateReady, coupleReady, scheduleReady, venueReady].filter(Boolean).length;
  const requiredTotal = 4;
  const progressPercent = Math.round((requiredReadyCount / requiredTotal) * 100);
  const templateLabel = CANONICAL_TEMPLATES[templateId]?.templateId ?? null;

  async function runCreateFlow(action: "draft" | "publish") {
    if (!isDraftEventFormValid(values, templateId)) return;
    if (action === "publish" && !visibility) return;

    setSubmitting(action);
    setSubmitError(null);
    setPartialSuccess(null);
    try {
      const res = await authFetch("/api/events/draft", {
        method: "POST",
        body: JSON.stringify({ eventType: "Wedding", templateId, ...values }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Draft creation failed");
      }
      const eventId = data.id as string;

      const failures: string[] = [];

      // Every step below runs after the Draft already exists. Each is
      // wrapped locally so a thrown error (an expired session, a dropped
      // connection) becomes a failure entry instead of escaping to the
      // outer catch — which would otherwise redirect to /login or show a
      // generic error with no link back to the Draft that was already
      // created, silently orphaning it from the provider's perspective.
      async function tryAttach(label: string, run: () => Promise<void>) {
        try {
          await run();
        } catch (err) {
          failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (support.media && (media.invitationVideoUrl || media.slideshowImages.length > 0)) {
        await tryAttach("Media", async () => {
          const r = await authFetch(`/api/events/${eventId}/media`, {
            method: "PATCH",
            body: JSON.stringify({ invitationVideoUrl: media.invitationVideoUrl, slideshowImages: media.slideshowImages }),
          });
          const result = await parseRouteResult(r);
          if (!result.ok) throw new Error(result.error);
        });
      }

      if (support.seoThumbnail && thumbnailUrl) {
        await tryAttach("SEO thumbnail", async () => {
          const r = await authFetch(`/api/events/${eventId}/thumbnail`, {
            method: "PATCH",
            body: JSON.stringify({ thumbnailUrl }),
          });
          const result = await parseRouteResult(r);
          if (!result.ok) throw new Error(result.error);
        });
      }

      if (support.livestreamYoutubeLink && youtubeUrl.trim()) {
        await tryAttach("Livestream YouTube link", async () => {
          const r = await authFetch(`/api/events/${eventId}/livestream/youtube`, {
            method: "PATCH",
            body: JSON.stringify({ youtubeUrl: youtubeUrl.trim() }),
          });
          const result = await parseRouteResult(r);
          if (!result.ok) throw new Error(result.error);
        });
      }

      if (support.guestEngagement && manualApprovalEnabled) {
        await tryAttach("Guest Memories", async () => {
          const r = await authFetch(`/api/events/${eventId}/guest-memories/settings`, {
            method: "PATCH",
            body: JSON.stringify({ manualApprovalEnabled: true }),
          });
          const result = await parseRouteResult(r);
          if (!result.ok) throw new Error(result.error);
        });
      }

      if (support.partnerCredits && queuedCredits.length > 0) {
        await tryAttach("Partner credits", async () => {
          const { failures: creditFailures } = await attachQueuedCreditsSequentially(authFetch, eventId, queuedCredits);
          if (creditFailures.length > 0) {
            throw new Error(creditFailures.map((f) => `${f.credit.partnerLabel} (${f.error})`).join("; "));
          }
        });
      }

      if (action === "draft") {
        if (failures.length > 0) {
          setPartialSuccess({ eventId, message: `Draft saved, but some details could not be attached: ${failures.join("; ")}` });
          return;
        }
        router.push(`/events/${eventId}/event-page`);
        return;
      }

      // action === "publish"
      if (failures.length > 0) {
        setPartialSuccess({
          eventId,
          message: `Event created, but some details could not be saved: ${failures.join(
            "; "
          )}. The page was not published — finish and publish it from the Event page.`,
        });
        return;
      }

      try {
        const publishRes = await authFetch(`/api/events/${eventId}/publish`, {
          method: "POST",
          body: JSON.stringify({ visibility }),
        });
        const publishResult = await parseRouteResult(publishRes);
        if (!publishResult.ok) throw new Error(publishResult.error);
      } catch (err) {
        setPartialSuccess({
          eventId,
          message: `Event created and configured, but publishing failed: ${
            err instanceof Error ? err.message : String(err)
          }. You can publish it from the Event page.`,
        });
        return;
      }

      router.push(`/events/${eventId}/event-page`);
    } catch (err) {
      if (err instanceof AuthError) {
        router.push("/login");
        return;
      }
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="ec-create-event-page flex flex-col gap-6">
      <div className="ec-create-event-header">
        <div>
          <h1 className="ec-page-title">Create Event</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "4px" }}>
            Build and publish your event page. Nothing is billed or streamed by this form.
          </p>
        </div>
        <div className="ec-progress-chip">
          <span className="ec-progress-chip-ring" style={{ "--ec-progress": progressPercent } as React.CSSProperties} />
          <span className="ec-progress-chip-label">
            {requiredReadyCount} of {requiredTotal}
            <small>required sections ready</small>
          </span>
        </div>
      </div>

      {/* Mobile-only compact recap — hidden at the same 1024px breakpoint the two-column CSS grid switches on. */}
      <details className="ec-accordion lg:hidden">
        <summary>
          <div className="ec-section-card-heading">
            <span className="ec-section-icon-chip">
              <Sparkles size={16} />
            </span>
            <div>
              <div className="ec-section-card-title">Event Summary</div>
              <div className="ec-section-card-sub">Quick recap of what you&rsquo;ve entered</div>
            </div>
          </div>
          <ChevronDown size={18} className="ec-accordion-chevron" />
        </summary>
        <div className="ec-accordion-body">
          <EventSummaryRail
            templateId={templateId}
            templateLabel={templateLabel}
            values={values}
            visibility={visibility}
            creditCount={queuedCredits.length}
          />
        </div>
      </details>

      <div className="ec-create-event-layout">
        <div className="ec-create-event-main">
          {partialSuccess && (
            <div className="ec-card" style={{ borderColor: "#FDE68A", color: "var(--text-primary, inherit)" }}>
              <p style={{ fontSize: "14px" }}>{partialSuccess.message}</p>
            </div>
          )}

          <DraftEventForm mode="create" values={values} onChange={setValues} templateId={templateId} onTemplateChange={setTemplateId} />

          {support.media && <EventMediaAttachSection value={media} onChange={setMedia} />}
          {support.seoThumbnail && <EventSeoAttachSection value={thumbnailUrl} onChange={setThumbnailUrl} />}
          {support.livestreamYoutubeLink && <EventLivestreamAttachSection value={youtubeUrl} onChange={setYoutubeUrl} />}
          {support.guestEngagement && (
            <EventEngagementAttachSection value={manualApprovalEnabled} onChange={setManualApprovalEnabled} />
          )}

          {support.partnerCredits && (
            <PartnerCreditSection
              partners={partners}
              partnersLoading={partnersLoading}
              partnersError={partnersError}
              credits={queuedToDisplay(queuedCredits)}
              onCreatePartner={async (payload) => {
                try {
                  const created = await createPartner(authFetch, payload);
                  setPartners((prev) => [...prev, created].sort((a, b) => a.business_name.localeCompare(b.business_name)));
                  return created;
                } catch (err) {
                  if (err instanceof AuthError) {
                    router.push("/login");
                  }
                  throw err;
                }
              }}
              onAddCredit={async (values) => {
                if (values.isPrimary && queuedCredits.some((c) => c.isPrimary)) {
                  throw new Error("Only one credit can be marked primary. Remove the existing primary credit first.");
                }
                setQueuedCredits((prev) => [
                  ...prev,
                  {
                    tempId: `${values.partnerId}:${values.roleLabel}:${Date.now()}`,
                    partnerId: values.partnerId,
                    partnerLabel: values.partnerLabel,
                    roleLabel: values.roleLabel,
                    isPrimary: values.isPrimary,
                  },
                ]);
              }}
              onUpdateCredit={async (id, values) => {
                if (values.isPrimary && queuedCredits.some((c) => c.tempId !== id && c.isPrimary)) {
                  throw new Error("Only one credit can be marked primary. Remove the existing primary credit first.");
                }
                setQueuedCredits((prev) => prev.map((c) => (c.tempId === id ? { ...c, ...values } : c)));
              }}
              onRemoveCredit={async (id) => {
                setQueuedCredits((prev) => prev.filter((c) => c.tempId !== id));
              }}
            />
          )}

          <div className="ec-section-card space-y-3">
            <div className="ec-section-card-head">
              <div className="ec-section-card-heading">
                <span className="ec-section-icon-chip">
                  <Globe size={16} />
                </span>
                <div>
                  <div className="ec-section-card-title">Visibility &amp; Publishing</div>
                  <div className="ec-section-card-sub">Choose how the page can be found if you Create Event now</div>
                </div>
              </div>
              <span className={`ec-status-pill ${visibility ? "ec-status-pill--complete" : "ec-status-pill--required"}`}>
                {visibility ? "Complete" : "Required to publish"}
              </span>
            </div>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
              Save Draft instead to decide this later. This never starts a livestream.
            </p>
            <div className="ec-visibility-grid" aria-label="Page visibility">
              <button
                type="button"
                aria-pressed={visibility === "public"}
                className={`ec-visibility-card${visibility === "public" ? " selected" : ""}`}
                onClick={() => setVisibility("public")}
              >
                <Globe size={18} style={{ color: "var(--primary)", flexShrink: 0, marginTop: "2px" }} />
                <span>
                  <span className="ec-visibility-card-title">Public</span>
                  <span className="ec-visibility-card-desc">Accessible by link and may be indexed/discovered.</span>
                </span>
              </button>
              <button
                type="button"
                aria-pressed={visibility === "unlisted"}
                className={`ec-visibility-card${visibility === "unlisted" ? " selected" : ""}`}
                onClick={() => setVisibility("unlisted")}
              >
                <Lock size={18} style={{ color: "var(--primary)", flexShrink: 0, marginTop: "2px" }} />
                <span>
                  <span className="ec-visibility-card-title">Unlisted</span>
                  <span className="ec-visibility-card-desc">Accessible by direct link but should not be indexed.</span>
                </span>
              </button>
            </div>
          </div>

          {submitError && (
            <div className="ec-card" style={{ borderColor: "#FECDD3", color: "var(--error)" }}>
              {submitError}
            </div>
          )}
        </div>

        {/* Desktop-only sticky rail — hidden below 1024px, where the mobile <details> recap above takes over. */}
        <div className="hidden lg:block">
          <EventSummaryRail
            templateId={templateId}
            templateLabel={templateLabel}
            values={values}
            visibility={visibility}
            creditCount={queuedCredits.length}
          />
        </div>
      </div>

      {partialSuccess ? (
        <div className="ec-create-event-actions flex items-center justify-between gap-3 flex-wrap">
          <button type="button" onClick={() => router.push("/events")} className="ec-btn ec-btn-ghost">
            Back to Events
          </button>
          <button
            type="button"
            className="ec-btn ec-btn-primary"
            onClick={() => router.push(`/events/${partialSuccess.eventId}/event-page`)}
          >
            Open Event Page
          </button>
        </div>
      ) : (
        <div className="ec-create-event-actions flex items-center justify-between gap-3 flex-wrap">
          <button type="button" onClick={() => router.push("/events")} className="ec-btn ec-btn-ghost">
            Cancel
          </button>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              className="ec-btn ec-btn-secondary"
              disabled={!canSaveDraft || submitting !== null}
              onClick={() => runCreateFlow("draft")}
            >
              {submitting === "draft" ? "Saving…" : "Save Draft"}
            </button>
            <button
              type="button"
              className="ec-btn ec-btn-primary"
              disabled={!canCreateEvent || submitting !== null}
              onClick={() => runCreateFlow("publish")}
            >
              {submitting === "publish" ? "Creating…" : "Create Event"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
