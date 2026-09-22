"use client";

import { useEffect, useState } from "react";
import { MessageCircleHeart, Pin, Trash2 } from "lucide-react";
import { authFetch } from "@/lib/client-auth";
import {
  fetchGuestMemories,
  fetchGuestMemoriesSettings,
  updateGuestMemoriesSettings,
  setGuestMemoryApproved,
  deleteGuestMemory,
  fetchWishes,
  updateWish,
  deleteWish,
  type GuestMemoryRecord,
  type WishRecord,
  type WishStatus,
} from "@/lib/mediaEngagementClient";
import { useEventWorkspace } from "../../../_components/event-workspace/EventWorkspaceShell";

/**
 * Event Workspace Engagement tab (Media + Engagement Core delivery
 * package). Real Guest Memories moderation (GM-004/GM-005: Manual Approval
 * toggle, approve/hide/delete) and Wishes moderation (WISH-002:
 * approve/pin/hide/reject/delete), built entirely on the new
 * event-scoped moderation routes. No submission or moderation data is
 * fabricated — every count and row shown here comes from a real query.
 */

export default function EventWorkspaceEngagementPage() {
  const { state: workspaceState } = useEventWorkspace();
  const eventId = workspaceState.status === "ready" ? workspaceState.event.id : null;

  const [memories, setMemories] = useState<GuestMemoryRecord[] | null>(null);
  const [manualApproval, setManualApproval] = useState<boolean | null>(null);
  const [wishes, setWishes] = useState<WishRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reloadMemories() {
    if (!eventId) return;
    try {
      const [list, settings] = await Promise.all([
        fetchGuestMemories(authFetch, eventId),
        fetchGuestMemoriesSettings(authFetch, eventId),
      ]);
      setMemories(list);
      setManualApproval(settings.manualApprovalEnabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function reloadWishes() {
    if (!eventId) return;
    try {
      setWishes(await fetchWishes(authFetch, eventId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    reloadMemories();
    reloadWishes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function handleToggleManualApproval() {
    if (!eventId || manualApproval === null) return;
    const next = !manualApproval;
    setManualApproval(next);
    try {
      await updateGuestMemoriesSettings(authFetch, eventId, next);
    } catch (err) {
      setManualApproval(!next);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleMemoryApprove(photoId: string, approved: boolean) {
    if (!eventId) return;
    try {
      await setGuestMemoryApproved(authFetch, eventId, photoId, approved);
      reloadMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleMemoryDelete(photoId: string) {
    if (!eventId) return;
    try {
      await deleteGuestMemory(authFetch, eventId, photoId);
      reloadMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleWishStatus(wishId: string, status: WishStatus) {
    if (!eventId) return;
    try {
      await updateWish(authFetch, eventId, wishId, { status });
      reloadWishes();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleWishPin(wishId: string, isPinned: boolean) {
    if (!eventId) return;
    try {
      await updateWish(authFetch, eventId, wishId, { isPinned });
      reloadWishes();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleWishDelete(wishId: string) {
    if (!eventId) return;
    try {
      await deleteWish(authFetch, eventId, wishId);
      reloadWishes();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (workspaceState.status !== "ready" || !eventId) return null;

  const pending = (memories ?? []).filter((m) => !m.approved);
  const approved = (memories ?? []).filter((m) => m.approved);

  return (
    <div className="flex flex-col gap-4">
      {error && <div className="ec-banner ec-banner-error">{error}</div>}

      <div className="ec-card space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="ec-section-title flex items-center gap-2">
            <MessageCircleHeart size={16} /> Guest Memories
          </h3>
          {manualApproval !== null && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
              <span className="ec-toggle">
                <input type="checkbox" checked={manualApproval} onChange={handleToggleManualApproval} />
                <span className="ec-toggle-slider" />
              </span>
              <span style={{ fontSize: "13px", fontWeight: 600 }}>Manual Approval</span>
            </label>
          )}
        </div>
        <p className="ec-section-sub">
          Guest-uploaded photos, selfies, captions, and memories. Auto-approved by default; enable Manual Approval to
          hold new submissions for review first.
        </p>

        {memories === null ? (
          <div className="ec-skeleton" style={{ height: "90px", width: "100%" }} />
        ) : (
          <>
            {pending.length > 0 && (
              <div className="space-y-2">
                <h4 style={{ fontSize: "13px", fontWeight: 600 }}>Pending review ({pending.length})</h4>
                <div className="grid gap-3 ec-photo-grid">
                  {pending.map((m) => (
                    <MemoryCard key={m.id} memory={m} onApprove={handleMemoryApprove} onDelete={handleMemoryDelete} />
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <h4 style={{ fontSize: "13px", fontWeight: 600 }}>Approved ({approved.length})</h4>
              {approved.length === 0 ? (
                <div className="ec-empty-state">
                  <span className="ec-empty-state-icon">
                    <MessageCircleHeart size={22} />
                  </span>
                  <span className="ec-empty-state-title">No approved memories yet</span>
                  <span className="ec-empty-state-sub">Approved guest photos will appear here.</span>
                </div>
              ) : (
                <div className="grid gap-3 ec-photo-grid">
                  {approved.map((m) => (
                    <MemoryCard key={m.id} memory={m} onApprove={handleMemoryApprove} onDelete={handleMemoryDelete} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="ec-card space-y-3">
        <h3 className="ec-section-title flex items-center gap-2">
          <Pin size={16} /> Wishes
        </h3>
        <p className="ec-section-sub">
          Persistent text greetings from guests, separate from Guest Memories and Live Chat.
        </p>
        {wishes === null ? (
          <div className="ec-skeleton" style={{ height: "60px", width: "100%" }} />
        ) : wishes.length === 0 ? (
          <div className="ec-empty-state">
            <span className="ec-empty-state-icon">
              <Pin size={22} />
            </span>
            <span className="ec-empty-state-title">No wishes yet</span>
            <span className="ec-empty-state-sub">Guest wishes will appear here as they&rsquo;re submitted.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {wishes.map((w) => (
              <div key={w.id} className="ec-card" style={{ padding: "10px 12px" }}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <strong style={{ fontSize: "13px" }}>
                    {w.name} {w.is_pinned && <span title="Pinned">📌</span>}
                  </strong>
                  <span
                    className={`ec-status-pill ${
                      w.status === "approved"
                        ? "ec-status-pill--complete"
                        : w.status === "hidden"
                          ? "ec-status-pill--optional"
                          : "ec-status-pill--required"
                    }`}
                  >
                    {w.status}
                  </span>
                </div>
                <p style={{ fontSize: "13px", margin: "4px 0" }}>{w.message}</p>
                <div className="flex gap-2 flex-wrap items-center">
                  <button type="button" className="ec-btn ec-btn-secondary ec-btn-sm" onClick={() => handleWishPin(w.id, !w.is_pinned)}>
                    {w.is_pinned ? "Unpin" : "Pin"}
                  </button>
                  {w.status !== "approved" && (
                    <button type="button" className="ec-btn ec-btn-secondary ec-btn-sm" onClick={() => handleWishStatus(w.id, "approved")}>
                      Approve
                    </button>
                  )}
                  {w.status !== "hidden" && (
                    <button type="button" className="ec-btn ec-btn-secondary ec-btn-sm" onClick={() => handleWishStatus(w.id, "hidden")}>
                      Hide
                    </button>
                  )}
                  {w.status !== "rejected" && (
                    <button type="button" className="ec-btn ec-btn-secondary ec-btn-sm" onClick={() => handleWishStatus(w.id, "rejected")}>
                      Reject
                    </button>
                  )}
                  <button
                    type="button"
                    className="ec-icon-btn ec-icon-btn-danger"
                    onClick={() => handleWishDelete(w.id)}
                    aria-label="Delete wish"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MemoryCard({
  memory,
  onApprove,
  onDelete,
}: {
  memory: GuestMemoryRecord;
  onApprove: (id: string, approved: boolean) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <img
        src={memory.photo_url}
        alt={`Photo from ${memory.uploader_name}`}
        style={{ width: "100%", height: "90px", objectFit: "cover", borderRadius: "6px" }}
      />
      <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{memory.uploader_name}</div>
      <div className="flex gap-1 justify-center items-center flex-wrap">
        {memory.approved ? (
          <button type="button" className="ec-btn ec-btn-secondary ec-btn-sm" onClick={() => onApprove(memory.id, false)}>
            Hide
          </button>
        ) : (
          <button type="button" className="ec-btn ec-btn-secondary ec-btn-sm" onClick={() => onApprove(memory.id, true)}>
            Approve
          </button>
        )}
        <button
          type="button"
          className="ec-icon-btn ec-icon-btn-danger"
          onClick={() => onDelete(memory.id)}
          aria-label="Delete"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
