"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authFetch } from "@/lib/client-auth";

export interface AdminAuthContextValue {
  userId: string;
  studioId: string;
  studioSlug: string;
  /**
   * Studio membership role (`member_role_enum`). Separate from platformRole:
   * `owner`/`admin` may mutate studio-owned data, `member` is read-only.
   * Server routes enforce this — UI uses it only to render honest controls.
   */
  studioMemberRole: "owner" | "admin" | "member";
  platformRole: "super_admin" | "live_streamer" | "reseller";
  isSuperAdmin: boolean;
  /**
   * Phone-first Auth preparation (Baseline AUTH-001/AUTH-008). Sourced from
   * the Supabase Auth user itself — Supabase Auth remains the sole
   * verification authority. `phoneVerified` stays false for every account
   * until real OTP delivery is configured and completed; no "Send OTP" or
   * "OTP verified" UI should be shown based on this alone.
   */
  phone: string | null;
  phoneVerified: boolean;
}

export type AdminAuthResolution =
  | { status: "loading" }
  | { status: "authenticated"; context: AdminAuthContextValue }
  | { status: "unauthenticated" };

export const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

/**
 * Consumed by Admin V2 pages nested under AdminShell. AdminShell never
 * renders its children until resolution succeeds, so a non-null context is
 * guaranteed here — this is not itself an authorization check.
 */
export function useAdminAuth(): AdminAuthContextValue {
  const context = useContext(AdminAuthContext);
  if (!context) {
    throw new Error("useAdminAuth must be used within the Admin V2 shell");
  }
  return context;
}

/**
 * Resolves the current browser session against /api/auth/context, which is
 * itself gated server-side by requireAdmin(). This hook only drives the
 * shell's loading/redirect UX — it is not the source of authorization.
 */
export function useAdminAuthResolver(): AdminAuthResolution {
  const router = useRouter();
  const [resolution, setResolution] = useState<AdminAuthResolution>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      try {
        const res = await authFetch("/api/auth/context");
        if (cancelled) return;

        if (!res.ok) {
          setResolution({ status: "unauthenticated" });
          router.replace("/login");
          return;
        }

        const data = await res.json();
        if (!data?.success || !data?.context) {
          setResolution({ status: "unauthenticated" });
          router.replace("/login");
          return;
        }

        setResolution({ status: "authenticated", context: data.context as AdminAuthContextValue });
      } catch {
        if (cancelled) return;
        setResolution({ status: "unauthenticated" });
        router.replace("/login");
      }
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return resolution;
}
