import { PlatformShell } from "./_components/PlatformShell";

/**
 * Platform Console root layout — a distinct route/layout tree from
 * `(admin-v2)`, not a route group nested inside it, precisely because it
 * must not inherit that group's `requireAdmin()`/studio-membership-bound
 * auth flow. See `PlatformShell` for the full rationale.
 */
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <PlatformShell>{children}</PlatformShell>;
}
