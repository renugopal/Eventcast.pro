"use client";

import { useParams } from "next/navigation";
import { EventWorkspaceShell } from "../../_components/event-workspace/EventWorkspaceShell";

/**
 * Shared layout for the whole Event Workspace (V2.1 Milestone G): every tab
 * route under `events/[eventId]/*` renders inside this one shell, which
 * loads the event once by its stable UUID and provides the tab navigation.
 */
export default function EventWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ eventId: string }>();
  return <EventWorkspaceShell eventId={params.eventId}>{children}</EventWorkspaceShell>;
}
