"use client";

import { useParams } from "next/navigation";
import { EventWorkspaceShell } from "../../_components/event-workspace/EventWorkspaceShell";

/**
 * Shared layout for the whole Event Workspace (V2.1 Milestone G): every tab
 * route under `events/[eventId]/*` renders inside this one shell, which
 * loads the event once by its stable UUID and provides the tab navigation.
 */

// `[eventId]` is dynamic, so these tabs cannot be prerendered to static assets
// and need a request-time function. Cloudflare Pages only runs Edge Runtime
// functions, so the whole workspace segment is declared here once rather than
// repeating the same line in all seven tab pages.
export const runtime = 'edge';

export default function EventWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ eventId: string }>();
  return <EventWorkspaceShell eventId={params.eventId}>{children}</EventWorkspaceShell>;
}
