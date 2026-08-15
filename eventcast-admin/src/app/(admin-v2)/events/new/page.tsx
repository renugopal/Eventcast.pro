"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authFetch, AuthError } from "@/lib/client-auth";
import {
  attachQueuedCreditsSequentially,
  createPartner,
  fetchPartners,
  type PartnerRecord,
  type QueuedCredit,
} from "@/lib/partnerCreditClient";
import { DraftEventForm, type DraftEventFormValues } from "../../_components/draft-event/DraftEventForm";
import { PartnerCreditSection, type DisplayCredit } from "../../_components/draft-event/PartnerCreditSection";

const EMPTY_VALUES: DraftEventFormValues = {
  groomName: "",
  brideName: "",
  scheduledStartAtLocal: "",
  venueName: "",
  slug: "",
};

function queuedToDisplay(credits: QueuedCredit[]): DisplayCredit[] {
  return credits.map((c) => ({
    id: c.tempId,
    partnerId: c.partnerId,
    partnerLabel: c.partnerLabel,
    roleLabel: c.roleLabel,
    isPrimary: c.isPrimary,
  }));
}

/**
 * The authoritative Draft-safe Create Event route (V2.1 Route-Based Draft
 * Event Foundation, Milestone D). Wedding + `wedding-template-01` (TLF-001)
 * only. Posts to `/api/events/draft` — never `/api/events/generate` — so
 * creating a Draft can never trigger billing, YouTube, media upload, SRS,
 * Media Agent activation, Restreamer, or public publishing.
 */
export default function AdminV2NewEventPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [partners, setPartners] = useState<PartnerRecord[]>([]);
  const [partnersLoading, setPartnersLoading] = useState(true);
  const [partnersError, setPartnersError] = useState<string | null>(null);
  const [queuedCredits, setQueuedCredits] = useState<QueuedCredit[]>([]);

  // Set only when the Draft was created but one or more queued credits
  // failed to attach — the Draft itself is never rolled back, so this stays
  // visible with a link into the created Event instead of navigating away.
  const [partialSuccess, setPartialSuccess] = useState<{ eventId: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await fetchPartners(authFetch);
        if (!cancelled) setPartners(list);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof AuthError) {
          router.push("/login");
          return;
        }
        setPartnersError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setPartnersLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit(values: DraftEventFormValues) {
    setIsSubmitting(true);
    setSubmitError(null);
    setPartialSuccess(null);
    try {
      const res = await authFetch("/api/events/draft", {
        method: "POST",
        body: JSON.stringify({
          eventType: "Wedding",
          templateId: "wedding-template-01",
          ...values,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Draft creation failed");
      }
      const eventId = data.id as string;

      if (queuedCredits.length > 0) {
        const { failures } = await attachQueuedCreditsSequentially(authFetch, eventId, queuedCredits);
        if (failures.length > 0) {
          setPartialSuccess({
            eventId,
            message: `Event created, but ${failures.length} of ${queuedCredits.length} partner credit(s) could not be attached: ${failures
              .map((f) => `${f.credit.partnerLabel} (${f.error})`)
              .join("; ")}`,
          });
          return;
        }
      }

      router.push(`/events/${eventId}/event-page`);
    } catch (err) {
      if (err instanceof AuthError) {
        router.push("/login");
        return;
      }
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="ec-section-header">
        <div>
          <h1 className="ec-page-title">New Wedding Draft</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "14px", marginTop: "4px" }}>
            Saved as a private Draft. Nothing is billed, published, or streamed until a later Publish step.
          </p>
        </div>
      </div>

      {partialSuccess && (
        <div className="ec-card" style={{ borderColor: "#FDE68A", color: "var(--text-primary, inherit)" }}>
          <p style={{ fontSize: "14px" }}>{partialSuccess.message}</p>
          <button
            type="button"
            className="ec-btn ec-btn-primary ec-btn-sm"
            style={{ marginTop: "8px" }}
            onClick={() => router.push(`/events/${partialSuccess.eventId}/event-page`)}
          >
            Continue to event
          </button>
        </div>
      )}

      <DraftEventForm
        mode="create"
        initialValues={EMPTY_VALUES}
        onSubmit={handleSubmit}
        onCancel={() => router.push("/events")}
        isSubmitting={isSubmitting}
        submitError={submitError}
      />

      <PartnerCreditSection
        partners={partners}
        partnersLoading={partnersLoading}
        partnersError={partnersError}
        credits={queuedToDisplay(queuedCredits)}
        onCreatePartner={async (payload) => {
          try {
            const created = await createPartner(authFetch, payload);
            setPartners((prev) => [...prev, created].sort((a, b) => a.business_name.localeCompare(b.business_name)));
            return created;
          } catch (err) {
            if (err instanceof AuthError) {
              router.push("/login");
            }
            throw err;
          }
        }}
        onAddCredit={async (values) => {
          if (values.isPrimary && queuedCredits.some((c) => c.isPrimary)) {
            throw new Error("Only one credit can be marked primary. Remove the existing primary credit first.");
          }
          setQueuedCredits((prev) => [
            ...prev,
            {
              tempId: `${values.partnerId}:${values.roleLabel}:${Date.now()}`,
              partnerId: values.partnerId,
              partnerLabel: values.partnerLabel,
              roleLabel: values.roleLabel,
              isPrimary: values.isPrimary,
            },
          ]);
        }}
        onUpdateCredit={async (id, values) => {
          if (values.isPrimary && queuedCredits.some((c) => c.tempId !== id && c.isPrimary)) {
            throw new Error("Only one credit can be marked primary. Remove the existing primary credit first.");
          }
          setQueuedCredits((prev) => prev.map((c) => (c.tempId === id ? { ...c, ...values } : c)));
        }}
        onRemoveCredit={async (id) => {
          setQueuedCredits((prev) => prev.filter((c) => c.tempId !== id));
        }}
      />
    </div>
  );
}
