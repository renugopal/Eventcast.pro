"use client";

import { Sparkles } from "lucide-react";
import type { DraftEventFormValues } from "./DraftEventForm";
import type { EventPublicVisibility } from "@/lib/eventContract";

interface EventSummaryRailProps {
  templateId: string;
  templateLabel: string | null;
  values: DraftEventFormValues;
  visibility: EventPublicVisibility | null;
  creditCount: number;
}

function formatScheduled(local: string): string | null {
  if (!local) return null;
  const parsed = new Date(local);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function Row({ label, value, placeholder }: { label: string; value: string | null; placeholder: string }) {
  return (
    <div className="ec-summary-row">
      <span className="ec-summary-row-label">{label}</span>
      <span className={`ec-summary-row-value${value ? "" : " placeholder"}`}>{value || placeholder}</span>
    </div>
  );
}

/**
 * Read-only live summary of the Create Event form — a UI representation
 * only, never a second source of truth. Every value here is derived
 * directly from the same state `events/new/page.tsx` already owns (or
 * `null`/placeholder when not yet entered); nothing is fetched, cached, or
 * computed independently. Collapses to a compact `<details>` on mobile via
 * the parent's markup choice, not a CSS media-query hide, so it stays
 * genuinely lightweight there rather than just visually hidden.
 */
export function EventSummaryRail({ templateId, templateLabel, values, visibility, creditCount }: EventSummaryRailProps) {
  const coupleNames =
    values.groomName.trim() && values.brideName.trim() ? `${values.groomName.trim()} & ${values.brideName.trim()}` : null;
  const scheduled = formatScheduled(values.scheduledStartAtLocal);
  const visibilityLabel = visibility === "public" ? "Public" : visibility === "unlisted" ? "Unlisted" : null;

  return (
    <div className="ec-summary-rail">
      <div className="ec-summary-rail-title flex items-center gap-2">
        <Sparkles size={14} /> Event Summary
      </div>

      <Row label="Template" value={templateLabel} placeholder={templateId ? templateId : "Not selected"} />
      <Row label="Couple" value={coupleNames} placeholder="Add groom & bride names" />
      <Row label="Date & time" value={scheduled} placeholder="Not scheduled yet" />
      <Row label="Venue" value={values.venueName.trim() || null} placeholder="Not set yet" />
      <Row label="Page link" value={values.slug.trim() ? `/${values.slug.trim()}` : null} placeholder="Auto-generated from names" />

      <div className="ec-summary-divider" />

      <Row label="Visibility" value={visibilityLabel} placeholder="Choose before publishing" />
      <Row
        label="Partner credits"
        value={creditCount > 0 ? `${creditCount} queued` : null}
        placeholder="None added yet"
      />
    </div>
  );
}
