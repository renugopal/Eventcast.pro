"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Calendar, Eye, Globe, Image as ImageIcon, MapPin, Pencil, Users } from "lucide-react";
import { authFetch, AuthError } from "@/lib/client-auth";
import { scheduledStartAtToIstDateTimeLocal, type EventPublicVisibility } from "@/lib/eventContract";
import { uploadToR2 } from "@/lib/uploadHelpers";
import {
  attachEventCredit,
  createPartner,
  deleteEventCredit,
  fetchEventCredits,
  fetchPartners,
  updateEventCredit,
  type EventCreditRecord,
  type PartnerRecord,
} from "@/lib/partnerCreditClient";
import { DraftEventForm, type DraftEventFormValues } from "../../../_components/draft-event/DraftEventForm";
import { PartnerCreditSection, type DisplayCredit } from "../../../_components/draft-event/PartnerCreditSection";

interface DraftEventRow {
  id: string;
  event_type: string | null;
  groom_name: string | null;
  bride_name: string | null;
  venue_name: string | null;
  slug: string | null;
  template_id: string | null;
  template_version: string | null;
  scheduled_start_at: string | null;
  page_state: string | null;
  thumbnail_url: string | null;
  event_visibility: string | null;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; event: DraftEventRow };

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
 * The Event Workspace's Event Page tab (V2.1 Milestone G — moved here
 * unchanged from the original Milestone D `/events/[eventId]/overview`
 * route, which is now the lean Overview tab instead). Reopens a Draft by
 * its stable UUID, shows identity/schedule/template/page state, lets the
 * owning studio edit and save it via `PATCH /api/events/draft/[eventId]`,
 * and hosts the already-completed Preview/Publish/Visibility/SEO
 * thumbnail/Partner Credit controls — none of their contracts, APIs, or
 * security model were changed by this move.
 */
export default function AdminV2EventPageTab() {
  const router = useRouter();
  const params = useParams<{ eventId: string }>();
  const eventId = params.eventId;

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [isEditing, setIsEditing] = useState(false);
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
  // Bumped after a successful save to trigger a refetch without duplicating
  // the fetch logic outside the effect that owns it.
  const [reloadToken, setReloadToken] = useState(0);

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

  async function reloadCredits() {
    const list = await fetchEventCredits(authFetch, eventId);
    setCredits(list);
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
    let cancelled = false;

    async function loadPartnersAndCredits() {
      try {
        const [partnerList, creditList] = await Promise.all([fetchPartners(authFetch), fetchEventCredits(authFetch, eventId)]);
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
  }, [eventId, router, reloadToken]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await authFetch(`/api/events/draft/${eventId}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Could not load this event");
        }
        setState({ status: "ready", event: data.event as DraftEventRow });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof AuthError) {
          router.push("/login");
          return;
        }
        setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [eventId, router, reloadToken]);

  async function handleSave(values: DraftEventFormValues) {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const res = await authFetch(`/api/events/draft/${eventId}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Draft update failed");
      }
      setIsEditing(false);
      setReloadToken((n) => n + 1);
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

  async function handlePublish() {
    if (!publishVisibility) return;
    setPublishState({ status: "publishing" });
    try {
      const res = await authFetch(`/api/events/${eventId}/publish`, {
        method: "POST",
        body: JSON.stringify({ visibility: publishVisibility }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Publish failed");
      }
      setPublishState({ status: "idle" });
      // Re-read the row rather than assuming: the published page state comes
      // back from the same update that froze the credit snapshot.
      setReloadToken((n) => n + 1);
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
      const res = await authFetch(`/api/events/${eventId}/visibility`, {
        method: "PATCH",
        body: JSON.stringify({ visibility: next }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Could not update visibility");
      }
      setState((prev) =>
        prev.status === "ready" ? { status: "ready", event: { ...prev.event, event_visibility: data.visibility } } : prev
      );
      setVisibilityState({ status: "idle" });
    } catch (err) {
      if (err instanceof AuthError) {
        router.push("/login");
        return;
      }
      setVisibilityState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  if (state.status === "loading") {
    return (
      <div className="ec-card" style={{ textAlign: "center", color: "var(--text-secondary)" }}>
        Loading event…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="ec-card" style={{ borderColor: "#FECDD3", color: "var(--error)" }}>
        {state.message}
      </div>
    );
  }

  const event = state.event;
  const isDraft = event.page_state === "draft";

  async function togglePreview() {
    if (previewState.status === "ready" || previewState.status === "loading") {
      setPreviewState({ status: "idle" });
      return;
    }
    setPreviewState({ status: "loading" });
    try {
      const res = await authFetch(`/api/events/draft/${eventId}/preview`);
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

      const res = await authFetch(`/api/events/${eventId}/thumbnail`, {
        method: "PATCH",
        body: JSON.stringify({ thumbnailUrl: uploadedUrl }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Could not assign thumbnail");
      }

      setState((prev) =>
        prev.status === "ready" ? { status: "ready", event: { ...prev.event, thumbnail_url: data.thumbnailUrl } } : prev
      );
      setThumbnailState({ status: "idle" });
    } catch (err) {
      if (err instanceof AuthError) {
        router.push("/login");
        return;
      }
      setThumbnailState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  if (isEditing) {
    return (
      <div className="flex flex-col gap-2">
        <div className="ec-section-header">
          <div>
            <h1 className="ec-page-title">Edit Draft</h1>
          </div>
        </div>
        <DraftEventForm
          mode="edit"
          initialValues={{
            groomName: event.groom_name || "",
            brideName: event.bride_name || "",
            scheduledStartAtLocal: event.scheduled_start_at ? scheduledStartAtToIstDateTimeLocal(event.scheduled_start_at) : "",
            venueName: event.venue_name || "",
            slug: event.slug || "",
          }}
          onSubmit={handleSave}
          onCancel={() => {
            setSubmitError(null);
            setIsEditing(false);
          }}
          isSubmitting={isSubmitting}
          submitError={submitError}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="ec-section-header">
        <div>
          <h1 className="ec-page-title">
            {event.groom_name} &amp; {event.bride_name}
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "4px" }}>
            {event.event_type || "Wedding"}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span className={`ec-badge ${isDraft ? "ec-badge-amber" : "ec-badge-scheduled"}`}>
            {isDraft ? "Draft" : event.page_state === "published" ? "Published" : event.page_state}
          </span>
          <button type="button" className="ec-btn ec-btn-secondary" onClick={togglePreview}>
            <Eye size={14} /> {previewState.status === "ready" || previewState.status === "loading" ? "Hide preview" : "Preview"}
          </button>
          {isDraft && (
            <>
              <button type="button" className="ec-btn ec-btn-secondary" onClick={() => setIsEditing(true)}>
                <Pencil size={14} /> Edit
              </button>
            </>
          )}
        </div>
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
            This event page is published. Its public Event Credits are frozen as they were at Publish time, so later
            Partner edits do not change this page. Publishing the page does not start a livestream.
          </div>
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
        <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Link: {event.slug}</div>
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
              await attachEventCredit(authFetch, eventId, {
                partnerId: values.partnerId,
                roleLabel: values.roleLabel,
                isPrimary: values.isPrimary,
              });
              await reloadCredits();
            })
          }
          onUpdateCredit={(id, values) =>
            withAuthRedirect(async () => {
              await updateEventCredit(authFetch, eventId, id, values);
              await reloadCredits();
            })
          }
          onRemoveCredit={(id) =>
            withAuthRedirect(async () => {
              await deleteEventCredit(authFetch, eventId, id);
              await reloadCredits();
            })
          }
        />
      )}
    </div>
  );
}
