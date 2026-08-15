"use client";

import { useState } from "react";
import {
  accessSupportThread,
  setSupportTicketStatus,
  usePlatformResource,
  type PlatformSupportResponse,
  type PlatformSupportThreadResponse,
} from "../_lib/platformClient";
import { DataTable, PageHeading, ResourceGate, Section, formatTimestamp } from "../_components/PlatformUI";

export default function PlatformSupportPage() {
  const { resource, reload } = usePlatformResource<PlatformSupportResponse>("/api/platform/support");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  return (
    <div>
      <PageHeading
        title="Support"
        description="The cross-tenant support queue. Ticket metadata is shown here; message bodies are private customer content and require a stated reason, which is recorded in the platform audit log before any message is returned."
      />

      <ResourceGate resource={resource}>
        {(data) => (
          <>
            <div className="ec-card" style={{ padding: "16px" }}>
              <DataTable
                columns={["Studio", "Subject", "Category", "Status", "Messages", "Created", ""]}
                emptyMessage="No support tickets."
                rows={data.tickets.map((ticket) => [
                  ticket.studioSlug ?? ticket.studioId,
                  ticket.subject,
                  ticket.category,
                  ticket.status,
                  ticket.messageCount,
                  formatTimestamp(ticket.createdAt),
                  <button
                    key={ticket.id}
                    type="button"
                    className="ec-btn ec-btn-ghost"
                    onClick={() => setSelectedTicketId(ticket.id === selectedTicketId ? null : ticket.id)}
                  >
                    {ticket.id === selectedTicketId ? "Close" : "Open"}
                  </button>,
                ])}
              />
              <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "10px" }}>
                {data.contentAccessPolicy}
              </p>
            </div>

            {selectedTicketId && (
              <TicketWorkspace
                ticketId={selectedTicketId}
                currentStatus={data.tickets.find((ticket) => ticket.id === selectedTicketId)?.status ?? "open"}
                onStatusChanged={reload}
              />
            )}
          </>
        )}
      </ResourceGate>
    </div>
  );
}

/**
 * ADM-007 in practice: the thread stays closed until a reason is supplied,
 * and the reason is sent to a route that writes the audit row before it
 * returns a single message body.
 */
function TicketWorkspace({
  ticketId,
  currentStatus,
  onStatusChanged,
}: {
  ticketId: string;
  currentStatus: string;
  onStatusChanged: () => void;
}) {
  const [reason, setReason] = useState("");
  const [thread, setThread] = useState<PlatformSupportThreadResponse | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function openThread() {
    setError(null);
    setMessage(null);
    if (reason.trim() === "") {
      setError("A reason is required before private support content can be read.");
      return;
    }
    setBusy(true);
    try {
      setThread(await accessSupportThread(ticketId, reason.trim()));
      setMessage("Access recorded in the platform audit log.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open the support thread");
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(next: "open" | "closed") {
    setError(null);
    setMessage(null);
    if (statusReason.trim() === "") {
      setError("A reason is required to change a ticket's status.");
      return;
    }
    setBusy(true);
    try {
      await setSupportTicketStatus(ticketId, next, statusReason.trim());
      setMessage(`Ticket ${next}. Before/after state recorded in the audit log.`);
      setStatusReason("");
      onStatusChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change the ticket status");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Ticket workspace"
      note="Reading a thread and changing a ticket's status are both accountable actions: each requires a reason and leaves an audit entry naming the actor, the target, and the before/after state."
    >
      {error && <p style={{ color: "var(--error)", fontSize: "12px", marginBottom: "8px" }}>{error}</p>}
      {message && <p style={{ color: "var(--success)", fontSize: "12px", marginBottom: "8px" }}>{message}</p>}

      {!thread ? (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <input
            className="ec-input"
            placeholder="Reason for reading this customer's support thread"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            style={{ flex: 1, minWidth: "280px" }}
          />
          <button type="button" className="ec-btn ec-btn-primary" onClick={openThread} disabled={busy}>
            Read thread
          </button>
        </div>
      ) : (
        <div>
          <p style={{ fontSize: "13px", fontWeight: 700, marginBottom: "8px" }}>{thread.ticket.subject}</p>
          {thread.messages.map((entry) => (
            <div
              key={entry.id}
              style={{ padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: "13px" }}
            >
              <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "4px" }}>
                {entry.authorUserId ?? "unknown author"} · {formatTimestamp(entry.createdAt)}
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{entry.body}</div>
            </div>
          ))}
          {thread.messages.length === 0 && (
            <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>This thread has no messages.</p>
          )}
        </div>
      )}

      <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid var(--border)" }}>
        <h3 style={{ fontSize: "13px", fontWeight: 700, marginBottom: "6px" }}>Triage</h3>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px" }}>
          Current status: {currentStatus}. Replying from the platform side is not available — the message schema has no
          authorship role, so a Super Admin reply would appear to the provider as an unattributed message.
        </p>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <input
            className="ec-input"
            placeholder="Reason (required, recorded in the audit log)"
            value={statusReason}
            onChange={(event) => setStatusReason(event.target.value)}
            style={{ flex: 1, minWidth: "260px" }}
          />
          <button type="button" className="ec-btn ec-btn-ghost" onClick={() => changeStatus("closed")} disabled={busy}>
            Close ticket
          </button>
          <button type="button" className="ec-btn ec-btn-ghost" onClick={() => changeStatus("open")} disabled={busy}>
            Reopen ticket
          </button>
        </div>
      </div>
    </Section>
  );
}
