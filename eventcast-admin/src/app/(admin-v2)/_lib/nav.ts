import type { LucideIcon } from "lucide-react";
import { BarChart3, Bell, Image as ImageIcon, LayoutDashboard, LifeBuoy, List, PlusCircle, Radio, ShieldCheck, Users } from "lucide-react";

export interface AdminNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Reserved for future super_admin-only routes; unused while none exist. */
  superAdminOnly?: boolean;
}

/**
 * Only routes that actually exist belong here — this list is rendered
 * directly as sidebar links. Add an item only once its route is built.
 */
export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/events", label: "Events", icon: List },
  { href: "/events/new", label: "Create Event", icon: PlusCircle },
  { href: "/livestreams", label: "Livestreams", icon: Radio },
  { href: "/media", label: "Media", icon: ImageIcon },
  { href: "/partners", label: "Partners and Clients", icon: Users },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/support", label: "Support", icon: LifeBuoy },
  { href: "/notifications", label: "Notifications", icon: Bell },
  // Links out to the separate Platform Console (`/platform/*`), which has
  // its own layout/shell/auth context independent of studio membership —
  // see `src/app/platform/_components/PlatformShell.tsx`. This is only a
  // visibility-filtered link, not an authorization boundary: the Platform
  // Console's own `requireSuperAdmin()`-gated routes are the real guard.
  { href: "/platform/overview", label: "Platform Operations", icon: ShieldCheck, superAdminOnly: true },
];

export function visibleNavItems(isSuperAdmin: boolean): AdminNavItem[] {
  return ADMIN_NAV_ITEMS.filter((item) => !item.superAdminOnly || isSuperAdmin);
}
