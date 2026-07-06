/**
 * Edge-safe rate-limiting helpers backed by the `check_rate_limit` Postgres
 * RPC (migration 0010). Used by public routes that must throttle abuse
 * without a login (e.g. the guest photo wall).
 */

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

export function getClientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip');
  if (cf) return cf;
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const xr = req.headers.get('x-real-ip');
  if (xr) return xr;
  return '0.0.0.0';
}

export async function hashIp(ip: string): Promise<string> {
  const buf = new TextEncoder().encode(ip);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Returns true if the request is within the limit (allowed), false if it has
 * exceeded the limit (should be rejected). On an RPC/infrastructure error we
 * FAIL OPEN (return true) so a transient DB issue cannot take down a public
 * flow such as a live event's guest photo wall — matching the existing
 * sales-chat rate-limit behavior. A definitive over-limit result fails closed.
 */
export async function enforceRateLimit(
  db: RpcClient,
  ipHash: string,
  endpoint: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  try {
    const { data, error } = await db.rpc('check_rate_limit', {
      p_ip_hash: ipHash,
      p_endpoint: endpoint,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error('[rateLimit] check_rate_limit RPC error:', error);
      return true; // fail open on infra error
    }
    return data !== false;
  } catch (err) {
    console.error('[rateLimit] check_rate_limit threw:', err);
    return true; // fail open
  }
}
