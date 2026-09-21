"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import type { NextAction } from "@/lib/eventReadiness";

/**
 * Overview tab "what's the next useful click" card. Deliberately never a
 * one-click Publish action — a Draft's action always routes to the Event
 * Page tab's existing controlled Publish section, which requires an
 * explicit Public/Unlisted choice.
 */
export function NextActionCard({ eventId, action }: { eventId: string; action: NextAction | null }) {
  if (!action) {
    return (
      <div className="ec-card" style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
        Loading next step…
      </div>
    );
  }

  return (
    <div
      className="ec-card"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "16px",
        flexWrap: "wrap",
        borderColor: action.tone === "primary" ? "var(--violet-200)" : undefined,
      }}
    >
      <span className="ec-section-icon-chip" style={{ flexShrink: 0 }}>
        <Sparkles size={18} />
      </span>
      <div style={{ minWidth: "200px", flex: "1 1 200px", display: "flex", flexDirection: "column", gap: "4px" }}>
        <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--primary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Next step
        </div>
        <div style={{ fontSize: "16px", fontWeight: 700 }}>{action.label}</div>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{action.description}</p>
      </div>
      <Link
        href={`/events/${eventId}/${action.actionTab}`}
        className={action.tone === "primary" ? "ec-btn ec-btn-primary ec-btn-sm" : "ec-btn ec-btn-secondary ec-btn-sm"}
        style={{ flexShrink: 0 }}
      >
        {action.label} <ArrowRight size={14} />
      </Link>
    </div>
  );
}
