"use client";

import { useRef, useState } from "react";
import { ChevronDown, ImagePlus, Trash2, Video } from "lucide-react";
import { uploadToR2 } from "@/lib/uploadHelpers";

export interface MediaAttachValue {
  invitationVideoUrl: string | null;
  slideshowImages: string[];
}

interface EventMediaAttachSectionProps {
  value: MediaAttachValue;
  onChange: (value: MediaAttachValue) => void;
}

/**
 * Media staging for Create Event: uploads go straight to R2 (via the
 * existing `/api/r2-upload`, which only needs the authenticated studio, not
 * an event id yet) and the resulting URLs are held here until the parent
 * attaches them to the just-created Draft through the existing
 * `PATCH /api/events/[eventId]/media` — the same route and validation the
 * post-creation Media tab already uses. Deliberately does not offer
 * slideshow reordering (unlike the Media tab): initial order is upload
 * order, and full reordering stays available there after creation.
 */
export function EventMediaAttachSection({ value, onChange }: EventMediaAttachSectionProps) {
  const [videoUploading, setVideoUploading] = useState(false);
  const [imagesUploading, setImagesUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const imagesInputRef = useRef<HTMLInputElement>(null);

  const isConfigured = Boolean(value.invitationVideoUrl) || value.slideshowImages.length > 0;

  async function handleInvitationVideoUpload(files: FileList | null) {
    if (!files || !files.length) return;
    setError(null);
    setVideoUploading(true);
    try {
      const [url] = await uploadToR2(files, "video");
      if (!url) throw new Error("Upload failed");
      onChange({ ...value, invitationVideoUrl: url });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVideoUploading(false);
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  }

  async function handleSlideshowUpload(files: FileList | null) {
    if (!files || !files.length) return;
    setError(null);
    setImagesUploading(true);
    try {
      const urls = await uploadToR2(files, "gallery");
      onChange({ ...value, slideshowImages: [...value.slideshowImages, ...urls] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImagesUploading(false);
      if (imagesInputRef.current) imagesInputRef.current.value = "";
    }
  }

  function removeImage(index: number) {
    onChange({ ...value, slideshowImages: value.slideshowImages.filter((_, i) => i !== index) });
  }

  return (
    <details className="ec-accordion">
      <summary>
        <div className="ec-section-card-heading">
          <span className="ec-section-icon-chip ec-section-icon-chip--optional">
            <Video size={16} />
          </span>
          <div>
            <div className="ec-section-card-title">Media</div>
            <div className="ec-section-card-sub">Invitation video &amp; photo slideshow</div>
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
        {error && <div style={{ fontSize: "13px", color: "var(--error)" }}>{error}</div>}

        <div className="space-y-2">
          <label className="ec-label">Invitation video</label>
          {value.invitationVideoUrl ? (
            <div className="flex flex-col gap-2">
              <video src={value.invitationVideoUrl} controls style={{ maxWidth: "320px", borderRadius: "12px" }} />
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  className="ec-btn ec-btn-secondary ec-btn-sm"
                  disabled={videoUploading}
                  onClick={() => videoInputRef.current?.click()}
                >
                  {videoUploading ? "Uploading…" : "Replace video"}
                </button>
                <button
                  type="button"
                  className="ec-btn ec-btn-secondary ec-btn-sm"
                  onClick={() => onChange({ ...value, invitationVideoUrl: null })}
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="ec-upload-zone w-full"
              style={{ cursor: "pointer" }}
              disabled={videoUploading}
              onClick={() => videoInputRef.current?.click()}
            >
              <span className="ec-upload-zone-icon">
                <Video size={18} />
              </span>
              <span style={{ textAlign: "left" }}>
                <span style={{ display: "block", fontSize: "14px", fontWeight: 600, color: "var(--foreground)" }}>
                  {videoUploading ? "Uploading…" : "Upload invitation video"}
                </span>
                <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>MP4 or similar, shown on the event page</span>
              </span>
            </button>
          )}
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            style={{ display: "none" }}
            onChange={(e) => handleInvitationVideoUpload(e.target.files)}
          />
        </div>

        <div className="space-y-2">
          <label className="ec-label">Photo slideshow</label>
          {value.slideshowImages.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {value.slideshowImages.map((url, index) => (
                <div key={`${url}-${index}`} className="flex flex-col gap-1" style={{ width: "96px" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`Slideshow ${index + 1}`}
                    style={{ width: "96px", height: "72px", objectFit: "cover", borderRadius: "10px" }}
                  />
                  <button
                    type="button"
                    className="ec-btn ec-btn-secondary ec-btn-sm"
                    onClick={() => removeImage(index)}
                    aria-label="Remove image"
                    style={{ justifyContent: "center" }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            className="ec-upload-zone w-full"
            style={{ cursor: "pointer" }}
            disabled={imagesUploading}
            onClick={() => imagesInputRef.current?.click()}
          >
            <span className="ec-upload-zone-icon">
              <ImagePlus size={18} />
            </span>
            <span style={{ textAlign: "left" }}>
              <span style={{ display: "block", fontSize: "14px", fontWeight: 600, color: "var(--foreground)" }}>
                {imagesUploading ? "Uploading…" : "Add images"}
              </span>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Shown in the public page gallery</span>
            </span>
          </button>
          <input
            ref={imagesInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={(e) => handleSlideshowUpload(e.target.files)}
          />
        </div>
      </div>
    </details>
  );
}
