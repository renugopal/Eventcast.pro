"use client";

/**
 * The Platform Console's small shared data layer.
 *
 * Deliberately minimal: typed request wrappers plus one loading hook,
 * mirroring the existing `livestreamClient.ts`/`supportNotificationClient.ts`
 * convention. No state-management library, no framework, no cache layer —
 * every Platform page is an independent read of a `requireSuperAdmin`-gated
 * route, and that is all this layer needs to express.
 *
 * Every request goes through `authFetch`, which attaches the caller's
 * Supabase session token. No Platform page ever queries Supabase directly;
 * service-role behavior stays entirely server-side.
 */

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/client-auth";

/** The shape every "no authoritative source exists" field uses. */
export interface UnavailableFact {
  available: false;
  reason: string;
}

export interface CapabilityUnavailable {
  available: false;
  reason: string;
}

async function parsePlatformResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export async function platformGet<T>(path: string): Promise<T> {
  return parsePlatformResponse<T>(await authFetch(path));
}

export async function platformSend<T>(
  path: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown
): Promise<T> {
  return parsePlatformResponse<T>(
    await authFetch(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  );
}

export type PlatformResource<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

/**
 * Loads one Platform Console endpoint. Returns a `reload` callback so
 * action-bearing pages (retention, YouTube attestation, support triage) can
 * refresh from the server rather than patching client state and drifting
 * from what the database actually says.
 */
export function usePlatformResource<T>(path: string | null): {
  resource: PlatformResource<T>;
  reload: () => void;
} {
  const [resource, setResource] = useState<PlatformResource<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    setResource({ status: "loading" });

    (async () => {
      try {
        const data = await platformGet<T>(path);
        if (!cancelled) setResource({ status: "ready", data });
      } catch (err) {
        if (!cancelled) {
          setResource({ status: "error", message: err instanceof Error ? err.message : "Request failed" });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [path, nonce]);

  return { resource, reload };
}

// ── Response types ───────────────────────────────────────────────────────

export interface PlatformStudioSummary {
  id: string;
  slug: string;
  displayName: string;
  planTier: string;
  ownerUserId: string;
  createdAt: string;
  memberCount: number;
  eventCount: number;
  eventsByLifecycle: Record<string, number>;
  retentionOverrideDays: number | null;
}

export interface PlatformStudiosResponse {
  studios: PlatformStudioSummary[];
  accountControls: CapabilityUnavailable;
}

export interface PlatformStudioDetailResponse {
  studio: {
    id: string;
    slug: string;
    displayName: string;
    planTier: string;
    ownerUserId: string;
    customDomain: string | null;
    createdAt: string;
  };
  members: { userId: string; role: string; joinedAt: string }[];
  events: {
    id: string;
    slug: string;
    pageState: string;
    eventVisibility: string;
    templateId: string | null;
    scheduledStartAt: string | null;
    lifecycleStatus: string;
  }[];
  retentionOverride: { retentionDays: number | null; updatedAt: string | null };
  supportSummary: { total: number; open: number };
  notificationSummary: { total: number; unread: number; critical: number };
}

export interface PlatformRecordingView {
  recordingState: string;
  localFinalizedAt: string | null;
  b2Bucket: string | null;
  b2ObjectKey: string | null;
  b2FinalizedAt: string | null;
  integrityVerifiedAt: string | null;
  finalizationGeneration: string | null;
  gapCount: number;
  gapStatus: string;
  finalizationFailureReason: string | null;
  youtubeFallbackUrl: string | null;
  youtubeFallbackVerified: boolean;
  youtubeChannelState: UnavailableFact;
  retentionEffectiveDays: number | null;
  retentionFrozenAt: string | null;
  retentionExpiresAt: string | null;
  retentionExpired: boolean | null;
  updatedAt: string;
}

export interface R2CleanupPlan {
  eventId: string;
  eligible: boolean;
  ineligibilityReasons: string[];
  candidateR2Prefixes: string[];
  executionAvailable: false;
  executionBlockers: string[];
  b2ObjectsExcluded: true;
}

export interface PlatformEventDetailResponse {
  event: {
    id: string;
    slug: string;
    studioId: string;
    studioSlug: string | null;
    studioDisplayName: string | null;
    pageState: string;
    eventVisibility: string;
    scheduledStartAt: string | null;
    archivedAt: string | null;
    templateId: string | null;
    youtubeUrl: string | null;
    createdAt: string;
    lifecycleStatus: string;
  };
  assignment: {
    assignedMediaNodeId: string | null;
    enabled: boolean;
    ingestPresent: boolean;
    playbackPresent: boolean;
    publishWindowStartAt: string | null;
    publishWindowEndAt: string | null;
    youtubeEnabled: boolean;
    configVersion: number;
    updatedAt: string;
    liveStatus: UnavailableFact;
    technicalStreamMetrics: UnavailableFact;
  } | null;
  activationHistory: { mediaNodeId: string; playbackId: string; activatedAt: string | null }[];
  recording: PlatformRecordingView | null;
  r2CleanupPlan: R2CleanupPlan;
  supportTickets: { id: string; subject: string; category: string; status: string; createdAt: string }[];
  notifications: {
    id: string;
    severity: string;
    notificationType: string;
    title: string;
    readAt: string | null;
    createdAt: string;
  }[];
}

export interface PlatformNodesResponse {
  nodes: {
    id: string;
    name: string;
    region: string;
    ingestHostname: string;
    status: string;
    maintenanceMode: boolean;
    hardStreamLimit: number;
    activeStreamCount: number;
    capacityRemaining: number;
    diskFreeBytes: number | null;
    r2QueueBytes: number | null;
    lastHeartbeatAt: string | null;
    heartbeatAgeMinutes: number | null;
    softwareVersion: string | null;
    configVersion: string | null;
    resourceTelemetry: UnavailableFact;
    enabledAssignmentCount: number;
  }[];
}

export interface PlatformTemplatesResponse {
  templates: {
    templateId: string;
    templateVersion: string | null;
    eventTypes: string[];
    registered: boolean;
    eventCount: number;
  }[];
  mutation: CapabilityUnavailable;
}

export interface PlatformMediaOperationsResponse {
  recordings: (PlatformRecordingView & {
    eventId: string;
    eventSlug: string | null;
    studioId: string | null;
    r2CleanupEligible: boolean;
    guestMemoryCount: number;
    guestMemoryPendingCount: number;
  })[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PlatformStorageResponse {
  storage: {
    guestPhotoCount: number;
    guestPhotoBytes: number;
    guestPhotoRowsWithoutSize: number;
    recordingsWithB2Archive: number;
    recordingsRetentionFrozen: number;
    recordingsRetentionExpired: number;
    r2CleanupEligibleCount: number;
    nodeDiskFreeBytes: number | null;
    nodeR2QueueBytes: number | null;
    r2MediaObjectBytes: UnavailableFact;
    b2ArchiveObjectBytes: UnavailableFact;
  };
}

export interface PlatformR2CleanupResponse {
  reports: (R2CleanupPlan & {
    eventSlug: string | null;
    studioId: string | null;
    recordingState: string;
    retentionExpiresAt: string | null;
  })[];
  summary: { total: number; eligible: number; notEligible: number };
  dryRunOnly: true;
  executionAvailable: false;
  executionBlockers: string[];
  b2ObjectsExcluded: true;
}

export interface PlatformSupportResponse {
  tickets: {
    id: string;
    studioId: string;
    studioSlug: string | null;
    eventId: string | null;
    subject: string;
    category: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    closedAt: string | null;
    messageCount: number;
  }[];
  page: number;
  pageSize: number;
  total: number;
  contentAccessPolicy: string;
}

export interface PlatformSupportThreadResponse {
  ticket: {
    id: string;
    studioId: string;
    eventId: string | null;
    subject: string;
    category: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    closedAt: string | null;
  };
  messages: { id: string; authorUserId: string | null; body: string; createdAt: string }[];
  accessRecorded: true;
}

export interface PlatformNotificationsResponse {
  notifications: {
    id: string;
    studioId: string;
    studioSlug: string | null;
    eventId: string | null;
    severity: string;
    notificationType: string;
    title: string;
    deduplicated: boolean;
    readAt: string | null;
    createdAt: string;
  }[];
  page: number;
  pageSize: number;
  total: number;
  outboundDelivery: UnavailableFact;
}

export interface PlatformSecurityResponse {
  platformUsers: { userId: string; platformRole: string; mobileVerified: boolean; createdAt: string }[];
  auditActivity: {
    sampleSize: number;
    mostRecentAt: string | null;
    byAction: Record<string, number>;
    byActor: Record<string, number>;
  };
  sessionControls: CapabilityUnavailable;
}

// ── Action wrappers ──────────────────────────────────────────────────────

/**
 * Reason-gated, audited read of one Support thread (ADM-007). The reason is
 * mandatory client-side too, but the server is the enforcing authority.
 */
export function accessSupportThread(ticketId: string, reason: string) {
  return platformSend<PlatformSupportThreadResponse>(
    `/api/platform/support/${encodeURIComponent(ticketId)}/access`,
    "POST",
    { reason }
  );
}

export function setSupportTicketStatus(ticketId: string, status: "open" | "closed", reason: string) {
  return platformSend<{ ticket: PlatformSupportResponse["tickets"][number] }>(
    `/api/platform/support/${encodeURIComponent(ticketId)}`,
    "PATCH",
    { status, reason }
  );
}

/** Delegates to the existing STO-008 retention-extension route and its atomic RPC. */
export function extendEventRetention(eventId: string, newExpiresAt: string, reason: string) {
  return platformSend<{ eventId: string; retentionExpiresAt: string }>(
    `/api/platform/events/${encodeURIComponent(eventId)}/retention-extension`,
    "POST",
    { newExpiresAt, reason }
  );
}

/**
 * Delegates to the existing manual Super Admin YouTube-fallback attestation
 * route (migration `0037`). There is deliberately no `verified` flag in this
 * payload — verification is implicit in an authorized Super Admin calling
 * this endpoint, and no provider action can reach it.
 */
export function verifyYoutubeFallback(eventId: string, youtubeUrl: string) {
  return platformSend<{ eventId: string; youtubeFallbackUrl: string; youtubeFallbackVerified: boolean }>(
    `/api/platform/events/${encodeURIComponent(eventId)}/youtube-fallback-verification`,
    "POST",
    { youtubeUrl }
  );
}
