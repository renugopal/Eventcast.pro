"use client";

import { ChevronDown, Images } from "lucide-react";

interface EventEngagementAttachSectionProps {
  value: boolean;
  onChange: (value: boolean) => void;
}

/**
 * Guest Memories moderation staging for Create Event — the Manual Approval
 * toggle (`PATCH /api/events/[eventId]/guest-memories/settings`, backed by
 * `events.guest_photo_moderation`, default `false`/auto-approve). Kept as
 * its own small section (not folded into `DraftEventForm`'s own "Engagement"
 * card, which owns the separate Guest Photo Wall on/off toggle) because it
 * has its own dedicated post-creation route and setting, matching the
 * existing Engagement tab's terminology.
 */
export function EventEngagementAttachSection({ value, onChange }: EventEngagementAttachSectionProps) {
  return (
    <details className="ec-accordion">
      <summary>
        <div className="ec-section-card-heading">
          <span className="ec-section-icon-chip ec-section-icon-chip--optional">
            <Images size={16} />
          </span>
          <div>
            <div className="ec-section-card-title">Guest Memories</div>
            <div className="ec-section-card-sub">Moderation for guest-submitted photos</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`ec-status-pill ${value ? "ec-status-pill--configured" : "ec-status-pill--optional"}`}>
            {value ? "Manual approval on" : "Optional"}
          </span>
          <ChevronDown size={18} className="ec-accordion-chevron" />
        </div>
      </summary>
      <div className="ec-accordion-body">
        <label style={{ display: "inline-flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
          <span className="ec-toggle">
            <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
            <span className="ec-toggle-slider" />
          </span>
          <span style={{ fontSize: "14px", fontWeight: 600 }}>Require manual approval before guest-submitted photos appear</span>
        </label>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
          Off by default (guest photos appear immediately). Turn this on if you&rsquo;d rather review each one first —
          you can change this anytime from the Engagement tab.
        </p>
      </div>
    </details>
  );
}
