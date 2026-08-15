"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authFetch } from "@/lib/client-auth";

/**
 * Platform Console auth context — deliberately separate from
 * `useAdminAuth`/`AdminAuthContext` (the Provider Console's own context,
 * which resolves against `/api/auth/context`, itself gated by
 * `requireAdmin()` and therefore dependent on a `studio_members` row). A
 * Super Admin with no studio membership must be able to load the Platform
 * Console, so this hook resolves against `/api/platform/auth/context`
 * (`requireSuperAdmin()`-gated) instead and never touches studio identity
 * at all.
 */
export interface PlatformAuthContextValue {
  userId: string;
  isSuperAdmin: true;
}

export type PlatformAuthResolution =
  | { status: "loading" }
  | { status: "authenticated"; context: PlatformAuthContextValue }
  | { status: "unauthenticated" };

export const PlatformAuthContext = createContext<PlatformAuthContextValue | null>(null);

export function usePlatformAuth(): PlatformAuthContextValue {
  const context = useContext(PlatformAuthContext);
  if (!context) {
    throw new Error("usePlatformAuth must be used within the Platform Console shell");
  }
  return context;
}

export function usePlatformAuthResolver(): PlatformAuthResolution {
  const router = useRouter();
  const [resolution, setResolution] = useState<PlatformAuthResolution>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      try {
        const res = await authFetch("/api/platform/auth/context");
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

        setResolution({ status: "authenticated", context: data.context as PlatformAuthContextValue });
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
