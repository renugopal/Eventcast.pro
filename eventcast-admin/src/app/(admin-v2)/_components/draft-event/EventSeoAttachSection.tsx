"use client";

import { useRef, useState } from "react";
import { ChevronDown, Image as ImageIcon } from "lucide-react";
import { uploadToR2 } from "@/lib/uploadHelpers";

interface EventSeoAttachSectionProps {
  value: string | null;
  onChange: (value: string | null) => void;
}

/**
 * SEO/social thumbnail staging for Create Event — same upload purpose
 * (`thumbnail`) and eventual assignment route
 * (`PATCH /api/events/[eventId]/thumbnail`) the Event Page tab already uses
 * post-creation; this just lets a provider pick it before the Draft exists.
 */
export function EventSeoAttachSection({ value, onChange }: EventSeoAttachSectionProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      const [url] = await uploadToR2(dt.files, "thumbnail");
      if (!url) throw new Error("Thumbnail upload failed");
      onChange(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <details className="ec-accordion">
      <summary>
        <div className="ec-section-card-heading">
          <span className="ec-section-icon-chip ec-section-icon-chip--optional">
            <ImageIcon size={16} />
          </span>
          <div>
            <div className="ec-section-card-title">SEO / Social</div>
            <div className="ec-section-card-sub">Share preview image</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`ec-status-pill ${value ? "ec-status-pill--configured" : "ec-status-pill--optional"}`}>
            {value ? "Added" : "Optional"}
          </span>
          <ChevronDown size={18} className="ec-accordion-chevron" />
        </div>
      </summary>
      <div className="ec-accordion-body">
        <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "-4px" }}>
          Used as this event&rsquo;s social/share preview image (og:image / twitter:image). Optional.
        </p>

        {value ? (
          <div className="flex flex-col gap-2" style={{ alignItems: "flex-start" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value}
              alt="Thumbnail preview"
              style={{ maxWidth: "240px", maxHeight: "160px", borderRadius: "12px", border: "1px solid var(--border)" }}
            />
            <button type="button" className="ec-btn ec-btn-secondary ec-btn-sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
              {uploading ? "Uploading…" : "Replace thumbnail"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="ec-upload-zone w-full"
            style={{ cursor: "pointer" }}
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            <span className="ec-upload-zone-icon">
              <ImageIcon size={18} />
            </span>
            <span style={{ textAlign: "left" }}>
              <span style={{ display: "block", fontSize: "14px", fontWeight: 600, color: "var(--foreground)" }}>
                {uploading ? "Uploading…" : "Upload thumbnail"}
              </span>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Recommended: a clear, landscape image</span>
            </span>
          </button>
        )}
        <input ref={inputRef} type="file" accept="image/*" onChange={handleSelect} style={{ display: "none" }} />
        {error && <div style={{ fontSize: "13px", color: "var(--error)" }}>{error}</div>}
      </div>
    </details>
  );
}
