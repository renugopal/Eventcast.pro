"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Calendar, Copy, ExternalLink, Eye, Globe, Image as ImageIcon, Lock, MapPin, Pencil, Users } from "lucide-react";
import { authFetch, AuthError } from "@/lib/client-auth";
import { scheduledStartAtToIstDateTimeLocal, type EventPublicVisibility } from "@/lib/eventContract";
import { uploadToR2 } from "@/lib/uploadHelpers";
import { publicEventUrl } from "@/lib/publicEventUrl";
import { fetchLivestreamStatus } from "@/lib/livestreamClient";
import {
  attachEventCredit,
  createPartner,
  deleteEventCredit,
  fetchEventCredits,
  fetchPartners,
  fetchPublishedCreditsStatus,
  refreshPublishedCredits,
  updateEventCredit,
  type EventCreditRecord,
  type PartnerRecord,
  type PublishedCreditsStatusRecord,
} from "@/lib/partnerCreditClient";
import { DraftEventForm, isDraftEventFormValid, type DraftEventFormValues } from "../../../_components/draft-event/DraftEventForm";
import { PartnerCreditSection, type DisplayCredit } from "../../../_components/draft-event/PartnerCreditSection";
import { useEventWorkspace, type EventWorkspaceEvent } from "../../../_components/event-workspace/EventWorkspaceShell";
import { useAdminAuth } from "../../../_lib/useAdminAuth";

function draftRowToFormValues(event: EventWorkspaceEvent): DraftEventFormValues {
  return {
    groomName: event.groom_name || "",
    brideName: event.bride_name || "",
    scheduledStartAtLocal: event.scheduled_start_at ? scheduledStartAtToIstDateTimeLocal(event.scheduled_start_at) : "",
    venueName: event.venue_name || "",
    venueMapLink: event.venue_map_link || "",
    slug: event.slug || "",
    customTopTitle: event.custom_top_title || "",
    guestPhotoWallEnabled: event.guest_photo_wall_enabled !== false,
  };
}

/**
 * Formats an Asia/Kolkata wall-clock `datetime-local` value (the same shape
 * `DraftEventForm` edits) for display, without going through a browser-local
 * `Date` parse — reuses the same fixed-`+05:30` construction
 * `combineIstDateTimeToScheduledStartAt` uses, purely for a human-readable
 * label in the schedule-change confirm card below.
 */
function formatIstLocal(dateTimeLocal: string): string {
  if (!dateTimeLocal) return "Not set";
  const date = new Date(`${dateTimeLocal}:00+05:30`);
  if (Number.isNaN(date.getTime())) return dateTimeLocal;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "full",
    timeStyle: "short",
  }).format(date);
}

function creditsToDisplay(credits: EventCreditRecord[], partners: PartnerRecord[]): DisplayCredit[] {
  const byId = new Map(partners.map((p) => [p.id, p]));
  return credits.map((c) => ({
    id: c.id,
    partnerId: c.partner_id,
    partnerLabel: byId.get(c.partner_id)?.business_name || "Partner",
    roleLabel: c.role_label,
    isPrimary: c.is_primary,
  }));
}

/**
 * The Event Workspace's Event Page tab. Sources the event row from the
 * shared workspace shell (`useEventWorkspace()`) instead of its own separate
 * fetch — every mutation below (Save, Publish, Visibility switch, Thumbnail
 * assign) calls the shell's shared `reload()` afterward instead of updating
 * only local state, so the shell's header badge and every other tab (e.g.
 * the Live tab's Test-vs-Live label, which reads `page_state` from the same
 * shared context) reflect a Publish/Edit immediately, with no hard browser
 * refresh required (Provider Event Workspace Premium Redesign package — this
 * was a real stale-state bug in the previous per-tab-fetch design).
 *
 * Hosts the already-completed Preview/Publish/Visibility/SEO thumbnail/
 * Partner Credit controls — none of their contracts, APIs, or security model
 * were changed by this package.
 */
