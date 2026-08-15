"use client";

import { useEventWorkspace } from "../../../_components/event-workspace/EventWorkspaceShell";
import { LiveControlRoom } from "../../../_components/event-workspace/LiveControlRoom";

/**
 * Event Workspace Live tab (Livestream + YouTube + Live Control Room
 * delivery package, Baseline V2.1 Milestone H). Real provider-facing
 * control surface — see `LiveControlRoom.tsx` for the exact authoritative
 * source of every value shown.
 */
export default function EventWorkspaceLivePage() {
  const { state } = useEventWorkspace();
  if (state.status !== "ready") return null;

  return <LiveControlRoom eventId={state.event.id} pageState={state.event.page_state} />;
}
