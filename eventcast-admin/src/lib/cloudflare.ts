const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

// ── Cloudflare API types ──────────────────────────────────────────────────────

export interface CfSslRecord {
  txt_name: string;
  txt_value: string;
}

export interface CfCustomHostname {
  id: string;
  hostname: string;
  status: string; // 'active' | 'pending' | 'deleted' | 'blocked' | 'moved' | ...
  ssl: {
    status: string; // 'pending' | 'active' | 'active_redeploying' | 'expired' | ...
    validation_records?: CfSslRecord[];
  };
  ownership_verification?: {
    type: string;
    name: string;
    value: string;
  };
  ownership_verification_http?: {
    http_url: string;
    http_body: string;
  };
  created_at: string;
}

interface CfApiResponse<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  result: T;
}

// Structured DNS setup info returned to callers after add/status calls.
export interface DomainSetupInstructions {
  domain: string;
  /** The CNAME target tenants must point their subdomain at. */
  cnameTarget: string;
  ownershipTxtName: string | null;
  ownershipTxtValue: string | null;
  sslTxtName: string | null;
  sslTxtValue: string | null;
}

// Our simplified, DB-stored status columns.
export type DomainStatus = 'pending' | 'active' | 'failed';

// ── Internal helpers ──────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`${name} environment variable is not configured`);
  return val;
}

function cfHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${requireEnv('CLOUDFLARE_API_TOKEN')}`,
    'Content-Type': 'application/json',
  };
}

async function cfFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const zoneId = requireEnv('CLOUDFLARE_ZONE_ID');
  const res = await fetch(`${CF_API_BASE}/zones/${zoneId}${path}`, {
    ...init,
    headers: { ...cfHeaders(), ...(init?.headers as Record<string, string>) },
  });

  // DELETE returns 200 with no body on success — handle gracefully
  if (res.status === 204 || (init?.method === 'DELETE' && res.ok)) {
    return {} as T;
  }

  const json = (await res.json()) as CfApiResponse<T>;
  if (!json.success) {
    const msg = json.errors?.[0]?.message ?? 'Unknown Cloudflare API error';
    throw new Error(`Cloudflare API error: ${msg}`);
  }
  return json.result;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Register a new custom hostname in Cloudflare for SaaS.
 * Uses TXT-based DCV (Domain Control Validation) for SSL.
 */
export async function cfAddCustomHostname(domain: string): Promise<CfCustomHostname> {
  return cfFetch<CfCustomHostname>('/custom_hostnames', {
    method: 'POST',
    body: JSON.stringify({
      hostname: domain,
      ssl: {
        method: 'txt',
        type: 'dv',
        settings: { min_tls_version: '1.2' },
      },
    }),
  });
}

/**
 * Fetch the current status of a custom hostname from Cloudflare.
 */
export async function cfGetCustomHostname(hostnameId: string): Promise<CfCustomHostname> {
  return cfFetch<CfCustomHostname>(`/custom_hostnames/${hostnameId}`);
}

/**
 * Delete a custom hostname from Cloudflare for SaaS.
 * Throws if the API call fails.
 */
export async function cfDeleteCustomHostname(hostnameId: string): Promise<void> {
  await cfFetch<void>(`/custom_hostnames/${hostnameId}`, { method: 'DELETE' });
}

// ── Status normalization ──────────────────────────────────────────────────────

/**
 * Maps Cloudflare's ssl.status to our simplified three-state enum.
 */
export function normalizeSslStatus(cfStatus: string | undefined): DomainStatus {
  if (cfStatus === 'active' || cfStatus === 'active_redeploying') return 'active';
  if (
    cfStatus === 'expired' ||
    cfStatus === 'deleted' ||
    cfStatus === 'pending_deletion'
  )
    return 'failed';
  return 'pending';
}

/**
 * Maps Cloudflare's hostname status to our simplified three-state enum.
 */
export function normalizeDnsStatus(cfStatus: string | undefined): DomainStatus {
  if (cfStatus === 'active') return 'active';
  if (cfStatus === 'blocked' || cfStatus === 'moved' || cfStatus === 'deleted')
    return 'failed';
  return 'pending';
}

/**
 * Extracts human-readable DNS setup instructions from a CF hostname response.
 * The `cnameTarget` comes from the CLOUDFLARE_CNAME_TARGET env var
 * (e.g. "events.eventcast.pro" — the SaaS fallback origin).
 */
export function buildSetupInstructions(
  cfHostname: CfCustomHostname
): DomainSetupInstructions {
  const cnameTarget =
    process.env.CLOUDFLARE_CNAME_TARGET ?? 'events.eventcast.pro';

  const sslRecord = cfHostname.ssl?.validation_records?.[0] ?? null;

  return {
    domain: cfHostname.hostname,
    cnameTarget,
    ownershipTxtName: cfHostname.ownership_verification?.name ?? null,
    ownershipTxtValue: cfHostname.ownership_verification?.value ?? null,
    sslTxtName: sslRecord?.txt_name ?? null,
    sslTxtValue: sslRecord?.txt_value ?? null,
  };
}

/**
 * Returns true if the required Cloudflare env vars are present.
 * Use this as a quick guard in API routes before calling CF functions.
 */
export function isCfConfigured(): boolean {
  return (
    Boolean(process.env.CLOUDFLARE_API_TOKEN) &&
    Boolean(process.env.CLOUDFLARE_ZONE_ID)
  );
}
