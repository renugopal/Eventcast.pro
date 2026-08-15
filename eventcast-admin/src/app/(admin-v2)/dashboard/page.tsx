"use client";

import Link from "next/link";
import { PlusCircle, List } from "lucide-react";
import { useAdminAuth } from "../_lib/useAdminAuth";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  live_streamer: "Studio Admin",
  reseller: "Reseller",
};

export default function AdminV2DashboardPage() {
  const { studioSlug, platformRole } = useAdminAuth();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="ec-page-title">Dashboard</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "4px" }}>
          Studio <strong style={{ color: "var(--foreground)" }}>{studioSlug || "—"}</strong>
          {" · "}
          {ROLE_LABELS[platformRole] ?? platformRole}
        </p>
      </div>

      <div className="ec-card">
        <p style={{ color: "var(--text-secondary)", fontSize: "14px", lineHeight: 1.6, marginBottom: "16px" }}>
          Admin V2 is now the provider console: <code>/</code> resolves here. The legacy admin
          console has been retired, and every capability below is reached from this navigation.
        </p>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <Link href="/events" className="ec-btn ec-btn-secondary">
            <List size={16} />
            View Events
          </Link>
          <Link href="/events/new" className="ec-btn ec-btn-primary">
            <PlusCircle size={16} />
            Create Event
          </Link>
        </div>
      </div>
    </div>
  );
}
