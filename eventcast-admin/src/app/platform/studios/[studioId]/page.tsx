"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  platformSend,
  usePlatformResource,
  type PlatformStudioDetailResponse,
} from "../../_lib/platformClient";
import {
  DataTable,
  DefinitionList,
  PageHeading,
  ResourceGate,
  Section,
  StatCard,
  StatGrid,
  formatTimestamp,
} from "../../_components/PlatformUI";

export default function PlatformStudioDetailPage() {
  // `useParams` matches the convention the rest of this application's client
  // route components already use for dynamic segments.
  const { studioId } = useParams<{ studioId: string }>();
  const { resource, reload } = usePlatformResource<PlatformStudioDetailResponse>(
    studioId ? `/api/platform/studios/${encodeURIComponent(studioId)}` : null
  );

  return (
    <div>
      <p style={{ fontSize: "12px", marginBottom: "8px" }}>
        <Link href="/platform/studios" style={{ color: "var(--primary)", fontWeight: 600 }}>
          ← Users &amp; Studios
        </Link>
      </p>

      <ResourceGate resource={resource}>
        {(data) => (
          <>
            <PageHeading title={data.studio.displayName} description={`Studio ${data.studio.slug}`} />

            <div className="ec-card" style={{ padding: "16px" }}>
              <DefinitionList
                rows={[
                  ["Studio id", <code key="id">{data.studio.id}</code>],
                  ["Owner user id", <code key="owner">{data.studio.ownerUserId}</code>],
                  ["Plan tier", data.studio.planTier],
                  ["Custom domain", data.studio.customDomain ?? "—"],
                  ["Created", formatTimestamp(data.studio.createdAt)],
                ]}
              />
            </div>

            <Section title="Operational summary">
              <StatGrid>
                <StatCard label="Events" value={data.events.length} />
                <StatCard label="Members" value={data.members.length} />
                <StatCard label="Open support tickets" value={data.supportSummary.open} />
                <StatCard label="Unread notifications" value={data.notificationSummary.unread} />
                <StatCard label="Critical notifications" value={data.notificationSummary.critical} />
              </StatGrid>
            </Section>

            <RetentionOverrideSection
              studioId={studioId}
              current={data.retentionOverride.retentionDays}
              updatedAt={data.retentionOverride.updatedAt}
              onChanged={reload}
            />

            <Section title="Members" note="User ids and roles only — contact details are never read by this console.">
              <DataTable
                columns={["User id", "Role", "Joined"]}
                emptyMessage="No members."
                rows={data.members.map((member) => [
                  <code key={member.userId}>{member.userId}</code>,
                  member.role,
                  formatTimestamp(member.joinedAt),
                ])}
              />
            </Section>

            <Section title="Events">
              <DataTable
                columns={["Slug", "Lifecycle", "Page state", "Visibility", "Template", "Scheduled"]}
                emptyMessage="No events."
                rows={data.events.map((event) => [
                  <Link key={event.id} href={`/platform/events/${event.id}`} style={{ color: "var(--primary)", fontWeight: 600 }}>
                    {event.slug}
                  </Link>,
                  event.lifecycleStatus,
                  event.pageState,
                  event.eventVisibility,
                  event.templateId ?? "—",
                  formatTimestamp(event.scheduledStartAt),
                ])}
              />
            </Section>
          </>
        )}
      </ResourceGate>
    </div>
  );
}

/**
 * The one account-level control backed by a real mechanism: the studio
 * retention override. Delegates to the existing
 * `/api/platform/studios/[studioId]/retention-override` route, whose
 * `apply_studio_retention_override` RPC writes the override and its audit
 * row in one transaction. Never writes `studio_retention_overrides` directly.
 */
function RetentionOverrideSection({
  studioId,
  current,
  updatedAt,
  onChanged,
}: {
  studioId: string;
  current: number | null;
  updatedAt: string | null;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState(current != null ? String(current) : "");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const path = `/api/platform/studios/${encodeURIComponent(studioId)}/retention-override`;

  async function save() {
    setError(null);
    setMessage(null);
    const days = parseInt(draft, 10);
    if (!Number.isInteger(days) || days <= 0) {
      setError("Override retention days must be a positive integer.");
      return;
    }
    setBusy(true);
    try {
      await platformSend(path, "PUT", { retentionDays: days });
      setMessage("Studio retention override saved. Already-frozen events are never rewritten.");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set the studio override");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await platformSend(path, "DELETE");
      setDraft("");
      setMessage("Override cleared — the global default now applies to future freezes.");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear the studio override");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Retention override"
      note="Overrides the global default for this studio only, at the moment an event's retention freezes. It never retroactively rewrites an already-frozen event's promised window."
    >
      <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px" }}>
        Current: {current != null ? `${current} days` : "none (global default applies)"}
        {updatedAt ? ` · updated ${formatTimestamp(updatedAt)}` : ""}
      </p>
      {error && <p style={{ color: "var(--error)", fontSize: "12px", marginBottom: "8px" }}>{error}</p>}
      {message && <p style={{ color: "var(--success)", fontSize: "12px", marginBottom: "8px" }}>{message}</p>}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <input
          className="ec-input"
          type="number"
          min={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          style={{ width: "140px" }}
          aria-label="Override retention days"
        />
        <button type="button" className="ec-btn ec-btn-primary" onClick={save} disabled={busy}>
          Set / update override
        </button>
        <button type="button" className="ec-btn ec-btn-ghost" onClick={clear} disabled={busy}>
          Clear override
        </button>
      </div>
    </Section>
  );
}
