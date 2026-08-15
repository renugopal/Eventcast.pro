"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Crown, LogOut, ShieldCheck, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PlatformAuthContext, usePlatformAuthResolver } from "../_lib/usePlatformAuth";
import { PLATFORM_NAV_ITEMS } from "../_lib/nav";

interface PlatformShellProps {
  children: React.ReactNode;
}

/**
 * The Platform Console's own shell — deliberately not `AdminShell`.
 * `AdminShell` resolves auth against `/api/auth/context`
 * (`requireAdmin()`-gated, which requires a `studio_members` row), so a
 * Super Admin with no studio membership would be redirected to `/login`
 * before ever reaching a Platform page if this reused that shell. This
 * shell resolves against `/api/platform/auth/context`
 * (`requireSuperAdmin()`-gated) instead, and never depends on studio
 * identity. It reuses the same visual system (`ec-*` classes) as the
 * Provider Console for consistency, inside the same Next.js application.
 */
export function PlatformShell({ children }: PlatformShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const auth = usePlatformAuthResolver();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (auth.status !== "authenticated") {
    return (
      <div className="ec-layout" style={{ alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "var(--text-secondary)", fontSize: "14px", fontWeight: 600 }}>
          {auth.status === "loading" ? "Loading Platform Console…" : "Redirecting to login…"}
        </p>
      </div>
    );
  }

  const { context } = auth;

  return (
    <PlatformAuthContext.Provider value={context}>
      <div className="ec-layout">
        {isMobileOpen && (
          <div
            className="ec-sidebar-overlay fixed inset-0"
            style={{ background: "rgba(0,0,0,0.40)", backdropFilter: "blur(4px)" }}
            onClick={() => setIsMobileOpen(false)}
            aria-hidden
          />
        )}

        <aside className={`ec-sidebar ${isMobileOpen ? "mobile-open" : ""}`}>
          <div className="ec-sidebar-logo">
            <div className="ec-sidebar-logo-icon">
              <ShieldCheck size={20} color="#FFF" />
            </div>
            <div>
              <div
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: "16px",
                  fontWeight: 900,
                  letterSpacing: "-0.02em",
                  color: "var(--foreground)",
                  lineHeight: 1,
                }}
              >
                EVENTCAST<span style={{ color: "var(--primary)" }}>.PRO</span>
              </div>
              <div
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  color: "var(--text-tertiary)",
                  textTransform: "uppercase",
                  marginTop: "3px",
                }}
              >
                Platform Operations
              </div>
            </div>
            {isMobileOpen && (
              <button
                type="button"
                onClick={() => setIsMobileOpen(false)}
                aria-label="Close navigation menu"
                style={{ marginLeft: "auto", padding: "4px", color: "var(--text-tertiary)", background: "none", border: "none", cursor: "pointer" }}
              >
                <X size={18} />
              </button>
            )}
          </div>

          <div style={{ padding: "10px 12px 0" }}>
            <div className="ec-super-admin-badge">
              <Crown size={13} />
              <span>Super Admin</span>
            </div>
          </div>

          <nav className="ec-sidebar-nav" style={{ marginTop: "4px" }}>
            {PLATFORM_NAV_ITEMS.map((item) => {
              // `startsWith` so a drill-down (e.g. /platform/events/<id>)
              // keeps its section highlighted, with an exact-match guard so
              // sibling sections sharing a prefix never both light up.
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`ec-nav-item ${isActive ? "active" : ""}`}
                  onClick={() => setIsMobileOpen(false)}
                >
                  <Icon size={18} className="ec-nav-icon" />
                  <span style={{ fontSize: "13px", fontWeight: isActive ? 700 : 600 }}>{item.label}</span>
                </Link>
              );
            })}
            <Link
              href="/dashboard"
              className="ec-nav-item"
              onClick={() => setIsMobileOpen(false)}
              style={{ marginTop: "8px", borderTop: "1px solid var(--border)", paddingTop: "16px" }}
            >
              <span style={{ fontSize: "13px", fontWeight: 600 }}>Back to Provider Console</span>
            </Link>
          </nav>

          <div className="ec-sidebar-footer">
            <button
              type="button"
              onClick={handleSignOut}
              title="Sign Out"
              className="ec-btn ec-btn-ghost"
              style={{ width: "100%", justifyContent: "flex-start", color: "var(--error)", borderColor: "#FECDD3" }}
            >
              <LogOut size={16} style={{ flexShrink: 0 }} />
              <span>Sign out</span>
            </button>
          </div>
        </aside>

        <div className="ec-main">
          <main className="ec-content">{children}</main>
        </div>
      </div>
    </PlatformAuthContext.Provider>
  );
}
