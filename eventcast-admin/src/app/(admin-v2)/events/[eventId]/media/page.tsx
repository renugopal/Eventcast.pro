"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2, Video } from "lucide-react";
import { authFetch } from "@/lib/client-auth";
import { uploadToR2 } from "@/lib/uploadHelpers";
import { fetchEventMedia, updateEventMedia, fetchGuestMemories } from "@/lib/mediaEngagementClient";
import { useEventWorkspace } from "../../../_components/event-workspace/EventWorkspaceShell";

/**
 * Event Workspace Media tab (Media + Engagement Core delivery package).
 * Real Invitation Video and Photo Slideshow management (Baseline CRT-009
 * optional modules, MED-001 event-scoped Media view), built entirely on the
 * new `PATCH /api/events/[eventId]/media` route and the existing
 * `/api/r2-upload` infrastructure. The SEO/social thumbnail keeps living on
 * the Event Page tab (unchanged) — this tab does not duplicate it. Guest
 * Memories are presented here only as a short read-only summary that links
 * to the Engagement tab, where their moderation actually lives.
 */

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; invitationVideoUrl: string | null; slideshowImages: string[] };

export default function EventWorkspaceMediaPage() {
  const { state: workspaceState } = useEventWorkspace();
  const eventId = workspaceState.status === "ready" ? workspaceState.event.id : null;

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [videoUploading, setVideoUploading] = useState(false);
  const [imagesUploading, setImagesUploading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const imagesInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      try {
        const media = await fetchEventMedia(authFetch, eventId);
        if (cancelled) return;
        setState({ status: "ready", invitationVideoUrl: media.invitationVideoUrl, slideshowImages: media.slideshowImages });
      } catch (err) {
        if (cancelled) return;
        setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      }
      try {
        const memories = await fetchGuestMemories(authFetch, eventId);
        if (!cancelled) setMemoryCount(memories.length);
      } catch {
        // Non-fatal for this tab — the count is a convenience summary only.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  async function handleInvitationVideoUpload(files: FileList | null) {
    if (!files || !files.length || !eventId) return;
    setActionError(null);
    setVideoUploading(true);
    try {
      const [url] = await uploadToR2(files, "video");
      if (!url) throw new Error("Upload failed");
      await updateEventMedia(authFetch, eventId, { invitationVideoUrl: url });
      setState((prev) => (prev.status === "ready" ? { ...prev, invitationVideoUrl: url } : prev));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setVideoUploading(false);
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  }

  async function handleRemoveInvitationVideo() {
    if (!eventId) return;
    setActionError(null);
    try {
      await updateEventMedia(authFetch, eventId, { invitationVideoUrl: null });
      setState((prev) => (prev.status === "ready" ? { ...prev, invitationVideoUrl: null } : prev));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSlideshowUpload(files: FileList | null) {
    if (!files || !files.length || !eventId || state.status !== "ready") return;
    setActionError(null);
    setImagesUploading(true);
    try {
      const urls = await uploadToR2(files, "gallery");
      const next = [...state.slideshowImages, ...urls];
      await updateEventMedia(authFetch, eventId, { slideshowImages: next });
      setState({ ...state, slideshowImages: next });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setImagesUploading(false);
      if (imagesInputRef.current) imagesInputRef.current.value = "";
    }
  }

  async function persistSlideshowOrder(next: string[]) {
    if (!eventId) return;
    setState((prev) => (prev.status === "ready" ? { ...prev, slideshowImages: next } : prev));
    try {
      await updateEventMedia(authFetch, eventId, { slideshowImages: next });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  function moveImage(index: number, direction: -1 | 1) {
    if (state.status !== "ready") return;
    const next = [...state.slideshowImages];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    persistSlideshowOrder(next);
  }

  function removeImage(index: number) {
    if (state.status !== "ready") return;
    const next = state.slideshowImages.filter((_, i) => i !== index);
    persistSlideshowOrder(next);
  }

  if (workspaceState.status !== "ready" || !eventId) return null;

  return (
    <div className="flex flex-col gap-4">
      {actionError && (
        <div className="ec-card" style={{ borderColor: "#FECDD3", color: "var(--error)", fontSize: "13px" }}>
          {actionError}
        </div>
      )}

      <div className="ec-card space-y-3">
        <h3 className="ec-section-title flex items-center gap-2">
          <Video size={16} /> Invitation Video
        </h3>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          An optional short video shown on the public event page (Baseline optional module — absence never blocks
          Publish).
        </p>
        {state.status === "loading" && <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Loading…</div>}
        {state.status === "error" && <div style={{ fontSize: "13px", color: "var(--error)" }}>{state.message}</div>}
        {state.status === "ready" && (
          <>
            {state.invitationVideoUrl ? (
              <div className="flex flex-col gap-2">
                <video src={state.invitationVideoUrl} controls style={{ maxWidth: "360px", borderRadius: "8px" }} />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="ec-btn ec-btn-secondary ec-btn-sm"
                    disabled={videoUploading}
                    onClick={() => videoInputRef.current?.click()}
                  >
                    {videoUploading ? "Uploading…" : "Replace video"}
                  </button>
                  <button type="button" className="ec-btn ec-btn-secondary ec-btn-sm" onClick={handleRemoveInvitationVideo}>
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="ec-btn ec-btn-secondary ec-btn-sm"
                disabled={videoUploading}
                onClick={() => videoInputRef.current?.click()}
              >
                {videoUploading ? "Uploading…" : "Upload invitation video"}
              </button>
            )}
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              style={{ display: "none" }}
              onChange={(e) => handleInvitationVideoUpload(e.target.files)}
            />
          </>
        )}
      </div>

      <div className="ec-card space-y-3">
        <h3 className="ec-section-title flex items-center gap-2">
          <ImagePlus size={16} /> Photo Slideshow
        </h3>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          Multiple images shown in the public page's gallery, in the order below. Use the arrows to change the
          display order.
        </p>
        {state.status === "ready" && (
          <>
            {state.slideshowImages.length > 0 ? (
              <div className="flex flex-wrap gap-3">
                {state.slideshowImages.map((url, index) => (
                  <div key={`${url}-${index}`} className="flex flex-col gap-1" style={{ width: "120px" }}>
                    <img src={url} alt={`Slideshow ${index + 1}`} style={{ width: "120px", height: "90px", objectFit: "cover", borderRadius: "6px" }} />
                    <div className="flex gap-1 justify-center">
                      <button
                        type="button"
                        className="ec-btn ec-btn-secondary ec-btn-sm"
                        disabled={index === 0}
                        onClick={() => moveImage(index, -1)}
                        aria-label="Move earlier"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="ec-btn ec-btn-secondary ec-btn-sm"
                        disabled={index === state.slideshowImages.length - 1}
                        onClick={() => moveImage(index, 1)}
                        aria-label="Move later"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="ec-btn ec-btn-secondary ec-btn-sm"
                        onClick={() => removeImage(index)}
                        aria-label="Remove image"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>No slideshow images yet.</div>
            )}
            <button
              type="button"
              className="ec-btn ec-btn-secondary ec-btn-sm"
              disabled={imagesUploading}
              onClick={() => imagesInputRef.current?.click()}
            >
              {imagesUploading ? "Uploading…" : "Add images"}
            </button>
            <input
              ref={imagesInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={(e) => handleSlideshowUpload(e.target.files)}
            />
          </>
        )}
      </div>

      <div className="ec-card space-y-2">
        <h3 className="ec-section-title">Guest Memories</h3>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          {memoryCount === null ? "Loading…" : `${memoryCount} guest memor${memoryCount === 1 ? "y" : "ies"} submitted.`}{" "}
          Moderation (approve, hide, delete, Manual Approval mode) lives on the Engagement tab.
        </p>
      </div>
    </div>
  );
}
