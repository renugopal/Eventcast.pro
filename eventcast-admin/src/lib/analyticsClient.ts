/**
 * Client-side data helpers for real Event-page + EventCast audience
 * analytics (Analytics + Provider operational/support/auth delivery
 * package). Pure request wrappers only (no JSX) — mirrors the existing
 * `livestreamClient.ts`/`mediaEngagementClient.ts` convention.
 */

export type AuthFetch = (input: string, init?: RequestInit) => Promise<Response>;

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export interface PageAnalytics {
  totalPageViews: number;
  uniqueVisitors: number;
  uniqueVisitorsCoverageNote: string | null;
  referralBreakdown: Record<string, number>;
  deviceBreakdown: Record<string, number>;
  countryBreakdown: Record<string, number>;
  wishesCount: number;
  guestMemoriesCount: number;
}

export interface AudienceAnalytics {
  currentViewers: number;
  peakConcurrentViewers: number;
  totalUniqueViewers: number;
  totalWatchTimeSeconds: number;
  averageWatchTimeSeconds: number;
  heartbeatIntervalSeconds: number;
  activeTimeoutSeconds: number;
  coverageNote: string | null;
}

export interface EventAnalytics {
  pageAnalytics: PageAnalytics;
  audienceAnalytics: AudienceAnalytics;
}

export async function fetchEventAnalytics(authFetch: AuthFetch, eventId: string): Promise<EventAnalytics> {
  const res = await authFetch(`/api/events/${eventId}/analytics`);
  const data = await parseJsonResponse<{ analytics: EventAnalytics; success: true }>(res);
  return data.analytics;
}

export interface StudioAnalyticsEventSummary {
  eventId: string;
  displayName: string;
  pageState: string | null;
  totalPageViews: number;
  uniqueVisitors: number;
  wishesCount: number;
  guestMemoriesCount: number;
  currentViewers: number;
  totalUniqueViewers: number;
}

export interface StudioAnalyticsSummary {
  events: StudioAnalyticsEventSummary[];
  totals: {
    totalPageViews: number;
    totalUniqueVisitors: number;
    totalCurrentViewers: number;
  };
}

export async function fetchStudioAnalytics(authFetch: AuthFetch): Promise<StudioAnalyticsSummary> {
  const res = await authFetch('/api/analytics');
  return parseJsonResponse<StudioAnalyticsSummary & { success: true }>(res);
}

export function formatSeconds(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0s';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (hours === 0 && seconds > 0) parts.push(`${seconds}s`);
  return parts.join(' ') || '0s';
}
