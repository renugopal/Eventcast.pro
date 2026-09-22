"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { authFetch, AuthError } from "@/lib/client-auth";
import { useAdminAuth } from "../../../_lib/useAdminAuth";
import { useEventWorkspace } from "../../../_components/event-workspace/EventWorkspaceShell";

/**
 * Event Workspace Settings tab. Archive/Restore (`POST /api/events/delete`
 * with `permanent: false`, `POST /api/events/restore`) is the existing,
 * already-completed capability, unchanged here. Permanent Delete is a
 * separate, deliberately harder-to-reach action: only rendered for an
 * already-archived event, gated behind a typed slug-confirmation match,
 * and calls the dedicated guarded endpoint
 * (`POST /api/events/[eventId]/permanent-delete`) — never this tab's
 * Archive action, and never the removed `permanent: true` branch that used
 * to live on `/api/events/delete`.
 *
 * `canManage` (owner/admin) hides both the Archive/Restore control and the
 * Permanent Delete controls for a `member`, who is shown a read-only
 * explanatory note instead — the same pattern already used in
 * `PartnerDirectory.tsx`. The server's own role gate on all three routes
 * remains the real enforcement; this is UI honesty, not a security
 * boundary.
 */

const ARCHIVED_DRAFT_AUTO_DELETE_DAYS = 30;

export default function EventWorkspaceSettingsPage() {
  const router = useRouter();
  const { studioMemberRole } = useAdminAuth();
  const { state, reload } = useEventWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [confirmSlug, setConfirmSlug] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (state.status !== "ready") return null;
  const { event } = state;
  const isArchived = Boolean(event.archived_at);
  const isDraft = event.page_state === "draft";
  const canManage = studioMemberRole === "owner" || studioMemberRole === "admin";

  // Plain computation, not useMemo — trivial arithmetic, and this line sits
  // safely after the early-return guard above.
  let autoDeleteDays: number | null = null;
  if (isArchived && isDraft && event.archived_at) {
    const deadline = new Date(event.archived_at).getTime() + ARCHIVED_DRAFT_AUTO_DELETE_DAYS * 24 * 60 * 60 * 1000;
    autoDeleteDays = Math.max(0, Math.ceil((deadline - Date.now()) / (24 * 60 * 60 * 1000)));
  }

  async function handleArchiveToggle() {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(isArchived ? "/api/events/restore" : "/api/events/delete", {
        method: "POST",
        body: JSON.stringify(isArchived ? { id: event.id } : { id: event.id, permanent: false }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "This action could not be completed.");
      }
      reload();
    } catch (err) {
      if (err instanceof AuthError) {
        router.push("/login");
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handlePermanentDelete() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await authFetch(`/api/events/${event.id}/permanent-delete`, {
        method: "POST",
        body: JSON.stringify({ confirmSlug }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "This event could not be permanently deleted.");
      }
      router.push("/events");
    } catch (err) {
      if (err instanceof AuthError) {
        router.push("/login");
        return;
      }
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleteBusy(false);
    }
  }

  const slugMatches = event.slug !== null && confirmSlug.trim() === event.slug;

  return (
    <div className="space-y-4">
      <div className="ec-card ec-settings-card">
        <div className="ec-settings-section-header">
          <h3 className="ec-section-title flex items-center gap-2">
            {isArchived ? <ArchiveRestore size={16} /> : <Archive size={16} />} Archive
          </h3>
        </div>
        <div className="ec-settings-body">
          <p className="ec-section-sub">
            {isArchived
              ? isDraft
                ? "This Draft is archived and hidden from the normal Events list. You can restore it before its permanent-deletion deadline."
                : "This event is archived. It is hidden from the normal Events list but not deleted, and can be restored at any time."
              : "Archiving hides this event from the normal Events list without deleting it. It can be restored at any time."}
          </p>
          {error && <div className="ec-banner ec-banner-error">{error}</div>}
          <div className="ec-settings-actions">
            {canManage ? (
              <button type="button" className="ec-btn ec-btn-secondary" disabled={busy} onClick={handleArchiveToggle}>
                {busy ? "Working…" : isArchived ? "Restore event" : "Archive event"}
              </button>
            ) : (
              <p style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>
                Only an owner or admin can archive or restore this event.
              </p>
            )}
          </div>
        </div>
      </div>

      {isArchived && (
        <div className="ec-card ec-settings-card">
          <div className="ec-settings-section-header">
            <h3 className="ec-section-title flex items-center gap-2" style={{ color: "var(--error)" }}>
              <Trash2 size={16} /> Delete Permanently
            </h3>
          </div>
          <div className="ec-settings-body">
            {autoDeleteDays !== null && (
              <div className="ec-banner ec-banner-warning">
                Auto-deletes in {autoDeleteDays} day{autoDeleteDays === 1 ? "" : "s"}.
              </div>
            )}

            <p style={{ fontSize: "13px", color: "var(--error)", fontWeight: 600 }}>
              This permanently deletes this event and its removable media (guest photos, thumbnail,
              gallery, invitation video). This cannot be undone. A retained archival recording, if
              one exists, is not deleted here and remains subject to its own retention policy.
            </p>

            {canManage ? (
              <>
                <div className="ec-settings-field">
                  <label className="ec-label">
                    Type <code>{event.slug}</code> to confirm.
                  </label>
                  <input
                    type="text"
                    className="ec-input"
                    value={confirmSlug}
                    onChange={(e) => setConfirmSlug(e.target.value)}
                    placeholder={event.slug ?? ""}
                    disabled={deleteBusy}
                  />
                </div>

                {deleteError && <div className="ec-banner ec-banner-error">{deleteError}</div>}

                <div className="ec-settings-actions">
                  <button
                    type="button"
                    className="ec-btn ec-btn-danger"
                    disabled={deleteBusy || !slugMatches}
                    onClick={handlePermanentDelete}
                  >
                    {deleteBusy ? "Deleting…" : "Delete Permanently Now"}
                  </button>
                </div>
              </>
            ) : (
              <p style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>
                Only an owner or admin can permanently delete this event.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
