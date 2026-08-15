"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { PARTNER_TYPES, type PartnerType } from "@/lib/partnerFields";
import { filterPartners, type PartnerCreatePayload, type PartnerRecord } from "@/lib/partnerCreditClient";

export interface DisplayCredit {
  id: string;
  partnerId: string;
  partnerLabel: string;
  roleLabel: PartnerType;
  isPrimary: boolean;
}

interface PartnerCreditSectionProps {
  partners: PartnerRecord[];
  partnersLoading: boolean;
  partnersError: string | null;
  credits: DisplayCredit[];
  onCreatePartner: (payload: PartnerCreatePayload) => Promise<PartnerRecord>;
  onAddCredit: (values: { partnerId: string; partnerLabel: string; roleLabel: PartnerType; isPrimary: boolean }) => Promise<void>;
  onUpdateCredit: (id: string, values: { roleLabel: PartnerType; isPrimary: boolean }) => Promise<void>;
  onRemoveCredit: (id: string) => Promise<void>;
}

function labelForPartnerType(type: PartnerType): string {
  return type
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Shared Partner Credit section for both the new-Draft flow (`credits` is a
 * local in-memory queue, no eventId yet) and the Edit/Overview flow
 * (`credits` is live-loaded from the Event Credit API). Partner search,
 * inline Partner creation, and add/edit/remove all go through the callbacks
 * so this component never talks to an API directly.
 */
export function PartnerCreditSection({
  partners,
  partnersLoading,
  partnersError,
  credits,
  onCreatePartner,
  onAddCredit,
  onUpdateCredit,
  onRemoveCredit,
}: PartnerCreditSectionProps) {
  const [query, setQuery] = useState("");
  const [selectedPartnerId, setSelectedPartnerId] = useState("");
  const [roleLabel, setRoleLabel] = useState<PartnerType>("photographer");
  const [isPrimary, setIsPrimary] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const [showInlineCreate, setShowInlineCreate] = useState(false);
  const [newPartnerType, setNewPartnerType] = useState<PartnerType>("photographer");
  const [newBusinessName, setNewBusinessName] = useState("");
  const [newContactPerson, setNewContactPerson] = useState("");
  const [newCity, setNewCity] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreatingPartner, setIsCreatingPartner] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRoleLabel, setEditRoleLabel] = useState<PartnerType>("photographer");
  const [editIsPrimary, setEditIsPrimary] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const filteredPartners = useMemo(() => filterPartners(partners, query), [partners, query]);
  const hasPrimary = credits.some((c) => c.isPrimary);
  const selectedPartner = partners.find((p) => p.id === selectedPartnerId);

  async function handleAdd() {
    if (!selectedPartnerId) {
      setAddError("Select or create a partner first");
      return;
    }
    setAddError(null);
    setIsAdding(true);
    try {
      await onAddCredit({
        partnerId: selectedPartnerId,
        partnerLabel: selectedPartner?.business_name || "",
        roleLabel,
        isPrimary,
      });
      setSelectedPartnerId("");
      setIsPrimary(false);
      setQuery("");
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAdding(false);
    }
  }

  async function handleCreatePartner() {
    if (!newBusinessName.trim()) {
      setCreateError("Business name is required");
      return;
    }
    setCreateError(null);
    setIsCreatingPartner(true);
    try {
      const created = await onCreatePartner({
        partnerType: newPartnerType,
        businessName: newBusinessName.trim(),
        contactPerson: newContactPerson.trim() || undefined,
        city: newCity.trim() || undefined,
        phone: newPhone.trim() || undefined,
      });
      setSelectedPartnerId(created.id);
      setRoleLabel(created.partner_type);
      setShowInlineCreate(false);
      setNewBusinessName("");
      setNewContactPerson("");
      setNewCity("");
      setNewPhone("");
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreatingPartner(false);
    }
  }

  function startEdit(credit: DisplayCredit) {
    setEditingId(credit.id);
    setEditRoleLabel(credit.roleLabel);
    setEditIsPrimary(credit.isPrimary);
    setEditError(null);
  }

  async function handleSaveEdit(id: string) {
    setIsSavingEdit(true);
    setEditError(null);
    try {
      await onUpdateCredit(id, { roleLabel: editRoleLabel, isPrimary: editIsPrimary });
      setEditingId(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    setRemoveError(null);
    try {
      await onRemoveCredit(id);
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="ec-card space-y-4">
      <h3 className="ec-section-title flex items-center gap-2">
        <UserPlus size={16} /> Partner Credits
      </h3>
      <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
        Credit a photographer, studio, event manager, client, venue, or other partner. One credit can be marked
        primary; the rest are additional.
      </p>

      {credits.length > 0 && (
        <div className="space-y-2">
          {credits.map((credit) => (
            <div key={credit.id} className="ec-card-sm space-y-2">
              {editingId === credit.id ? (
                <div className="space-y-2">
                  <div style={{ fontSize: "14px", fontWeight: 600 }}>{credit.partnerLabel}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      className="ec-input"
                      value={editRoleLabel}
                      onChange={(e) => setEditRoleLabel(e.target.value as PartnerType)}
                    >
                      {PARTNER_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {labelForPartnerType(t)}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1" style={{ fontSize: "13px" }}>
                      <input
                        type="checkbox"
                        checked={editIsPrimary}
                        onChange={(e) => setEditIsPrimary(e.target.checked)}
                      />
                      Primary
                    </label>
                  </div>
                  {editError && <div style={{ fontSize: "13px", color: "var(--error)" }}>{editError}</div>}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="ec-btn ec-btn-primary ec-btn-sm"
                      disabled={isSavingEdit}
                      onClick={() => handleSaveEdit(credit.id)}
                    >
                      {isSavingEdit ? "Saving…" : "Save"}
                    </button>
                    <button type="button" className="ec-btn ec-btn-ghost ec-btn-sm" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 600 }}>{credit.partnerLabel}</div>
                    <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                      {labelForPartnerType(credit.roleLabel)}
                      {credit.isPrimary && (
                        <span className="ec-badge ec-badge-amber" style={{ marginLeft: "8px" }}>
                          Primary
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" className="ec-icon-btn" onClick={() => startEdit(credit)} aria-label="Edit credit">
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="ec-icon-btn ec-icon-btn-danger"
                      disabled={removingId === credit.id}
                      onClick={() => handleRemove(credit.id)}
                      aria-label="Remove credit"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {removeError && <div style={{ fontSize: "13px", color: "var(--error)" }}>{removeError}</div>}
        </div>
      )}

      <div className="ec-divider" />

      <div className="space-y-3">
        <label className="ec-label">Search partners</label>
        <input
          className="ec-input w-full"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedPartnerId("");
          }}
          placeholder="Business name, contact person, or city"
          disabled={partnersLoading}
        />

        {partnersError && <div style={{ fontSize: "13px", color: "var(--error)" }}>{partnersError}</div>}

        {!showInlineCreate && (
          <div className="space-y-2">
            <select
              className="ec-input w-full"
              value={selectedPartnerId}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedPartnerId(id);
                const p = partners.find((x) => x.id === id);
                if (p) setRoleLabel(p.partner_type);
              }}
              disabled={partnersLoading}
            >
              <option value="">{partnersLoading ? "Loading partners…" : "Select an existing partner"}</option>
              {filteredPartners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.business_name}
                  {p.city ? ` — ${p.city}` : ""}
                </option>
              ))}
            </select>
            <button type="button" className="ec-btn ec-btn-ghost ec-btn-sm" onClick={() => setShowInlineCreate(true)}>
              <Plus size={14} /> New partner
            </button>
          </div>
        )}

        {showInlineCreate && (
          <div className="ec-card-sm space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="ec-label">Partner type</label>
                <select
                  className="ec-input w-full"
                  value={newPartnerType}
                  onChange={(e) => setNewPartnerType(e.target.value as PartnerType)}
                >
                  {PARTNER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {labelForPartnerType(t)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="ec-label">Business name</label>
                <input
                  className="ec-input w-full"
                  value={newBusinessName}
                  onChange={(e) => setNewBusinessName(e.target.value)}
                  placeholder="e.g. Studio Light Photography"
                />
              </div>
              <div>
                <label className="ec-label">Contact person</label>
                <input
                  className="ec-input w-full"
                  value={newContactPerson}
                  onChange={(e) => setNewContactPerson(e.target.value)}
                />
              </div>
              <div>
                <label className="ec-label">City</label>
                <input className="ec-input w-full" value={newCity} onChange={(e) => setNewCity(e.target.value)} />
              </div>
              <div>
                <label className="ec-label">Phone</label>
                <input className="ec-input w-full" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
              </div>
            </div>
            {createError && <div style={{ fontSize: "13px", color: "var(--error)" }}>{createError}</div>}
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="ec-btn ec-btn-primary ec-btn-sm"
                disabled={isCreatingPartner}
                onClick={handleCreatePartner}
              >
                {isCreatingPartner ? "Creating…" : "Create partner"}
              </button>
              <button
                type="button"
                className="ec-btn ec-btn-ghost ec-btn-sm"
                onClick={() => {
                  setShowInlineCreate(false);
                  setCreateError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <select className="ec-input" value={roleLabel} onChange={(e) => setRoleLabel(e.target.value as PartnerType)}>
            {PARTNER_TYPES.map((t) => (
              <option key={t} value={t}>
                {labelForPartnerType(t)}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1" style={{ fontSize: "13px" }}>
            <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
            Primary credit{hasPrimary && !isPrimary ? " (already set for another partner)" : ""}
          </label>
        </div>

        {addError && <div style={{ fontSize: "13px", color: "var(--error)" }}>{addError}</div>}

        <button type="button" className="ec-btn ec-btn-secondary" disabled={isAdding || !selectedPartnerId} onClick={handleAdd}>
          {isAdding ? "Adding…" : "Add credit"}
        </button>
      </div>
    </div>
  );
}
