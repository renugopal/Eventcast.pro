/**
 * Client-side data helpers for Support Tickets and the in-app Notification
 * Center (Analytics + Provider operational/support/auth delivery package).
 * Pure request wrappers only (no JSX) — mirrors the existing
 * `livestreamClient.ts`/`analyticsClient.ts` convention.
 */

export type AuthFetch = (input: string, init?: RequestInit) => Promise<Response>;

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

// ── Support Tickets ─────────────────────────────────────────────────────

export type TicketCategory = 'general' | 'urgent_live';
export type TicketStatus = 'open' | 'closed';

export interface SupportTicket {
  id: string;
  event_id: string | null;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface SupportTicketMessage {
  id: string;
  // Null once the authoring Auth user is deleted — the message and the
  // surrounding thread are deliberately preserved (migration 0034).
  author_user_id: string | null;
  body: string;
  created_at: string;
}

export async function fetchSupportTickets(authFetch: AuthFetch): Promise<SupportTicket[]> {
  const res = await authFetch('/api/support');
  const data = await parseJsonResponse<{ tickets: SupportTicket[]; success: true }>(res);
  return data.tickets;
}

export async function createSupportTicket(
  authFetch: AuthFetch,
  payload: { subject: string; message: string; category?: TicketCategory; eventId?: string | null }
): Promise<SupportTicket> {
  const res = await authFetch('/api/support', { method: 'POST', body: JSON.stringify(payload) });
  const data = await parseJsonResponse<{ ticket: SupportTicket; success: true }>(res);
  return data.ticket;
}

export async function fetchSupportTicket(
  authFetch: AuthFetch,
  ticketId: string
): Promise<{ ticket: SupportTicket; messages: SupportTicketMessage[] }> {
  const res = await authFetch(`/api/support/${ticketId}`);
  return parseJsonResponse<{ ticket: SupportTicket; messages: SupportTicketMessage[]; success: true }>(res);
}

export async function updateSupportTicketStatus(
  authFetch: AuthFetch,
  ticketId: string,
  status: TicketStatus
): Promise<SupportTicket> {
  const res = await authFetch(`/api/support/${ticketId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
  const data = await parseJsonResponse<{ ticket: SupportTicket; success: true }>(res);
  return data.ticket;
}

export async function addSupportTicketMessage(
  authFetch: AuthFetch,
  ticketId: string,
  body: string
): Promise<SupportTicketMessage> {
  const res = await authFetch(`/api/support/${ticketId}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
  const data = await parseJsonResponse<{ message: SupportTicketMessage; success: true }>(res);
  return data.message;
}

// ── Notifications ────────────────────────────────────────────────────────

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export interface NotificationRecord {
  id: string;
  event_id: string | null;
  severity: NotificationSeverity;
  notification_type: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
}

export async function fetchNotifications(authFetch: AuthFetch): Promise<NotificationRecord[]> {
  const res = await authFetch('/api/notifications');
  const data = await parseJsonResponse<{ notifications: NotificationRecord[]; success: true }>(res);
  return data.notifications;
}

export async function markNotificationRead(authFetch: AuthFetch, notificationId: string): Promise<void> {
  const res = await authFetch(`/api/notifications/${notificationId}/read`, { method: 'PATCH' });
  await parseJsonResponse(res);
}
