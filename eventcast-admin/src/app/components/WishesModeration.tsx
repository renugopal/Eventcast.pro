"use client";

import React, { useState } from "react";
import { RefreshCw, Trash2, MessageSquare } from "lucide-react";
import { AlertDialog } from "./Toast";

interface WishesModerationProps {
  wishes: any[];
  isLoadingWishes: boolean;
  fetchWishes: () => void;
  deleteWish: (id: string) => void;
}

export const WishesModeration: React.FC<WishesModerationProps> = ({
  wishes,
  isLoadingWishes,
  fetchWishes,
  deleteWish,
}) => {
  const [confirmWishId, setConfirmWishId] = useState<string | null>(null);

  const formatWhen = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="w-full space-y-8 ec-animate-in">
      <AlertDialog
        open={confirmWishId !== null}
        title="Delete this wish?"
        message="This interaction will be permanently removed from the database. This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        onConfirm={() => {
          if (confirmWishId) {
            deleteWish(confirmWishId);
            setConfirmWishId(null);
          }
        }}
        onCancel={() => setConfirmWishId(null)}
      />

      <div className="ec-section-header" style={{ marginBottom: 0 }}>
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "var(--accent-50)", color: "var(--accent)", border: "2px solid #FDE68A" }}
          >
            <MessageSquare size={22} />
          </div>
          <div>
            <h2 className="ec-page-title" style={{ fontSize: "24px" }}>Wishes Moderation</h2>
            <p className="ec-section-sub">Review and manage guest interactions</p>
          </div>
        </div>
        <button
          type="button"
          onClick={fetchWishes}
          className="ec-icon-btn"
          title="Refresh wishes"
          aria-label="Refresh wishes"
        >
          <RefreshCw size={20} className={isLoadingWishes ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Mobile: card list */}
      <div className="ec-mobile-only space-y-3">
        {wishes.length === 0 ? (
          <div className="ec-card text-center py-12" style={{ color: "var(--text-tertiary)" }}>
            No guest wishes logged yet.
          </div>
        ) : (
          wishes.map((wish) => (
            <div key={wish.id} className="ec-wish-mobile-card space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold" style={{ color: "var(--foreground)" }}>{wish.name}</p>
                  <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
                    {formatWhen(wish.created_at)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmWishId(wish.id)}
                  className="ec-icon-btn ec-icon-btn-danger shrink-0"
                  aria-label="Delete wish"
                >
                  <Trash2 size={18} />
                </button>
              </div>
              {wish.events ? (
                <span
                  className="ec-badge"
                  style={{
                    background: "var(--info-50)",
                    color: "var(--info)",
                    border: "1px solid #BFDBFE",
                  }}
                >
                  {wish.events.groom_name || wish.events.celebrant_name}
                </span>
              ) : (
                <span className="text-xs italic" style={{ color: "var(--text-tertiary)" }}>Deleted event</span>
              )}
              <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                &ldquo;{wish.message}&rdquo;
              </p>
            </div>
          ))
        )}
      </div>

      {/* Desktop: table */}
      <div className="ec-card ec-desktop-only" style={{ padding: 0, overflow: "hidden" }}>
        <div className="ec-table-scroll-hint">Swipe horizontally on smaller screens →</div>
        <div className="ec-table-scroll">
          <table className="ec-table min-w-[800px]">
            <thead>
              <tr>
                <th>Platform / Event</th>
                <th>From</th>
                <th>Message</th>
                <th>Timestamp</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {wishes.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center" style={{ padding: "48px 20px", color: "var(--text-tertiary)" }}>
                    No guest wishes logged yet.
                  </td>
                </tr>
              ) : (
                wishes.map((wish) => (
                  <tr key={wish.id}>
                    <td>
                      {wish.events ? (
                        <span
                          className="ec-badge"
                          style={{
                            background: "var(--info-50)",
                            color: "var(--info)",
                            border: "1px solid #BFDBFE",
                          }}
                        >
                          {wish.events.groom_name || wish.events.celebrant_name}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-tertiary)", fontSize: "13px", fontStyle: "italic" }}>
                          Deleted event
                        </span>
                      )}
                    </td>
                    <td style={{ fontWeight: 700 }}>{wish.name}</td>
                    <td style={{ maxWidth: "28rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                      &ldquo;{wish.message}&rdquo;
                    </td>
                    <td style={{ fontSize: "13px", color: "var(--text-tertiary)", whiteSpace: "nowrap" }}>
                      {formatWhen(wish.created_at)}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        onClick={() => setConfirmWishId(wish.id)}
                        className="ec-icon-btn ec-icon-btn-danger"
                        title="Delete wish"
                        aria-label="Delete wish"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
