"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { authFetch, AuthError } from "@/lib/client-auth";
import { useEventWorkspace } from "../../../_components/event-workspace/EventWorkspaceShell";

/**
 * Event Workspace Settings tab (V2.1 Milestone G). Integrates the existing,
 * already-completed archive/restore capability (`POST /api/events/delete`
 * with `permanent: false`, `POST /api/events/restore`) rather than
 * reimplementing it — this is the one lifecycle action already backed by
 * real evidence (`archived_at`, EVT-004: archive-before-delete). Permanent
 * deletion is deliberately not exposed here: that path still carries legacy
 * Restreamer/Cloudinary/GitHub cleanup calls, which is out of this
 * package's scope.
 */
export default function EventWorkspaceSettingsPage() {
  const router = useRouter();
  const { state, reload } = useEventWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status !== "ready") return null;
  const { event } = state;
  const isArchived = Boolean(event.archived_at);

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

  return (
    <div className="ec-card space-y-3">
      <h3 className="ec-section-title flex items-center gap-2">
        {isArchived ? <ArchiveRestore size={16} /> : <Archive size={16} />} Archive
      </h3>
      <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
        {isArchived
          ? "This event is archived. It is hidden from the normal Events list but not deleted, and can be restored at any time."
          : "Archiving hides this event from the normal Events list without deleting it. It can be restored at any time."}
      </p>
      {error && <div style={{ fontSize: "13px", color: "var(--error)" }}>{error}</div>}
      <button type="button" className="ec-btn ec-btn-secondary" disabled={busy} onClick={handleArchiveToggle}>
        {busy ? "Working…" : isArchived ? "Restore event" : "Archive event"}
      </button>
    </div>
  );
}
