"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  extendEventRetention,
  usePlatformResource,
  verifyYoutubeFallback,
  type PlatformEventDetailResponse,
  type R2CleanupPlan,
} from "../../_lib/platformClient";
import {
  DataTable,
  DefinitionList,
  PageHeading,
  ResourceGate,
  Section,
  UnavailableNote,
  formatTimestamp,
} from "../../_components/PlatformUI";

export default function PlatformEventDetailPage() {
  // `useParams` matches the convention the rest of this application's client
  // route components already use for dynamic segments.
  const { eventId } = useParams<{ eventId: string }>();
  const { resource, reload } = usePlatformResource<PlatformEventDetailResponse>(
    eventId ? `/api/platform/events/${encodeURIComponent(eventId)}` : null
  );

  return (
    <div>
      <p style={{ fontSize: "12px", marginBottom: "8px" }}>
        <Link href="/platform/events" style={{ color: "var(--primary)", fontWeight: 600 }}>
          ← All Events
        </Link>
      </p>

      <ResourceGate resource={resource}>
        {(data) => (
          <>
            <PageHeading
              title={data.event.slug}
              description={`${data.event.studioDisplayName ?? data.event.studioSlug ?? data.event.studioId} · ${data.event.lifecycleStatus}`}
            />

            <div className="ec-card" style={{ padding: "16px" }}>
              <DefinitionList
                rows={[
                  ["Event id", <code key="id">{data.event.id}</code>],
                  [
                    "Studio",
                    <Link key="studio" href={`/platform/studios/${data.event.studioId}`} style={{ color: "var(--primary)" }}>
                      {data.event.studioSlug ?? data.event.studioId}
                    </Link>,
                  ],
                  ["Page state", data.event.pageState],
                  ["Visibility", data.event.eventVisibility],
                  ["Template", data.event.templateId ?? "—"],
                  ["Scheduled start", formatTimestamp(data.event.scheduledStartAt)],
                  ["Archived", formatTimestamp(data.event.archivedAt)],
                  ["Provider YouTube link", data.event.youtubeUrl ?? "—"],
                ]}
              />
            </div>

            <Section
              title="Stream assignment"
              note="Assignment state only. Stream secrets, publish keys, and YouTube secret references are never read by this console."
            >
              {data.assignment ? (
                <>
                  <DefinitionList
                    rows={[
                      ["Enabled", data.assignment.enabled ? "yes" : "no"],
                      ["Assigned node", data.assignment.assignedMediaNodeId ?? "—"],
                      ["Ingest identity", data.assignment.ingestPresent ? "present" : "absent"],
                      ["Playback identity", data.assignment.playbackPresent ? "present" : "absent"],
                      ["Publish window", `${formatTimestamp(data.assignment.publishWindowStartAt)} → ${formatTimestamp(data.assignment.publishWindowEndAt)}`],
                      ["YouTube relay enabled", data.assignment.youtubeEnabled ? "yes" : "no"],
                      ["Config version", String(data.assignment.configVersion)],
                    ]}
                  />
                  <UnavailableNote label="Live / ingest status" fact={data.assignment.liveStatus} />
                  <UnavailableNote label="Technical stream metrics" fact={data.assignment.technicalStreamMetrics} />
                </>
              ) : (
                <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>No stream assignment exists for this event.</p>
              )}
            </Section>

            <Section
              title="Activation provenance"
              note="The append-only activation history that recording finalization is validated against. A recording can only be promoted to authoritative when every activation below is covered by one node's finalized archive."
            >
              <DataTable
                columns={["Media node", "Playback id", "Activated"]}
                emptyMessage="No activation history."
                rows={data.activationHistory.map((row, index) => [
                  <code key={`node-${index}`}>{row.mediaNodeId}</code>,
                  <code key={`pb-${index}`}>{row.playbackId}</code>,
                  formatTimestamp(row.activatedAt),
                ])}
              />
            </Section>

            <RecordingAndRetentionSection data={data} eventId={eventId} onChanged={reload} />

            <R2CleanupSection plan={data.r2CleanupPlan} />

            <Section title="Support tickets">
              <DataTable
                columns={["Subject", "Category", "Status", "Created"]}
                emptyMessage="No support tickets linked to this event."
                rows={data.supportTickets.map((ticket) => [
                  <Link key={ticket.id} href="/platform/support" style={{ color: "var(--primary)" }}>
                    {ticket.subject}
                  </Link>,
                  ticket.category,
                  ticket.status,
                  formatTimestamp(ticket.createdAt),
                ])}
              />
            </Section>

            <Section title="Notifications">
              <DataTable
                columns={["Severity", "Type", "Title", "Read", "Created"]}
                emptyMessage="No notifications for this event."
                rows={data.notifications.map((notification) => [
                  notification.severity,
                  notification.notificationType,
                  notification.title,
                  notification.readAt ? "yes" : "no",
                  formatTimestamp(notification.createdAt),
                ])}
              />
            </Section>
          </>
        )}
      </ResourceGate>
    </div>
  );
}

