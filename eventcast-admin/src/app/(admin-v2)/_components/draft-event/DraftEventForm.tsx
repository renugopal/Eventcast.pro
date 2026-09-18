"use client";

import { useState } from "react";
import { Calendar, Check, Images, MapPin, Sparkles, Users } from "lucide-react";
import { CANONICAL_TEMPLATES, computeEventSlug } from "@/lib/eventContract";
import { getTemplateFieldSupport, listCreatableTemplates } from "@/lib/templateModules";

export interface DraftEventFormValues {
  groomName: string;
  brideName: string;
  scheduledStartAtLocal: string;
  venueName: string;
  venueMapLink: string;
  slug: string;
  customTopTitle: string;
  guestPhotoWallEnabled: boolean;
}

/**
 * Whether these values (plus the resolved template) satisfy the Draft-safe
 * contract's own required-field validation (see `draftInputToCanonicalRecord`
 * in `eventContract.ts`) — shared by both the create and edit pages so the
 * submit-button gating logic isn't duplicated or allowed to drift between
 * them. Fails closed (false) for an unresolved `templateId`.
 */
export function isDraftEventFormValid(values: DraftEventFormValues, templateId: string): boolean {
  return Boolean(
    CANONICAL_TEMPLATES[templateId] &&
      values.groomName.trim() &&
      values.brideName.trim() &&
      values.scheduledStartAtLocal &&
      values.venueName.trim() &&
      values.slug.trim()
  );
}

interface DraftEventFormProps {
  mode: "create" | "edit";
  values: DraftEventFormValues;
  onChange: (values: DraftEventFormValues) => void;
  /**
   * The event's actual template id — for `create`, whatever the caller
   * resolved from `listCreatableTemplates()`; for `edit`, the Draft's own
   * stored `template_id` (never editable here, matching the server route,
   * which always reuses the stored value and ignores client input for it).
   * Drives which optional sections render via `getTemplateFieldSupport()` —
   * deliberately a required prop, not a default, so there is no silent
   * fallback to any one template.
   */
  templateId: string;
  /** Only called in create mode — edit mode has no selector, template is fixed at creation. */
  onTemplateChange?: (templateId: string) => void;
}

function StatusPill({ status }: { status: "required" | "complete" | "optional" }) {
  if (status === "complete") {
    return (
      <span className="ec-status-pill ec-status-pill--complete">
        <Check size={11} /> Complete
      </span>
    );
  }
  if (status === "required") {
    return <span className="ec-status-pill ec-status-pill--required">Required</span>;
  }
  return <span className="ec-status-pill ec-status-pill--optional">Optional</span>;
}

/**
 * The one Draft-safe Create/Edit field set for the Wedding event type — a
 * controlled, fields-only component (no `<form>` element, no submit/cancel
 * buttons, no submitting/error UI of its own). The parent page owns values
 * state, validation gating (`isDraftEventFormValid`), the actual submit
 * action(s), and the action row — `/events/new` composes this alongside
 * several other sections under one unified Cancel/Save Draft/Create Event
 * bar, while the Event Workspace's `/events/[eventId]/event-page` edit mode
 * composes it with its own Cancel/Save changes row. This keeps exactly one
 * place the field shape itself is captured, without forcing both call sites
 * into the same action semantics.
 *
 * Which optional sections render (venue map, custom headline, Guest Photo
 * Wall toggle) is template-aware via `getTemplateFieldSupport(templateId)` —
 * not hardcoded to `wedding-template-01` — so a future template can opt
 * in/out per-field without a form rewrite. Section status pills reflect
 * `isDraftEventFormValid`'s own per-field checks — never fabricated state.
 */
