import { redirect } from "next/navigation";

/**
 * Root/provider entry point — Milestone O cutover.
 *
 * This route previously rendered the legacy single-file Admin dashboard
 * (one large Client Component driven by local tab state). That legacy UI is
 * retired; the provider experience is the route-based Admin V2 surface in the
 * `(admin-v2)` route group.
 *
 * `/` now resolves straight to the V2 Dashboard. Authentication is NOT
 * decided here and is deliberately unchanged: `/dashboard` renders inside
 * `AdminShell`, which resolves the studio session and redirects an
 * unauthenticated visitor to `/login` exactly as it already did for every
 * other V2 route. Super Admin routing (`/platform/*`) has its own shell and
 * `requireSuperAdmin()`-gated APIs and is untouched by this redirect.
 */
export default function RootPage() {
  redirect("/dashboard");
}
