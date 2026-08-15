"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LifeBuoy, ChevronLeft } from "lucide-react";
import { authFetch } from "@/lib/client-auth";
import {
  addSupportTicketMessage,
  createSupportTicket,
  fetchSupportTicket,
  fetchSupportTickets,
  updateSupportTicketStatus,
  type SupportTicket,
  type SupportTicketMessage,
  type TicketCategory,
} from "@/lib/supportNotificationClient";

/**
 * Provider Console Support surface (Baseline V2.1 SUP-001/SUP-002). Minimal
 * tenant-owned ticket list, create form, and inline thread view — no large
 * CRM workflow, no Super Admin console (that's Milestone M). Opening this
 * page with `?eventId=…&category=urgent_live` (the Live tab's "Urgent Live
 * Support" link) pre-fills a new ticket already associated with that event.
 */
export default function AdminV2SupportPage() {
  const searchParams = useSearchParams();
  const prefillEventId = searchParams.get("eventId");
  const prefillCategory = searchParams.get("category") === "urgent_live" ? "urgent_live" : null;

  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportTicketMessage[] | null>(null);
  const [replyBody, setReplyBody] = useState("");

  const [showCreateForm, setShowCreateForm] = useState(!!prefillCategory);
  const [subject, setSubject] = useState(prefillCategory === "urgent_live" ? "Urgent: livestream issue" : "");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<TicketCategory>(prefillCategory ?? "general");

  async function loadTickets() {
    try {
      setTickets(await fetchSupportTickets(authFetch));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    loadTickets();
  }, []);

  async function loadTicketDetail(ticketId: string) {
    setSelectedTicketId(ticketId);
    try {
      const detail = await fetchSupportTicket(authFetch, ticketId);
      setSelectedTicket(detail.ticket);
      setMessages(detail.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;
    try {
      const ticket = await createSupportTicket(authFetch, {
        subject: subject.trim(),
        message: message.trim(),
        category,
        eventId: prefillCategory === "urgent_live" ? prefillEventId : null,
      });
      setSubject("");
      setMessage("");
      setShowCreateForm(false);
      await loadTickets();
      await loadTicketDetail(ticket.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleReply() {
    if (!selectedTicketId || !replyBody.trim()) return;
    try {
      await addSupportTicketMessage(authFetch, selectedTicketId, replyBody.trim());
      setReplyBody("");
      await loadTicketDetail(selectedTicketId);
      await loadTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCloseReopen(status: "open" | "closed") {
    if (!selectedTicketId) return;
    try {
      const updated = await updateSupportTicketStatus(authFetch, selectedTicketId, status);
      setSelectedTicket(updated);
      await loadTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (selectedTicketId && selectedTicket) {
    return (
      <div className="flex flex-col gap-4">
        <button
          type="button"
          className="ec-btn ec-btn-secondary ec-btn-sm"
          onClick={() => {
            setSelectedTicketId(null);
            setSelectedTicket(null);
            setMessages(null);
          }}
        >
          <ChevronLeft size={14} /> Back to tickets
        </button>

        {error && (
          <div className="ec-card" style={{ borderColor: "#FECDD3", color: "var(--error)", fontSize: "13px" }}>
            {error}
          </div>
        )}

        <div className="ec-card space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="ec-section-title">{selectedTicket.subject}</h3>
            <span className="ec-badge">{selectedTicket.status}</span>
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
            {selectedTicket.category === "urgent_live" ? "Urgent Live Support" : "General"}
            {selectedTicket.event_id ? ` · linked to event ${selectedTicket.event_id}` : ""}
          </div>
        </div>

        <div className="ec-card space-y-3">
          {(messages ?? []).map((m) => (
            <div key={m.id} style={{ fontSize: "13px", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "8px" }}>
              <div style={{ color: "var(--text-tertiary)", fontSize: "11px" }}>{new Date(m.created_at).toLocaleString()}</div>
              <div>{m.body}</div>
            </div>
          ))}
          {(messages ?? []).length === 0 && (
            <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>No messages yet.</div>
          )}
        </div>

        <div className="ec-card space-y-2">
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Add a message…"
            className="ec-input"
            style={{ width: "100%", minHeight: "80px", fontSize: "13px" }}
          />
          <div className="flex gap-2 flex-wrap">
            <button type="button" className="ec-btn ec-btn-primary ec-btn-sm" onClick={handleReply}>
              Send
            </button>
            {selectedTicket.status === "open" ? (
              <button type="button" className="ec-btn ec-btn-secondary ec-btn-sm" onClick={() => handleCloseReopen("closed")}>
                Close ticket
              </button>
            ) : (
              <button type="button" className="ec-btn ec-btn-secondary ec-btn-sm" onClick={() => handleCloseReopen("open")}>
                Reopen ticket
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="ec-section-header">
        <div>
          <h1 className="ec-page-title flex items-center gap-2">
            <LifeBuoy size={20} /> Support
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "4px" }}>
            Create a ticket for a general question, or an Urgent Live Support ticket linked to a live event.
          </p>
        </div>
        <button type="button" className="ec-btn ec-btn-primary" onClick={() => setShowCreateForm((v) => !v)}>
          {showCreateForm ? "Cancel" : "New ticket"}
        </button>
      </div>

      {error && (
        <div className="ec-card" style={{ borderColor: "#FECDD3", color: "var(--error)", fontSize: "13px" }}>
          {error}
        </div>
      )}

      {showCreateForm && (
        <form onSubmit={handleCreate} className="ec-card space-y-3">
          {prefillCategory === "urgent_live" && prefillEventId && (
            <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              This ticket will be linked to event {prefillEventId} as Urgent Live Support.
            </p>
          )}
          <input
            type="text"
            required
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="ec-input"
            style={{ width: "100%" }}
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as TicketCategory)}
            className="ec-input"
            disabled={prefillCategory === "urgent_live"}
          >
            <option value="general">General</option>
            <option value="urgent_live">Urgent Live Support</option>
          </select>
          <textarea
            required
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe the issue…"
            className="ec-input"
            style={{ width: "100%", minHeight: "100px" }}
          />
          <button type="submit" className="ec-btn ec-btn-primary">
            Create ticket
          </button>
        </form>
      )}

      <div className="ec-card" style={{ padding: 0 }}>
        {!tickets ? (
          <div style={{ padding: "16px", fontSize: "13px", color: "var(--text-secondary)" }}>Loading…</div>
        ) : tickets.length === 0 ? (
          <div style={{ padding: "16px", fontSize: "13px", color: "var(--text-secondary)" }}>No tickets yet.</div>
        ) : (
          tickets.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => loadTicketDetail(t.id)}
              className="flex items-center justify-between w-full"
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--border-subtle)",
                textAlign: "left",
                fontSize: "13px",
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{t.subject}</div>
                <div style={{ color: "var(--text-tertiary)", fontSize: "11px" }}>
                  {t.category === "urgent_live" ? "Urgent Live Support" : "General"} ·{" "}
                  {new Date(t.updated_at).toLocaleString()}
                </div>
              </div>
              <span className="ec-badge">{t.status}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
