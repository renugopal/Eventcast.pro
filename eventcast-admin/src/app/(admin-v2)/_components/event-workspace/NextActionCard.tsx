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
    <div className="ec-card space-y-2" style={{ borderColor: action.tone === "primary" ? "var(--primary)" : undefined }}>
      <div className="flex items-center gap-2" style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        <Sparkles size={13} /> Next step
      </div>
      <div style={{ fontSize: "15px", fontWeight: 700 }}>{action.label}</div>
      <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{action.description}</p>
      <Link
        href={`/events/${eventId}/${action.actionTab}`}
        className={action.tone === "primary" ? "ec-btn ec-btn-primary ec-btn-sm" : "ec-btn ec-btn-secondary ec-btn-sm"}
      >
        {action.label} <ArrowRight size={14} />
      </Link>
    </div>
  );
}