export function DraftEventForm({ mode, values, onChange, templateId, onTemplateChange }: DraftEventFormProps) {
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const support = getTemplateFieldSupport(templateId);
  const templateDescriptor = CANONICAL_TEMPLATES[templateId];
  const creatableTemplates = listCreatableTemplates();

  function updateField<K extends keyof DraftEventFormValues>(key: K, value: DraftEventFormValues[K]) {
    const next = { ...values, [key]: value };
    if (!slugTouched && key !== "slug" && (key === "groomName" || key === "brideName")) {
      next.slug = computeEventSlug({ groomName: next.groomName, brideName: next.brideName, eventType: "wedding" });
    }
    onChange(next);
  }

  const coupleComplete = Boolean(values.groomName.trim() && values.brideName.trim());
  const scheduleComplete = Boolean(values.scheduledStartAtLocal);
  const venueComplete = Boolean(values.venueName.trim() && values.slug.trim());

  return (
    <>
      <div className="ec-section-card ec-section-card--required space-y-4">
        <div className="ec-section-card-head">
          <div className="ec-section-card-heading">
            <span className="ec-section-icon-chip">
              <Sparkles size={16} />
            </span>
            <div>
              <div className="ec-section-card-title">Template</div>
              <div className="ec-section-card-sub">Choose the page design for this event</div>
            </div>
          </div>
          <StatusPill status={templateDescriptor ? "complete" : "required"} />
        </div>

        {mode === "create" ? (
          <div>
            <div className="ec-template-grid">
              {creatableTemplates.map((t) => (
                <button
                  key={t.templateId}
                  type="button"
                  className={`ec-template-card${templateId === t.templateId ? " selected" : ""}`}
                  onClick={() => onTemplateChange?.(t.templateId)}
                  aria-pressed={templateId === t.templateId}
                >
                  {templateId === t.templateId && (
                    <span className="ec-template-card-check">
                      <Check size={12} />
                    </span>
                  )}
                  <span className="ec-template-card-name">{t.templateId}</span>
                  <span className="ec-template-card-meta">Wedding &middot; v{t.templateVersion}</span>
                </button>
              ))}
            </div>
            {!templateDescriptor && (
              <p style={{ fontSize: "13px", color: "var(--error)", marginTop: "10px" }}>
                No template is currently available for creating new events.
              </p>
            )}
          </div>
        ) : (
          <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            {templateDescriptor ? (
              <>
                {templateDescriptor.templateId} <code>v{templateDescriptor.templateVersion}</code>
              </>
            ) : (
              <span style={{ color: "var(--error)" }}>Unknown template &ldquo;{templateId}&rdquo;</span>
            )}{" "}
            &mdash; fixed at creation, not editable here.
          </p>
        )}
      </div>

      <div className="ec-section-card ec-section-card--required space-y-4">
        <div className="ec-section-card-head">
          <div className="ec-section-card-heading">
            <span className="ec-section-icon-chip">
              <Users size={16} />
            </span>
            <div>
              <div className="ec-section-card-title">Couple</div>
              <div className="ec-section-card-sub">Who this celebration is for</div>
            </div>
          </div>
          <StatusPill status={coupleComplete ? "complete" : "required"} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
        {support.customTopTitle && (
          <div>
            <label className="ec-label">Custom headline (optional)</label>
            <input
              className="ec-input w-full"
              value={values.customTopTitle}
              onChange={(e) => updateField("customTopTitle", e.target.value)}
              placeholder="Overrides the default &ldquo;Welcome to the Wedding of…&rdquo; line"
            />
          </div>
        )}
      </div>

      <div className="ec-section-card ec-section-card--required space-y-4">
        <div className="ec-section-card-head">
          <div className="ec-section-card-heading">
            <span className="ec-section-icon-chip">
              <Calendar size={16} />
            </span>
            <div>
              <div className="ec-section-card-title">Schedule</div>
              <div className="ec-section-card-sub">Asia/Kolkata time</div>
            </div>
          </div>
          <StatusPill status={scheduleComplete ? "complete" : "required"} />
        </div>
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

      <div className="ec-section-card ec-section-card--required space-y-4">
        <div className="ec-section-card-head">
          <div className="ec-section-card-heading">
            <span className="ec-section-icon-chip">
              <MapPin size={16} />
            </span>
            <div>
              <div className="ec-section-card-title">Venue &amp; Event Link</div>
              <div className="ec-section-card-sub">Where it&rsquo;s happening, and the page URL</div>
            </div>
          </div>
          <StatusPill status={venueComplete ? "complete" : "required"} />
        </div>
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
          {support.venueMap && (
            <div>
              <label className="ec-label">Venue map link (optional)</label>
              <input
                className="ec-input w-full"
                type="url"
                value={values.venueMapLink}
                onChange={(e) => updateField("venueMapLink", e.target.value)}
                placeholder="https://maps.google.com/…"
              />
              <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>
                A Google Maps link/embed. Shown as a map section with an &ldquo;Open in Google Maps&rdquo; button.
              </p>
            </div>
          )}
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

      {support.guestEngagement && (
        <div className="ec-section-card space-y-3">
          <div className="ec-section-card-head">
            <div className="ec-section-card-heading">
              <span className="ec-section-icon-chip ec-section-icon-chip--optional">
                <Images size={16} />
              </span>
              <div>
                <div className="ec-section-card-title">Engagement</div>
                <div className="ec-section-card-sub">Guest interaction on the event page</div>
              </div>
            </div>
            <StatusPill status="optional" />
          </div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
            <span className="ec-toggle">
              <input
                type="checkbox"
                checked={values.guestPhotoWallEnabled}
                onChange={(e) => updateField("guestPhotoWallEnabled", e.target.checked)}
              />
              <span className="ec-toggle-slider" />
            </span>
            <span style={{ fontSize: "14px", fontWeight: 600 }}>Enable Guest Photo Wall</span>
          </label>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
            Lets guests upload their own photos to a shared wall on the event page. On by default.
          </p>
        </div>
      )}
    </>
  );
}