function RecordingAndRetentionSection({
  data,
  eventId,
  onChanged,
}: {
  data: PlatformEventDetailResponse;
  eventId: string;
  onChanged: () => void;
}) {
  const recording = data.recording;

  const [newExpiresAt, setNewExpiresAt] = useState("");
  const [extensionReason, setExtensionReason] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState(data.event.youtubeUrl ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitExtension() {
    setError(null);
    setMessage(null);
    if (!newExpiresAt || extensionReason.trim() === "") {
      setError("A new expiry date and a non-empty reason are both required.");
      return;
    }
    setBusy(true);
    try {
      const result = await extendEventRetention(eventId, new Date(newExpiresAt).toISOString(), extensionReason.trim());
      setMessage(`Retention extended to ${formatTimestamp(result.retentionExpiresAt)}. The extension and its audit entry were written together.`);
      setExtensionReason("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extend retention");
    } finally {
      setBusy(false);
    }
  }

  async function submitAttestation() {
    setError(null);
    setMessage(null);
    if (youtubeUrl.trim() === "") {
      setError("A YouTube watch URL is required.");
      return;
    }
    setBusy(true);
    try {
      await verifyYoutubeFallback(eventId, youtubeUrl.trim());
      setMessage("YouTube fallback attested. Recorded with an audit entry by the database RPC.");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record the attestation");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Recording, retention and replay fallback"
      note="All state below is read from event_recordings. Both actions delegate to the existing database RPCs, which write the business change and its audit row in one transaction — this page never writes recording or retention state itself."
    >
      {recording ? (
        <DefinitionList
          rows={[
            ["Recording state", recording.recordingState],
            ["Local finalized", formatTimestamp(recording.localFinalizedAt)],
            ["B2 finalized", formatTimestamp(recording.b2FinalizedAt)],
            ["Integrity verified", formatTimestamp(recording.integrityVerifiedAt)],
            ["Finalization generation", recording.finalizationGeneration ?? "—"],
            ["Gaps", `${recording.gapCount} (${recording.gapStatus})`],
            ["B2 bucket", recording.b2Bucket ?? "—"],
            ["B2 object key", recording.b2ObjectKey ? <code key="key">{recording.b2ObjectKey}</code> : "—"],
            ["Failure reason", recording.finalizationFailureReason ?? "—"],
            ["Retention effective days", recording.retentionEffectiveDays != null ? String(recording.retentionEffectiveDays) : "not frozen"],
            ["Retention frozen at", formatTimestamp(recording.retentionFrozenAt)],
            [
              "Retention expires at",
              recording.retentionExpiresAt
                ? `${formatTimestamp(recording.retentionExpiresAt)}${recording.retentionExpired ? " (expired)" : ""}`
                : "—",
            ],
            [
              "YouTube fallback",
              recording.youtubeFallbackVerified
                ? `verified — ${recording.youtubeFallbackUrl ?? "url missing"}`
                : recording.youtubeFallbackUrl
                  ? `recorded but not verified — ${recording.youtubeFallbackUrl}`
                  : "none",
            ],
          ]}
        />
      ) : (
        <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>No recording record exists for this event.</p>
      )}

      {recording && <UnavailableNote label="YouTube channel / broadcast state" fact={recording.youtubeChannelState} />}

      {error && <p style={{ color: "var(--error)", fontSize: "12px", marginTop: "10px" }}>{error}</p>}
      {message && <p style={{ color: "var(--success)", fontSize: "12px", marginTop: "10px" }}>{message}</p>}

      <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid var(--border)" }}>
        <h3 style={{ fontSize: "13px", fontWeight: 700, marginBottom: "6px" }}>Extend retention (STO-008)</h3>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px" }}>
          Only possible once retention is frozen, and only to a strictly later expiry. The database enforces both.
        </p>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <input
            className="ec-input"
            type="date"
            value={newExpiresAt}
            onChange={(event) => setNewExpiresAt(event.target.value)}
            aria-label="New retention expiry"
          />
          <input
            className="ec-input"
            placeholder="Reason (required, recorded in the audit log)"
            value={extensionReason}
            onChange={(event) => setExtensionReason(event.target.value)}
            style={{ flex: 1, minWidth: "240px" }}
          />
          <button type="button" className="ec-btn ec-btn-primary" onClick={submitExtension} disabled={busy}>
            Extend retention
          </button>
        </div>
      </div>

      <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid var(--border)" }}>
        <h3 style={{ fontSize: "13px", fontWeight: 700, marginBottom: "6px" }}>Attest verified YouTube fallback (STO-005)</h3>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px" }}>
          A manual Super Admin attestation that the replay is genuine, public, and playable. No YouTube API call is made
          or simulated, and no provider action can ever set this. The URL must match the event&apos;s current
          provider-supplied YouTube link.
        </p>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <input
            className="ec-input"
            placeholder="https://www.youtube.com/watch?v=…"
            value={youtubeUrl}
            onChange={(event) => setYoutubeUrl(event.target.value)}
            style={{ flex: 1, minWidth: "280px" }}
          />
          <button type="button" className="ec-btn ec-btn-primary" onClick={submitAttestation} disabled={busy}>
            Record attestation
          </button>
        </div>
      </div>
    </Section>
  );
}

function R2CleanupSection({ plan }: { plan: R2CleanupPlan }) {
  return (
    <Section
      title="R2 cleanup (dry run)"
      note="Report only. This console has no delete path: nothing here calls a storage API, enumerates an object, or schedules a deletion. Authoritative B2 archive objects are never a cleanup target."
    >
      <DefinitionList
        rows={[
          ["Eligible", plan.eligible ? "yes" : "no"],
          ["Execution available", "no — dry run only"],
          ["B2 objects", "never targeted"],
        ]}
      />

      {!plan.eligible && plan.ineligibilityReasons.length > 0 && (
        <div style={{ marginTop: "12px" }}>
          <strong style={{ fontSize: "12px" }}>Not eligible because:</strong>
          <ul style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "6px", paddingLeft: "18px" }}>
            {plan.ineligibilityReasons.map((reason) => (
              <li key={reason} style={{ marginBottom: "4px" }}>
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.candidateR2Prefixes.length > 0 && (
        <div style={{ marginTop: "12px" }}>
          <strong style={{ fontSize: "12px" }}>Candidate R2 prefixes (would be targeted, not deleted):</strong>
          <ul style={{ fontSize: "12px", marginTop: "6px", paddingLeft: "18px" }}>
            {plan.candidateR2Prefixes.map((prefix) => (
              <li key={prefix}>
                <code>{prefix}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ marginTop: "12px" }}>
        <strong style={{ fontSize: "12px" }}>Why execution is not available:</strong>
        <ul style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "6px", paddingLeft: "18px" }}>
          {plan.executionBlockers.map((blocker) => (
            <li key={blocker} style={{ marginBottom: "4px" }}>
              {blocker}
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
