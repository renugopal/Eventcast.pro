"use client";

import Link from "next/link";
import { Check, Info } from "lucide-react";
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

function attentionDotClass(state: ReadinessItem["state"]): string {
  if (state === "complete") return "ec-attention-dot-success";
  if (state === "attention") return "ec-attention-dot-warning";
  return "ec-attention-dot-neutral";
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
          <div key={tier} className="ec-card ec-card-sm">
            <div className="ec-tier-label" style={{ marginBottom: "8px" }}>
              {tier === "optional" && <Info size={12} />}
              {READINESS_TIER_LABELS[tier]}
              {tier === "optional" && <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: "normal" }}>— never blocks anything</span>}
            </div>
            <div>
              {tierItems.map((item) => (
                <div key={item.id} className="ec-attention-row" style={{ flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", minWidth: 0 }}>
                    <span className={`ec-attention-dot ${attentionDotClass(item.state)}`} style={{ marginTop: "6px" }} />
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
