import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  Bell,
  Calendar,
  Database,
  HardDrive,
  LayoutTemplate,
  LifeBuoy,
  Radio,
  Server,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";

export interface PlatformNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * The Super Admin Operations Console information architecture (Baseline §15).
 *
 * Order follows the Baseline's own listing — overview, accounts, events,
 * streams, nodes, templates, media, support, notifications, security/audit,
 * retention, storage — using the repository's established `/platform`
 * route boundary rather than introducing a second admin architecture.
 */
export const PLATFORM_NAV_ITEMS: PlatformNavItem[] = [
  { href: "/platform/overview", label: "Overview", icon: BarChart3 },
  { href: "/platform/studios", label: "Users & Studios", icon: Users },
  { href: "/platform/events", label: "All Events", icon: Calendar },
  { href: "/platform/streams", label: "Enabled Stream Assignments", icon: Radio },
  { href: "/platform/nodes", label: "SRS / Media Nodes", icon: Server },
  { href: "/platform/templates", label: "Templates", icon: LayoutTemplate },
  { href: "/platform/media-operations", label: "Media Operations", icon: Database },
  { href: "/platform/support", label: "Support", icon: LifeBuoy },
  { href: "/platform/notifications", label: "Notifications", icon: Bell },
  { href: "/platform/security", label: "Security", icon: ShieldCheck },
  { href: "/platform/audit-log", label: "Audit Log", icon: ShieldCheck },
  { href: "/platform/retention", label: "Retention Policies", icon: Activity },
  { href: "/platform/storage", label: "Storage", icon: HardDrive },
  { href: "/platform/r2-cleanup", label: "R2 Cleanup", icon: Trash2 },
];
