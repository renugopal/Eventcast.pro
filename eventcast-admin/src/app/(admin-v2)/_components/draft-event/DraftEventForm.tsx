"use client";

import { useState } from "react";
import { Calendar, MapPin, Sparkles, Users } from "lucide-react";
import { computeEventSlug, DEFAULT_TEMPLATE_ID } from "@/lib/eventContract";

export interface DraftEventFormValues {
  groomName: string;
  brideName: string;
  scheduledStartAtLocal: string;
  venueName: string;
  slug: string;
}

interface DraftEventFormProps {
  mode: "create" | "edit";
  initialValues: DraftEventFormValues;
  onSubmit: (values: DraftEventFormValues) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  submitError: string | null;
}

/**
 * The one Draft-safe Create/Edit form for this slice: Wedding +
 * `wedding-template-01` (TLF-001) only, so the template is a fixed label,
 * not a selector. Reused by both `/events/new` and the edit mode of the
 * Event Workspace's `/events/[eventId]/event-page` tab so there is exactly
 * one place this shape is captured.
 */
export function DraftEventForm({
  mode,
  initialValues,
  onSubmit,
  onCancel,
  isSubmitting,
  submitError,
}: DraftEventFormProps) {
  const [values, setValues] = useState<DraftEventFormValues>(initialValues);
  const [slugTouched, setSlugTouched] = useState(mode === "edit");

  function updateField<K extends keyof DraftEventFormValues>(key: K, value: DraftEventFormValues[K]) {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      if (!slugTouched && key !== "slug" && (key === "groomName" || key === "brideName")) {
        next.slug = computeEventSlug({ groomName: next.groomName, brideName: next.brideName, eventType: "wedding" });
      }
      return next;
    });
  }

  const canSubmit = Boolean(
    values.groomName.trim() && values.brideName.trim() && values.scheduledStartAtLocal && values.venueName.trim() && values.slug.trim()
  );

  return (
    <form
      className="flex flex-col gap-6 py-6 max-w-2xl"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}
    >
      <div className="ec-card space-y-4">
        <h3 className="ec-section-title flex items-center gap-2">
          <Sparkles size={16} /> Template
        </h3>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          TLF-001 &middot; Wedding Template (<code>{DEFAULT_TEMPLATE_ID}</code>) &mdash; the only template supported in this Draft slice.
        </p>
      </div>

      <div className="ec-card space-y-4">
        <h3 className="ec-section-title flex items-center gap-2">
          <Users size={16} /> Couple
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="ec-label">Groom&apos;s name</label>
            <input
              className="ec-input w-full"
              value={values.groomName}
              onChange={(e) => updateField("groomName", e.target.value)}
              placeholder="Groom name"
              required
            />
          </div>
          <div>
            <label className="ec-label">Bride&apos;s name</label>
            <input
              className="ec-input w-full"
              value={values.brideName}
              onChange={(e) => updateField("brideName", e.target.value)}
              placeholder="Bride name"
              required
            />
          </div>
        </div>
      </div>

      <div className="ec-card space-y-4">
        <h3 className="ec-section-title flex items-center gap-2">
          <Calendar size={16} /> Schedule (Asia/Kolkata)
        </h3>
        <div>
          <label className="ec-label">Scheduled date &amp; time</label>
          <input
            type="datetime-local"
            className="ec-input w-full"
            value={values.scheduledStartAtLocal}
            onChange={(e) => updateField("scheduledStartAtLocal", e.target.value)}
            required
          />
        </div>
      </div>

      <div className="ec-card space-y-4">
        <h3 className="ec-section-title flex items-center gap-2">
          <MapPin size={16} /> Venue &amp; link
        </h3>
        <div className="space-y-4">
          <div>
            <label className="ec-label">Venue display name</label>
            <input
              className="ec-input w-full"
              value={values.venueName}
              onChange={(e) => updateField("venueName", e.target.value)}
              placeholder="e.g. Taj Krishna, Banjara Hills"
              required
            />
          </div>
          <div>
            <label className="ec-label">Event page link (slug)</label>
            <input
              className="ec-input w-full"
              value={values.slug}
              onChange={(e) => {
                setSlugTouched(true);
                updateField("slug", e.target.value);
              }}
              placeholder="groom-bride-wedding"
              required
            />
          </div>
        </div>
      </div>

      {submitError && (
        <div className="ec-card" style={{ borderColor: "#FECDD3", color: "var(--error)" }}>
          {submitError}
        </div>
      )}

      <div className="flex items-center justify-between">
        <button type="button" onClick={onCancel} className="ec-btn ec-btn-ghost">
          Cancel
        </button>
        <button type="submit" disabled={!canSubmit || isSubmitting} className="ec-btn ec-btn-primary">
          {isSubmitting ? "Saving…" : mode === "create" ? "Save Draft" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
