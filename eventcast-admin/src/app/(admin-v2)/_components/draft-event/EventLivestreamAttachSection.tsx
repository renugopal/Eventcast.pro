"use client";

import { ChevronDown, Radio } from "lucide-react";

interface EventLivestreamAttachSectionProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Livestream staging for Create Event — deliberately limited to the manual
 * YouTube watch-link (Baseline YTB-003), which only stores a URL
 * (`PATCH /api/events/[eventId]/livestream/youtube`) and has no production
 * side effect. Real ingest activation (`POST /api/events/[eventId]/livestream/enable`)
 * touches the SRS/Media Agent control plane and is deliberately NOT offered
 * here — it stays a separate, explicit action on the Live tab after the
 * event exists, so page creation never silently starts a livestream.
 */
export function EventLivestreamAttachSection({ value, onChange }: EventLivestreamAttachSectionProps) {
  const isConfigured = value.trim().length > 0;

  return (
    <details className="ec-accordion">
      <summary>
        <div className="ec-section-card-heading">
          <span className="ec-section-icon-chip ec-section-icon-chip--optional">
            <Radio size={16} />
          </span>
          <div>
            <div className="ec-section-card-title">Livestream</div>
            <div className="ec-section-card-sub">Manual YouTube watch link</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`ec-status-pill ${isConfigured ? "ec-status-pill--configured" : "ec-status-pill--optional"}`}>
            {isConfigured ? "Added" : "Optional"}
          </span>
          <ChevronDown size={18} className="ec-accordion-chevron" />
        </div>
      </summary>
      <div className="ec-accordion-body">
        <div>
          <label className="ec-label">YouTube watch link (optional)</label>
          <input
            className="ec-input w-full"
            type="url"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://youtube.com/watch?v=…"
          />
        </div>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
          This only stores a watch link for guests — it does not start a livestream. Enable and manage the actual
          livestream from the Live tab after the event is created.
        </p>
      </div>
    </details>
  );
}
