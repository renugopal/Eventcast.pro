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
      {error && (
        <div className="ec-card" style={{ borderColor: "#FECDD3", color: "var(--error)", fontSize: "13px" }}>
          {error}
        </div>
      )}

      <div className="ec-card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="ec-section-title flex items-center gap-2">
            <MessageCircleHeart size={16} /> Guest Memories
          </h3>
          {manualApproval !== null && (
            <label style={{ fontSize: "13px", display: "flex", alignItems: "center", gap: "6px" }}>
              <input type="checkbox" checked={manualApproval} onChange={handleToggleManualApproval} />
              Manual Approval
            </label>
          )}
        </div>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          Guest-uploaded photos, selfies, captions, and memories. Auto-approved by default; enable Manual Approval to
          hold new submissions for review first.
        </p>

        {memories === null ? (
          <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Loading…</div>
        ) : (
          <>
            {pending.length > 0 && (
              <div className="space-y-2">
                <h4 style={{ fontSize: "13px", fontWeight: 600 }}>Pending review ({pending.length})</h4>
                <div className="flex flex-wrap gap-3">
                  {pending.map((m) => (
                    <MemoryCard key={m.id} memory={m} onApprove={handleMemoryApprove} onDelete={handleMemoryDelete} />
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <h4 style={{ fontSize: "13px", fontWeight: 600 }}>Approved ({approved.length})</h4>
              {approved.length === 0 ? (
                <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>None yet.</div>
              ) : (
                <div className="flex flex-wrap gap-3">
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
        <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          Persistent text greetings from guests, separate from Guest Memories and Live Chat.
        </p>
        {wishes === null ? (
          <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Loading…</div>
        ) : wishes.length === 0 ? (
          <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>No wishes yet.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {wishes.map((w) => (
              <div key={w.id} className="ec-card" style={{ padding: "10px 12px" }}>
                <div className="flex items-center justify-between">
                  <strong style={{ fontSize: "13px" }}>
                    {w.name} {w.is_pinned && <span title="Pinned">📌</span>}
                  </strong>
                  <span
                    className="ec-badge"
                    style={{
                      fontSize: "11px",
                      color:
                        w.status === "approved" ? "var(--success, #16a34a)" : w.status === "hidden" ? "var(--text-secondary)" : "var(--error)",
                    }}
                  >
                    {w.status}
                  </span>
                </div>
                <p style={{ fontSize: "13px", margin: "4px 0" }}>{w.message}</p>
                <div className="flex gap-2 flex-wrap">
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
                  <button type="button" className="ec-btn ec-btn-secondary ec-btn-sm" onClick={() => handleWishDelete(w.id)}>
                    <Trash2 size={12} />
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
    <div className="flex flex-col gap-1" style={{ width: "120px" }}>
      <img
        src={memory.photo_url}
        alt={`Photo from ${memory.uploader_name}`}
        style={{ width: "120px", height: "90px", objectFit: "cover", borderRadius: "6px" }}
      />
      <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{memory.uploader_name}</div>
      <div className="flex gap-1 justify-center">
        {memory.approved ? (
          <button type="button" className="ec-btn ec-btn-secondary ec-btn-sm" onClick={() => onApprove(memory.id, false)}>
            Hide
          </button>
        ) : (
          <button type="button" className="ec-btn ec-btn-secondary ec-btn-sm" onClick={() => onApprove(memory.id, true)}>
            Approve
          </button>
        )}
        <button type="button" className="ec-btn ec-btn-secondary ec-btn-sm" onClick={() => onDelete(memory.id)} aria-label="Delete">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
