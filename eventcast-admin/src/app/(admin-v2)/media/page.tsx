"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { authFetch } from "@/lib/client-auth";
import { fetchMediaLibrary, type MediaLibraryItem, type MediaLibraryTotals } from "@/lib/mediaEngagementClient";

/**
 * Provider-level global Media Library (Baseline MED-001). Read-only
 * overview of every non-archived event's media state, with each row
 * linking into that event's real Media tab where uploads/removal/reorder
 * actually happen — this page never uploads or mutates anything itself, so
 * there is only one place media assignment logic lives.
 */
export default function AdminV2MediaLibraryPage() {
  const [items, setItems] = useState<MediaLibraryItem[] | null>(null);
  const [totals, setTotals] = useState<MediaLibraryTotals | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchMediaLibrary(authFetch);
        if (cancelled) return;
        setItems(data.items);
        setTotals(data.totals);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="ec-section-header">
        <div>
          <h1 className="ec-page-title">Media Library</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "4px" }}>
            SEO thumbnails, Invitation Videos, and Photo Slideshows across every event. Recordings and replay assets
            appear here once the Livestream/VOD lifecycle is built.
          </p>
        </div>
      </div>

      {error && (
        <div className="ec-card" style={{ borderColor: "#FECDD3", color: "var(--error)", fontSize: "13px" }}>
          {error}
        </div>
      )}

      {totals && (
        <div className="ec-card" style={{ display: "flex", gap: "24px", flexWrap: "wrap", fontSize: "13px" }}>
          <span>{totals.eventsWithThumbnail} event(s) with a thumbnail</span>
          <span>{totals.eventsWithInvitationVideo} event(s) with an invitation video</span>
          <span>{totals.totalSlideshowImages} slideshow image(s) total</span>
        </div>
      )}

      {items === null ? (
        <div className="ec-card" style={{ textAlign: "center", color: "var(--text-secondary)" }}>
          Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="ec-card" style={{ textAlign: "center", color: "var(--text-secondary)" }}>
          No events yet.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <Link
              key={item.eventId}
              href={`/events/${item.eventId}/media`}
              className="ec-card"
              style={{ display: "flex", alignItems: "center", gap: "12px", textDecoration: "none", color: "inherit" }}
            >
              {item.thumbnailUrl ? (
                <img
                  src={item.thumbnailUrl}
                  alt=""
                  style={{ width: "56px", height: "40px", objectFit: "cover", borderRadius: "6px", flexShrink: 0 }}
                />
              ) : (
                <div
                  style={{
                    width: "56px",
                    height: "40px",
                    borderRadius: "6px",
                    background: "var(--surface-secondary, #f1f5f9)",
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "14px", fontWeight: 600 }}>{item.eventName}</div>
                <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                  {item.hasInvitationVideo ? "Invitation video · " : ""}
                  {item.slideshowImageCount} slideshow image{item.slideshowImageCount === 1 ? "" : "s"}
                </div>
              </div>
              <span className="ec-badge">{item.pageState || "draft"}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
