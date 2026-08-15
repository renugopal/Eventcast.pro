"use client";

import { useMemo, useState } from "react";
import { Lock, MapPin, Pencil, Plus, Trash2, User } from "lucide-react";
import { PARTNER_TYPES, type PartnerType } from "@/lib/partnerFields";
import {
  EMPTY_PARTNER_FORM,
  filterPartners,
  partnerFormToPayload,
  partnerToFormValues,
  type PartnerFormValues,
  type PartnerRecord,
  type PartnerWritableFields,
} from "@/lib/partnerCreditClient";

interface PartnerDirectoryProps {
  partners: PartnerRecord[];
  isLoading: boolean;
  error: string | null;
  /** owner/admin may mutate; member is read-only. Server enforces this too. */
  canManage: boolean;
  onCreate: (payload: PartnerWritableFields) => Promise<void>;
  onUpdate: (partnerId: string, payload: PartnerWritableFields) => Promise<void>;
  onDelete: (partnerId: string) => Promise<void>;
}

function labelForPartnerType(type: PartnerType): string {
  return type
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

const TEXT_FIELDS: { key: keyof PartnerFormValues; label: string; placeholder?: string }[] = [
  { key: "contactPerson", label: "Contact person" },
  { key: "phone", label: "Phone" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "city", label: "City" },
];

const URL_FIELDS: { key: keyof PartnerFormValues; label: string; placeholder: string }[] = [
  { key: "websiteUrl", label: "Website URL", placeholder: "https://example.com" },
  { key: "instagramUrl", label: "Instagram URL", placeholder: "https://instagram.com/…" },
  { key: "facebookUrl", label: "Facebook URL", placeholder: "https://facebook.com/…" },
  { key: "youtubeUrl", label: "YouTube URL", placeholder: "https://youtube.com/…" },
];

/**
 * Account-level Partner / Client master-data directory (Baseline V2.1
 * PART-001/PART-002/PART-003). Editing a Partner here changes the reusable
 * master record only — it never rewrites an already-published event's frozen
 * Event Credit snapshot.
 *
 * This component never calls an API directly; the page owns the data layer.
 */
export function PartnerDirectory({
  partners,
  isLoading,
  error,
  canManage,
  onCreate,
  onUpdate,
  onDelete,
}: PartnerDirectoryProps) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<PartnerType | "">("");

  const [formMode, setFormMode] = useState<"closed" | "create" | { editingId: string }>("closed");
  const [form, setForm] = useState<PartnerFormValues>(EMPTY_PARTNER_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const visiblePartners = useMemo(() => {
    const searched = filterPartners(partners, query);
    return typeFilter ? searched.filter((p) => p.partner_type === typeFilter) : searched;
  }, [partners, query, typeFilter]);

  const isFormOpen = formMode !== "closed";
  const editingId = typeof formMode === "object" ? formMode.editingId : null;

  function setField(key: keyof PartnerFormValues, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openCreate() {
    setForm(EMPTY_PARTNER_FORM);
    setFormError(null);
    setFormMode("create");
  }

  function openEdit(partner: PartnerRecord) {
    setForm(partnerToFormValues(partner));
    setFormError(null);
    setFormMode({ editingId: partner.id });
  }

  function closeForm() {
    setFormMode("closed");
    setFormError(null);
  }

  async function handleSave() {
    if (!form.businessName.trim()) {
      setFormError("Business name is required");
      return;
    }
    setFormError(null);
    setIsSaving(true);
    try {
      const payload = partnerFormToPayload(form);
      if (editingId) {
        await onUpdate(editingId, payload);
      } else {
        await onCreate(payload);
      }
      closeForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(partner: PartnerRecord) {
    setDeletingId(partner.id);
    setDeleteError(null);
    try {
      await onDelete(partner.id);
    } catch (err) {
      // A 409 here is the expected "still credited on an event" conflict; the
      // server's own explanatory message is shown rather than a generic error.
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="ec-card space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="ec-label">Search</label>
            <input
              className="ec-input w-full"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Business name, contact person, or city"
              disabled={isLoading}
            />
          </div>
          <div>
            <label className="ec-label">Partner type</label>
            <select
              className="ec-input w-full"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as PartnerType | "")}
              disabled={isLoading}
            >
              <option value="">All types</option>
              {PARTNER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {labelForPartnerType(t)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {canManage && !isFormOpen && (
          <button type="button" className="ec-btn ec-btn-primary ec-btn-sm" onClick={openCreate}>
            <Plus size={14} /> New partner
          </button>
        )}
      </div>

      {isFormOpen && canManage && (
        <div className="ec-card space-y-3">
          <h3 className="ec-section-title">{editingId ? "Edit partner" : "New partner"}</h3>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="ec-label">Partner type *</label>
              <select
                className="ec-input w-full"
                value={form.partnerType}
                onChange={(e) => setField("partnerType", e.target.value)}
              >
                {PARTNER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {labelForPartnerType(t)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="ec-label">Business name *</label>
              <input
                className="ec-input w-full"
                value={form.businessName}
                onChange={(e) => setField("businessName", e.target.value)}
                placeholder="e.g. Studio Light Photography"
              />
            </div>

            {TEXT_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="ec-label">{f.label}</label>
                <input
                  className="ec-input w-full"
                  value={form[f.key]}
                  onChange={(e) => setField(f.key, e.target.value)}
                />
              </div>
            ))}

            {URL_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="ec-label">{f.label}</label>
                <input
                  className="ec-input w-full"
                  type="url"
                  value={form[f.key]}
                  onChange={(e) => setField(f.key, e.target.value)}
                  placeholder={f.placeholder}
                />
              </div>
            ))}

            <div>
              <label className="ec-label">Logo URL</label>
              <input
                className="ec-input w-full"
                type="url"
                value={form.logoUrl}
                onChange={(e) => setField("logoUrl", e.target.value)}
                placeholder="https://…/logo.png"
              />
              <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>
                Link to an already-hosted logo image. Uploading is not available yet.
              </p>
            </div>
          </div>

          <div>
            <label className="ec-label" style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
              <Lock size={12} /> Internal notes (private)
            </label>
            <textarea
              className="ec-input w-full"
              rows={3}
              value={form.internalNotes}
              onChange={(e) => setField("internalNotes", e.target.value)}
              placeholder="Private notes for your studio only"
            />
            <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>
              Internal only. Never shown on an event page or in public Event Credits.
            </p>
          </div>

          {formError && <div style={{ fontSize: "13px", color: "var(--error)" }}>{formError}</div>}

          <div className="flex items-center gap-2">
            <button type="button" className="ec-btn ec-btn-primary ec-btn-sm" disabled={isSaving} onClick={handleSave}>
              {isSaving ? "Saving…" : editingId ? "Save changes" : "Create partner"}
            </button>
            <button type="button" className="ec-btn ec-btn-ghost ec-btn-sm" onClick={closeForm}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="ec-card" style={{ borderColor: "#FECDD3", color: "var(--error)" }}>
          Could not load partners: {error}
        </div>
      )}

      {deleteError && (
        <div className="ec-card" style={{ borderColor: "#FECDD3", color: "var(--error)" }}>
          {deleteError}
        </div>
      )}

      {isLoading ? (
        <div className="ec-card" style={{ textAlign: "center", color: "var(--text-secondary)" }}>
          Loading partners…
        </div>
      ) : partners.length === 0 ? (
        <div className="ec-card" style={{ textAlign: "center", color: "var(--text-secondary)" }}>
          {canManage
            ? "No partners yet. Create one to reuse it across your events."
            : "No partners yet."}
        </div>
      ) : visiblePartners.length === 0 ? (
        <div className="ec-card" style={{ textAlign: "center", color: "var(--text-secondary)" }}>
          No partners match this search.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visiblePartners.map((partner) => (
            <div
              key={partner.id}
              className="ec-card ec-card-sm"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                {partner.logo_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={partner.logo_url}
                    alt=""
                    width={36}
                    height={36}
                    style={{ width: "36px", height: "36px", objectFit: "contain", borderRadius: "6px" }}
                  />
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, color: "var(--foreground)" }}>{partner.business_name}</span>
                    <span className="ec-badge">{labelForPartnerType(partner.partner_type)}</span>
                  </div>
                  <div
                    style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "4px", display: "flex", gap: "12px", flexWrap: "wrap" }}
                  >
                    {partner.contact_person && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        <User size={12} /> {partner.contact_person}
                      </span>
                    )}
                    {partner.city && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        <MapPin size={12} /> {partner.city}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {canManage && (
                <div className="flex items-center gap-2">
                  <button type="button" className="ec-icon-btn" onClick={() => openEdit(partner)} aria-label="Edit partner">
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="ec-icon-btn ec-icon-btn-danger"
                    disabled={deletingId === partner.id}
                    onClick={() => handleDelete(partner)}
                    aria-label="Delete partner"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
