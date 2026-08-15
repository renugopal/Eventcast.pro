"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/client-auth";
import {
  canManagePartners,
  createPartner,
  deletePartner,
  fetchPartners,
  updatePartner,
  type PartnerRecord,
  type PartnerWritableFields,
} from "@/lib/partnerCreditClient";
import { useAdminAuth } from "../_lib/useAdminAuth";
import { PartnerDirectory } from "../_components/partners/PartnerDirectory";

/**
 * Standalone account-level "Partners and Clients" directory (Baseline V2.1
 * PART-001/PART-002). Reusable Partner master records, maintained
 * independently of any event, against the existing Partner CRUD API.
 *
 * owner/admin may create, edit, and delete; member sees the directory
 * read-only. The server enforces that rule — this page reflects it.
 */
export default function AdminV2PartnersPage() {
  const { studioMemberRole } = useAdminAuth();
  const canManage = canManagePartners(studioMemberRole);

  const [partners, setPartners] = useState<PartnerRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPartners = useCallback(async () => {
    setError(null);
    try {
      setPartners(await fetchPartners(authFetch));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPartners();
  }, [loadPartners]);

  // Each mutation reloads the list so the directory always reflects what the
  // server actually stored, rather than a locally reconstructed row.
  const handleCreate = useCallback(
    async (payload: PartnerWritableFields) => {
      await createPartner(authFetch, payload);
      await loadPartners();
    },
    [loadPartners]
  );

  const handleUpdate = useCallback(
    async (partnerId: string, payload: PartnerWritableFields) => {
      await updatePartner(authFetch, partnerId, payload);
      await loadPartners();
    },
    [loadPartners]
  );

  const handleDelete = useCallback(
    async (partnerId: string) => {
      await deletePartner(authFetch, partnerId);
      await loadPartners();
    },
    [loadPartners]
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="ec-section-header">
        <div>
          <h1 className="ec-page-title">Partners and Clients</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "4px" }}>
            Reusable photographers, studios, event managers, clients, and venues you can credit on any event.
            {canManage ? "" : " Your studio role gives you read-only access here."}
          </p>
        </div>
      </div>

      <PartnerDirectory
        partners={partners}
        isLoading={isLoading}
        error={error}
        canManage={canManage}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
    </div>
  );
}
