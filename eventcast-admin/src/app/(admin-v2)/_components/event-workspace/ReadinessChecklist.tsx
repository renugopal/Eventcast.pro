"use client";

import Link from "next/link";
import { Check, Circle, Info } from "lucide-react";
import {
  READINESS_TIER_LABELS,
  type ReadinessItem,
  type ReadinessTier,
} from "@/lib/eventReadiness";

/**
 * Overview tab readiness checklist (Provider Event Workspace Premium
 * Redesign). Reuses the existing `.ec-status-pill`/`.ec-card` visual
 * language from the Create Event redesign rather than inventing a new
 * component system. Required/Recommended items can show "needs attention";
 * Optional items never do — they only ever show complete/not-added, so an
 * unused optional module (Baseline V2.1 §5) never reads as a blocker.
 */

const TIER_ORDER: ReadinessTier[] = ["required", "recommended", "optional"];

function StatusPill({ state }: { state: ReadinessItem["state"] }) {
  if (state === "complete") {
    return (
      <span className="ec-status-pill ec-status-pill--complete">
        <Check size={11} /> Done
      </span>
    );
  }
  if (state === "attention") {
    return <span className="ec-status-pill ec-status-pill--required">Needs attention</span>;
  }
  return <span className="ec-status-pill ec-status-pill--optional">Not added</span>;
}

interface ReadinessChecklistProps {
  eventId: string;
  items: ReadinessItem[];
}

export function ReadinessChecklist({ eventId, items }: ReadinessChecklistProps) {
  return (
    <div className="flex flex-col gap-4">
      {TIER_ORDER.map((tier) => {
        const tierItems = items.filter((item) => item.tier === tier);
        if (tierItems.length === 0) return null;
        return (
          <div key={tier} className="flex flex-col gap-2">
            <div className="flex items-center gap-2" style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {tier === "optional" && <Info size={12} />}
              {READINESS_TIER_LABELS[tier]}
              {tier === "optional" && <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: "normal" }}>— never blocks anything</span>}
            </div>
            <div className="flex flex-col gap-2">
              {tierItems.map((item) => (
                <div
                  key={item.id}
                  className="ec-card ec-card-sm"
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", minWidth: 0 }}>
                    {item.state === "complete" ? (
                      <Check size={16} style={{ color: "var(--success, #16a34a)", flexShrink: 0, marginTop: "2px" }} />
                    ) : (
                      <Circle size={16} style={{ color: "var(--text-tertiary)", flexShrink: 0, marginTop: "2px" }} />
                    )}
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: 600 }}>{item.label}</div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{item.detail}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                    <StatusPill state={item.state} />
                    <Link href={`/events/${eventId}/${item.actionTab}`} className="ec-btn ec-btn-secondary ec-btn-sm">
                      {item.actionLabel}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
