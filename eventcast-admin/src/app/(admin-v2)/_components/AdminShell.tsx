"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { AdminAuthContext, useAdminAuthResolver } from "../_lib/useAdminAuth";
import { visibleNavItems } from "../_lib/nav";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";

interface AdminShellProps {
  children: React.ReactNode;
}

export function AdminShell({ children }: AdminShellProps) {
  const router = useRouter();
  const auth = useAdminAuthResolver();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  // Protected content must never render before authentication resolves —
  // this branch covers both the loading and unauthenticated-redirect states.
  if (auth.status !== "authenticated") {
    return (
      <div className="ec-layout" style={{ alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "var(--text-secondary)", fontSize: "14px", fontWeight: 600 }}>
          {auth.status === "loading" ? "Loading your studio…" : "Redirecting to login…"}
        </p>
      </div>
    );
  }

  const { context } = auth;

  return (
    <AdminAuthContext.Provider value={context}>
      <div className="ec-layout">
        <Sidebar
          items={visibleNavItems(context.isSuperAdmin)}
          isMobileOpen={isMobileOpen}
          setIsMobileOpen={setIsMobileOpen}
          isSuperAdmin={context.isSuperAdmin}
          onSignOut={handleSignOut}
        />
        <div className="ec-main">
          <Header
            studioSlug={context.studioSlug}
            platformRole={context.platformRole}
            onOpenMobileNav={() => setIsMobileOpen(true)}
          />
          <main className="ec-content">{children}</main>
        </div>
      </div>
    </AdminAuthContext.Provider>
  );
}