export default function AdminV2EventPageTab() {
  const router = useRouter();
  const { studioMemberRole } = useAdminAuth();
  const canManage = studioMemberRole === "owner" || studioMemberRole === "admin";
  const { state, reload } = useEventWorkspace();
  const eventId = state.status === "ready" ? state.event.id : null;

  const [isEditing, setIsEditing] = useState(false);
  const [editValues, setEditValues] = useState<DraftEventFormValues | null>(null);
  // Post-Publish Core Details Editing package: which endpoint/contract this
  // edit session targets. "draft" is the pre-existing Draft-only PATCH path,
  // unchanged. "published" is the new PATCH /api/events/[eventId]/details
  // path, with its own slug-locked form mode and schedule-change confirm
  // step below.
  const [editTarget, setEditTarget] = useState<"draft" | "published" | null>(null);
  const [originalScheduledLocal, setOriginalScheduledLocal] = useState("");
  const [showScheduleConfirm, setShowScheduleConfirm] = useState(false);
  // Fetched once when entering published-edit mode, best-effort — used only
  // to add an informational line to the schedule-change confirm card. `null`
  // means "unknown" (e.g. the fetch failed) and that line is simply omitted
  // rather than guessing.
  const [livestreamEnabled, setLivestreamEnabled] = useState<boolean | null>(null);
  // Public Page Publish (Baseline CRT-012 — page publish only; it does not
  // start a livestream). One call to the controlled Publish endpoint, which
  // performs the credit snapshot + Draft → Published transition atomically.
  const [publishState, setPublishState] = useState<
    { status: "idle" } | { status: "publishing" } | { status: "error"; message: string }
  >({ status: "idle" });
  // No silently pre-selected default (Visibility Foundation Gate) — the
  // provider must consciously pick Public or Unlisted before Publish is
  // enabled.
  const [publishVisibility, setPublishVisibility] = useState<EventPublicVisibility | null>(null);
  // Post-Publish visibility switch (PATCH /api/events/[eventId]/visibility) —
  // entirely separate from the one-shot Publish action above; never touches
  // published_credits or page_state.
  const [visibilityState, setVisibilityState] = useState<
    { status: "idle" } | { status: "saving" } | { status: "error"; message: string }
  >({ status: "idle" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Preview: fetched on demand (not on load) through the authenticated
  // GET /api/events/draft/[eventId]/preview route, then injected into an
  // iframe via srcDoc — a plain <iframe src> can't carry the Bearer token
  // this route (like every other Draft route) requires.
  const [previewState, setPreviewState] = useState<
    { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "ready"; html: string }
  >({ status: "idle" });

  // SEO/social thumbnail (Baseline SEO-001): uploads through the existing
  // authenticated /api/r2-upload ('thumbnail' purpose), then assigns the
  // returned URL via PATCH /api/events/[eventId]/thumbnail.
  const [thumbnailState, setThumbnailState] = useState<
    { status: "idle" } | { status: "uploading" } | { status: "error"; message: string }
  >({ status: "idle" });
  const thumbnailInputRef = useRef<HTMLInputElement>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // Partner Credits (Baseline V2.1 Partner/Event Credit integration UI):
  // kept as separate UI state from the canonical Draft event payload above,
  // loaded from and mutated through the already-completed Partner CRUD and
  // Event Credit APIs only.
  const [partners, setPartners] = useState<PartnerRecord[]>([]);
  const [partnersLoading, setPartnersLoading] = useState(true);
  const [partnersError, setPartnersError] = useState<string | null>(null);
  const [credits, setCredits] = useState<EventCreditRecord[]>([]);
  const [creditsLoading, setCreditsLoading] = useState(true);
  const [creditsError, setCreditsError] = useState<string | null>(null);

  // Post-Publish "Update published credits": whether the frozen
  // `published_credits` snapshot still matches the current editable credits.
  // Both sides are computed by the server (GET .../published-credits); this
  // tab never compares or builds a snapshot itself. Re-fetched after every
  // credit change below and after a successful refresh.
  const [publishedCreditsStatus, setPublishedCreditsStatus] = useState<PublishedCreditsStatusRecord | null>(null);
  const [refreshState, setRefreshState] = useState<
    { status: "idle" } | { status: "refreshing" } | { status: "error"; message: string } | { status: "done" }
  >({ status: "idle" });

  const isPublishedPage = state.status === "ready" && state.event.page_state !== "draft";

  async function reloadPublishedCreditsStatus() {
    if (!eventId) return;
    try {
      setPublishedCreditsStatus(await fetchPublishedCreditsStatus(authFetch, eventId));
    } catch (err) {
      if (err instanceof AuthError) {
        router.push("/login");
        return;
      }
      // Best-effort status: a failed status read leaves the card in its
      // "unknown" state rather than claiming the page is up to date.
      setPublishedCreditsStatus(null);
    }
  }

  async function reloadCredits() {
    if (!eventId) return;
    const list = await fetchEventCredits(authFetch, eventId);
    setCredits(list);
    if (isPublishedPage) {
      await reloadPublishedCreditsStatus();
    }
  }

  async function handleRefreshPublishedCredits() {
    if (!eventId) return;
    setRefreshState({ status: "refreshing" });
    try {
      await refreshPublishedCredits(authFetch, eventId);
      await reloadPublishedCreditsStatus();
      setRefreshState({ status: "done" });
    } catch (err) {
      if (err instanceof AuthError) {
        router.push("/login");
        return;
      }
      setRefreshState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  // Mirrors the AuthError -> /login redirect used by every other handler on
  // this page, so an expired session during a Partner Credit action behaves
  // the same way instead of just showing a raw "session expired" message.
  async function withAuthRedirect<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof AuthError) {
        router.push("/login");
      }
      throw err;
    }
  }

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;

    async function loadPartnersAndCredits() {
      try {
        const [partnerList, creditList] = await Promise.all([fetchPartners(authFetch), fetchEventCredits(authFetch, eventId!)]);
        if (cancelled) return;
        setPartners(partnerList);
        setCredits(creditList);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof AuthError) {
          router.push("/login");
          return;
        }
        setPartnersError(err instanceof Error ? err.message : String(err));
        setCreditsError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) {
          setPartnersLoading(false);
          setCreditsLoading(false);
        }
      }
    }

    loadPartnersAndCredits();
    return () => {
      cancelled = true;
    };
  }, [eventId, router]);

  // The published-credit status only means something once the page is
  // published; it is (re)loaded whenever that becomes true — including right
  // after a Publish on this same tab, since the shell's reload() flips
  // page_state without remounting this component.
  useEffect(() => {
    if (!eventId || !isPublishedPage) return;
    let cancelled = false;
    fetchPublishedCreditsStatus(authFetch, eventId)
      .then((status) => {
        if (!cancelled) setPublishedCreditsStatus(status);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof AuthError) {
          router.push("/login");
          return;
        }
        setPublishedCreditsStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, isPublishedPage, router]);

  if (state.status !== "ready") return null;
  const event = state.event;

  function startDraftEdit() {
    const values = draftRowToFormValues(event);
    setEditValues(values);
    setEditTarget("draft");
    setOriginalScheduledLocal(values.scheduledStartAtLocal);
    setShowScheduleConfirm(false);
    setSubmitError(null);
    setIsEditing(true);
  }

  // Fetches livestream status best-effort, purely to inform the schedule-
  // change confirm card below — never blocks entering edit mode, and a
  // failure just means that one informational line is omitted.
  async function startPublishedEdit() {
    const values = draftRowToFormValues(event);
    setEditValues(values);
    setEditTarget("published");
    setOriginalScheduledLocal(values.scheduledStartAtLocal);
    setShowScheduleConfirm(false);
    setSubmitError(null);
    setLivestreamEnabled(null);
    setIsEditing(true);
    try {
      const { status } = await fetchLivestreamStatus(authFetch, event.id);
      setLivestreamEnabled(status.enabled);
    } catch {
      // Unknown — the confirm card simply omits the livestream-status line.
    }
  }

  function cancelEdit() {
    setSubmitError(null);
    setIsEditing(false);
    setEditValues(null);
    setEditTarget(null);
    setShowScheduleConfirm(false);
    setLivestreamEnabled(null);
  }

  async function performSave() {
    if (!editValues || !editTarget) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const endpoint =
        editTarget === "published" ? `/api/events/${event.id}/details` : `/api/events/draft/${event.id}`;
      // The published-details endpoint rejects any request body that even
      // mentions `slug` (locked after Publish) — build its body explicitly
      // rather than forwarding the full form-values object, which still
      // carries the (unchanged, read-only) slug field for display purposes.
      const body =
        editTarget === "published"
          ? {
              groomName: editValues.groomName,
              brideName: editValues.brideName,
              scheduledStartAtLocal: editValues.scheduledStartAtLocal,
              venueName: editValues.venueName,
              venueMapLink: editValues.venueMapLink,
              customTopTitle: editValues.customTopTitle,
              guestPhotoWallEnabled: editValues.guestPhotoWallEnabled,
            }
          : editValues;
      const res = await authFetch(endpoint, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Update failed");
      }
      cancelEdit();
      reload();
    } catch (err) {
      if (err instanceof AuthError) {
        router.push("/login");
        return;
      }
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  const scheduleWasChanged =
    editTarget === "published" && !!editValues && editValues.scheduledStartAtLocal !== originalScheduledLocal;

  function handleSaveClick() {
    if (scheduleWasChanged && !showScheduleConfirm) {
      setShowScheduleConfirm(true);
      return;
    }
    performSave();
  }

  async function handlePublish() {
    if (!publishVisibility) return;
    setPublishState({ status: "publishing" });
    try {
      const res = await authFetch(`/api/events/${event.id}/publish`, {
        method: "POST",
        body: JSON.stringify({ visibility: publishVisibility }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Publish failed");
      }
      setPublishState({ status: "idle" });
      // Refresh the shared workspace state rather than assuming: the shell
      // header badge, the Live tab's Test-vs-Live label, and this tab's own
      // published-state rendering all key off the same shared event row.
      reload();
    } catch (err) {
      if (err instanceof AuthError) {
        router.push("/login");
        return;
      }
      setPublishState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handleVisibilityChange(next: EventPublicVisibility) {
    setVisibilityState({ status: "saving" });
    try {
      const res = await authFetch(`/api/events/${event.id}/visibility`, {
        method: "PATCH",
        body: JSON.stringify({ visibility: next }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Could not update visibility");
      }
      setVisibilityState({ status: "idle" });
      reload();
    } catch (err) {
      if (err instanceof AuthError) {
        router.push("/login");
        return;
      }
      setVisibilityState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const isDraft = event.page_state === "draft";
  const pageUrl = !isDraft ? publicEventUrl(event.slug) : null;

  async function togglePreview() {
    if (previewState.status === "ready" || previewState.status === "loading") {
      setPreviewState({ status: "idle" });
      return;
    }
    setPreviewState({ status: "loading" });
    try {
      const res = await authFetch(`/api/events/draft/${event.id}/preview`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Could not render this Draft's preview");
      }
      setPreviewState({ status: "ready", html: data.html as string });
    } catch (err) {
      if (err instanceof AuthError) {
        router.push("/login");
        return;
      }
      setPreviewState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handleCopyLink() {
    if (!pageUrl) return;
    try {
      await navigator.clipboard.writeText(pageUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      // Non-fatal — the link is still visible and openable.
    }
  }

  async function handleThumbnailSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file afterward
    if (!file) return;

    setThumbnailState({ status: "uploading" });
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      const [uploadedUrl] = await uploadToR2(dt.files, "thumbnail");
      if (!uploadedUrl) throw new Error("Thumbnail upload failed");

      const res = await authFetch(`/api/events/${event.id}/thumbnail`, {
        method: "PATCH",
        body: JSON.stringify({ thumbnailUrl: uploadedUrl }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Could not assign thumbnail");
      }

      setThumbnailState({ status: "idle" });
      reload();
    } catch (err) {
      if (err instanceof AuthError) {
        router.push("/login");
        return;
      }
      setThumbnailState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  if (isEditing && editValues && editTarget) {
    const canSave = isDraftEventFormValid(editValues, event.template_id || "");
    const isPastSchedule =
      Boolean(editValues.scheduledStartAtLocal) &&
      new Date(`${editValues.scheduledStartAtLocal}:00+05:30`).getTime() < Date.now();

    return (
      <div className="flex flex-col gap-2">
        <div className="ec-section-header">
          <div>
            <h1 className="ec-page-title">{editTarget === "published" ? "Edit event details" : "Edit Draft"}</h1>
          </div>
        </div>

        {editTarget === "published" && (
          <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            Changes appear on the published page within a few minutes. The event link (slug) is locked and cannot be
            changed here.
          </p>
        )}

        <DraftEventForm
          mode={editTarget === "published" ? "published" : "edit"}
          values={editValues}
          onChange={(next) => {
            setEditValues(next);
            // Any further edit forces a fresh review of the confirm card
            // below, rather than letting a stale "From / To" pair be
            // confirmed against a value the provider has since changed again.
            setShowScheduleConfirm(false);
          }}
          templateId={event.template_id || ""}
        />

        {submitError && (
          <div className="ec-card" style={{ borderColor: "#FECDD3", color: "var(--error)" }}>
            {submitError}
          </div>
        )}

        {editTarget === "published" && showScheduleConfirm && (
          <div className="ec-card space-y-3" style={{ borderColor: "#FDE68A" }}>
            <h3 className="ec-section-title flex items-center gap-2">
              <AlertTriangle size={16} style={{ color: "#B45309" }} /> Confirm schedule change
            </h3>
            <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
              <div>
                <strong>From:</strong> {formatIstLocal(originalScheduledLocal)}
              </div>
              <div>
                <strong>To:</strong> {formatIstLocal(editValues.scheduledStartAtLocal)}
              </div>
            </div>
            <ul style={{ fontSize: "13px", color: "var(--text-secondary)", paddingLeft: "18px", margin: 0 }}>
              <li>The countdown and schedule shown on the published page will update to the new time within a few minutes.</li>
              <li>This does not start, stop, or reschedule any livestream.</li>
              {livestreamEnabled === true && (
                <li>A livestream is currently enabled for this event — it is controlled separately from the Live tab and is not affected by this change.</li>
              )}
              {isPastSchedule && <li>The new date and time is already in the past.</li>}
            </ul>
            <div className="flex items-center justify-between">
              <button type="button" className="ec-btn ec-btn-ghost" onClick={() => setShowScheduleConfirm(false)}>
                Back
              </button>
              <button
                type="button"
                className="ec-btn ec-btn-primary"
                disabled={!canSave || isSubmitting}
                onClick={performSave}
              >
                {isSubmitting ? "Saving…" : "Confirm and save"}
              </button>
            </div>
          </div>
        )}

        {!(editTarget === "published" && showScheduleConfirm) && (
          <div className="flex items-center justify-between">
            <button type="button" className="ec-btn ec-btn-ghost" onClick={cancelEdit}>
              Cancel
            </button>
            <button type="button" disabled={!canSave || isSubmitting} className="ec-btn ec-btn-primary" onClick={handleSaveClick}>
              {isSubmitting
                ? "Saving…"
                : scheduleWasChanged
                  ? "Review schedule change"
                  : "Save changes"}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* No duplicate page title here — the shared workspace shell header
          above the tab strip already shows it. This row is actions only. */}
      <div className="flex items-center justify-end gap-3 flex-wrap">
        <button type="button" className="ec-btn ec-btn-secondary" onClick={togglePreview}>
          <Eye size={14} /> {previewState.status === "ready" || previewState.status === "loading" ? "Hide preview" : "Preview"}
        </button>
        {isDraft && canManage && (
          <button type="button" className="ec-btn ec-btn-secondary" onClick={startDraftEdit}>
            <Pencil size={14} /> Edit
          </button>
        )}
        {!isDraft && !event.archived_at && canManage && (
          <button type="button" className="ec-btn ec-btn-secondary" onClick={startPublishedEdit}>
            <Pencil size={14} /> Edit details
          </button>
        )}
      </div>

      {isDraft && (
        <div className="ec-card space-y-3">
          <h3 className="ec-section-title flex items-center gap-2">
            <Globe size={16} /> Publish page
          </h3>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            Choose how this page can be found once published. This does not start a livestream.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
              <input
                type="radio"
                name="publish-visibility"
                checked={publishVisibility === "public"}
                onChange={() => setPublishVisibility("public")}
              />
              <span>
                <strong>Public</strong> — accessible by link and may be indexed/discovered.
              </span>
            </label>
            <label style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
              <input
                type="radio"
                name="publish-visibility"
                checked={publishVisibility === "unlisted"}
                onChange={() => setPublishVisibility("unlisted")}
              />
              <span>
                <strong>Unlisted</strong> — accessible by direct link but should not be indexed.
              </span>
            </label>
          </div>
          <button
            type="button"
            className="ec-btn ec-btn-primary"
            disabled={publishState.status === "publishing" || !publishVisibility}
            onClick={handlePublish}
          >
            <Globe size={14} /> {publishState.status === "publishing" ? "Publishing…" : "Publish page"}
          </button>
        </div>
      )}

      {publishState.status === "error" && (
        <div className="ec-card" style={{ borderColor: "#FECDD3", color: "var(--error)" }}>
          {publishState.message}
        </div>
      )}

      {!isDraft && (
        <div className="ec-card space-y-3" style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          <div>
            This event page is published. Its public Event Credits are frozen as they were at Publish time; later
            Partner edits only reach this page when you use &ldquo;Update published credits&rdquo; below. Publishing
            the page does not start a livestream.
          </div>
          {pageUrl && (
            <div className="flex items-center gap-2 flex-wrap">
              <code style={{ fontSize: "12px", background: "var(--surface-hover)", padding: "4px 8px", borderRadius: "4px" }}>
                {pageUrl}
              </code>
              <button type="button" className="ec-btn ec-btn-secondary ec-btn-sm" onClick={handleCopyLink}>
                <Copy size={12} /> {linkCopied ? "Copied" : "Copy"}
              </button>
              <a href={pageUrl} target="_blank" rel="noopener noreferrer" className="ec-btn ec-btn-secondary ec-btn-sm">
                <ExternalLink size={12} /> Open
              </a>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span>Visibility:</span>
            <span className={`ec-badge ${event.event_visibility === "unlisted" ? "ec-badge-amber" : "ec-badge-scheduled"}`}>
              {event.event_visibility === "unlisted" ? "Unlisted" : "Public"}
            </span>
            <button
              type="button"
              className="ec-btn ec-btn-secondary"
              disabled={visibilityState.status === "saving"}
              onClick={() => handleVisibilityChange(event.event_visibility === "unlisted" ? "public" : "unlisted")}
            >
              {visibilityState.status === "saving"
                ? "Updating…"
                : event.event_visibility === "unlisted"
                  ? "Switch to Public"
                  : "Switch to Unlisted"}
            </button>
          </div>
          {visibilityState.status === "error" && (
            <div style={{ color: "var(--error)" }}>{visibilityState.message}</div>
          )}
          <p>Public — accessible by link and may be indexed/discovered. Unlisted — accessible by direct link but should not be indexed.</p>
        </div>
      )}

      {previewState.status !== "idle" && (
        <div className="ec-card space-y-4">
          <h3 className="ec-section-title flex items-center gap-2">
            <Eye size={16} /> Preview &mdash; {event.template_id}
          </h3>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            Rendered from this Draft through the same canonical template renderer the public event page uses. This
            Draft is not published — nothing here is publicly visible.
          </p>
          {previewState.status === "loading" && (
            <div style={{ textAlign: "center", color: "var(--text-secondary)" }}>Rendering preview…</div>
          )}
          {previewState.status === "error" && (
            <div style={{ borderColor: "#FECDD3", color: "var(--error)" }}>{previewState.message}</div>
          )}
          {previewState.status === "ready" && (
            <iframe
              title="Draft preview"
              srcDoc={previewState.html}
              sandbox="allow-scripts allow-same-origin"
              style={{ width: "100%", height: "80vh", border: "1px solid var(--border-color, #e5e7eb)", borderRadius: "8px" }}
            />
          )}
        </div>
      )}

      <div className="ec-card space-y-4">
        <h3 className="ec-section-title flex items-center gap-2">
          <Users size={16} /> Identity
        </h3>
        <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Event ID: {event.id}</div>
        <div style={{ fontSize: "14px", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>
          Link: {event.slug}
          {!isDraft && (
            <span title="Locked after publishing so shared links keep working" style={{ display: "inline-flex" }}>
              <Lock size={12} />
            </span>
          )}
        </div>
      </div>

      <div className="ec-card space-y-4">
        <h3 className="ec-section-title flex items-center gap-2">
          <Calendar size={16} /> Schedule
        </h3>
        <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>
          {event.scheduled_start_at
            ? new Intl.DateTimeFormat("en-IN", {
                timeZone: "Asia/Kolkata",
                dateStyle: "full",
                timeStyle: "short",
              }).format(new Date(event.scheduled_start_at))
            : "Not set"}
        </div>
      </div>

      <div className="ec-card space-y-4">
        <h3 className="ec-section-title flex items-center gap-2">
          <MapPin size={16} /> Venue &amp; Template
        </h3>
        <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>{event.venue_name || "Not set"}</div>
        <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>
          Template: {event.template_id} {event.template_version ? `(v${event.template_version})` : ""}
        </div>
      </div>

      <div className="ec-card space-y-4">
        <h3 className="ec-section-title flex items-center gap-2">
          <ImageIcon size={16} /> SEO Thumbnail
        </h3>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          Used as this event&rsquo;s social/share preview image (og:image / twitter:image).
        </p>
        {event.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={event.thumbnail_url}
            alt="Current SEO thumbnail"
            style={{ maxWidth: "240px", maxHeight: "160px", borderRadius: "8px", border: "1px solid var(--border-color, #e5e7eb)" }}
          />
        ) : (
          <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>No thumbnail set yet.</div>
        )}
        <div>
          <input
            ref={thumbnailInputRef}
            type="file"
            accept="image/*"
            onChange={handleThumbnailSelect}
            style={{ display: "none" }}
          />
          <button
            type="button"
            className="ec-btn ec-btn-secondary"
            disabled={thumbnailState.status === "uploading"}
            onClick={() => thumbnailInputRef.current?.click()}
          >
            {thumbnailState.status === "uploading" ? "Uploading…" : event.thumbnail_url ? "Replace thumbnail" : "Upload thumbnail"}
          </button>
        </div>
        {thumbnailState.status === "error" && (
          <div style={{ fontSize: "13px", color: "var(--error)" }}>{thumbnailState.message}</div>
        )}
      </div>

      {!isDraft && (
        <div
          className="ec-card space-y-3"
          style={{ borderColor: publishedCreditsStatus?.needsUpdate ? "#FDE68A" : undefined }}
        >
          <h3 className="ec-section-title flex items-center gap-2">
            {publishedCreditsStatus?.needsUpdate ? (
              <AlertTriangle size={16} style={{ color: "#B45309" }} />
            ) : (
              <Users size={16} />
            )}{" "}
            Published credits
          </h3>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            {publishedCreditsStatus === null ? (
              <>
                The published page shows the credits as they were when you published. Adding, editing, or removing
                credits below does <strong>not</strong> change the published page on its own — use{" "}
                <strong>Update published credits</strong> when you want the page to show your current list.
              </>
            ) : publishedCreditsStatus.needsUpdate ? (
              <>
                Your credits have changed since this page was published. The published page still shows the old list
                ({publishedCreditsStatus.frozenCount ?? 0} credit{publishedCreditsStatus.frozenCount === 1 ? "" : "s"});
                your current list has {publishedCreditsStatus.currentCount} credit
                {publishedCreditsStatus.currentCount === 1 ? "" : "s"}. Nothing changes on the page until you update it.
              </>
            ) : (
              <>
                The published page shows your current credits ({publishedCreditsStatus.currentCount} credit
                {publishedCreditsStatus.currentCount === 1 ? "" : "s"}). If you add, edit, or remove credits below, come
                back here to update the page.
              </>
            )}
          </p>
          {event.archived_at ? (
            <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
              This event is archived. Restore it from the Settings tab before updating its published credits.
            </p>
          ) : canManage ? (
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                className={publishedCreditsStatus?.needsUpdate ? "ec-btn ec-btn-primary" : "ec-btn ec-btn-secondary"}
                disabled={refreshState.status === "refreshing" || publishedCreditsStatus?.needsUpdate === false}
                onClick={handleRefreshPublishedCredits}
              >
                <Users size={14} /> {refreshState.status === "refreshing" ? "Updating…" : "Update published credits"}
              </button>
              {refreshState.status === "done" && !publishedCreditsStatus?.needsUpdate && (
                <span style={{ fontSize: "13px", color: "var(--success)" }}>Published page updated.</span>
              )}
            </div>
          ) : null}
          {refreshState.status === "error" && (
            <div style={{ fontSize: "13px", color: "var(--error)" }}>{refreshState.message}</div>
          )}
        </div>
      )}

      {creditsError ? (
        <div className="ec-card" style={{ borderColor: "#FECDD3", color: "var(--error)" }}>
          {creditsError}
        </div>
      ) : (
        <PartnerCreditSection
          partners={partners}
          partnersLoading={partnersLoading}
          partnersError={partnersError}
          credits={creditsLoading ? [] : creditsToDisplay(credits, partners)}
          onCreatePartner={(payload) =>
            withAuthRedirect(async () => {
              const created = await createPartner(authFetch, payload);
              setPartners((prev) => [...prev, created].sort((a, b) => a.business_name.localeCompare(b.business_name)));
              return created;
            })
          }
          onAddCredit={(values) =>
            withAuthRedirect(async () => {
              await attachEventCredit(authFetch, event.id, {
                partnerId: values.partnerId,
                roleLabel: values.roleLabel,
                isPrimary: values.isPrimary,
              });
              await reloadCredits();
            })
          }
          onUpdateCredit={(id, values) =>
            withAuthRedirect(async () => {
              await updateEventCredit(authFetch, event.id, id, values);
              await reloadCredits();
            })
          }
          onRemoveCredit={(id) =>
            withAuthRedirect(async () => {
              await deleteEventCredit(authFetch, event.id, id);
              await reloadCredits();
            })
          }
        />
      )}
    </div>
  );
}
