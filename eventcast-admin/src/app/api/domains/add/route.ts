import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';
import {
  isCfConfigured,
  cfAddCustomHostname,
  cfDeleteCustomHostname,
  normalizeSslStatus,
  normalizeDnsStatus,
  buildSetupInstructions,
} from '@/lib/cloudflare';

export const runtime = 'edge';

/** Basic hostname regex — rejects raw IPs, requires at least one dot. */
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { studioId } = auth;

  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: 'Server configuration error: Admin client not initialized' },
      { status: 500 }
    );
  }

  if (!isCfConfigured()) {
    return NextResponse.json(
      { error: 'Cloudflare integration is not configured on this server' },
      { status: 503 }
    );
  }

  // ── 1. Validate request body ────────────────────────────────────────────────
  let domain: string;
  try {
    const body = await req.json();
    domain = (body?.domain ?? '').trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!domain) {
    return NextResponse.json({ error: 'domain is required' }, { status: 400 });
  }
  if (!DOMAIN_RE.test(domain)) {
    return NextResponse.json(
      { error: 'Invalid domain format. Use a valid hostname like live.yourstudio.com' },
      { status: 400 }
    );
  }

  // ── 2. Enforce plan gate (Pro / Agency only) ────────────────────────────────
  const { data: sub, error: subErr } = await supabaseAdmin
    .from('subscriptions')
    .select('plan_tier, status')
    .eq('studio_id', studioId)
    .maybeSingle();

  if (subErr) {
    return NextResponse.json({ error: 'Failed to verify subscription' }, { status: 500 });
  }

  const tier = sub?.plan_tier || 'free';
  const status = sub?.status || 'inactive';

  if ((tier !== 'pro' && tier !== 'agency') || status !== 'active') {
    return NextResponse.json(
      { error: 'Custom domains are available on Pro and Agency plans only' },
      { status: 403 }
    );
  }

  // ── 3. Check domain not already registered ──────────────────────────────────
  const { data: existing } = await supabaseAdmin
    .from('studio_domains')
    .select('id')
    .eq('domain', domain)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: 'This domain is already registered. Remove it first if you want to re-add it.' },
      { status: 409 }
    );
  }

  // ── 4. Register with Cloudflare for SaaS ───────────────────────────────────
  let cfHostname;
  try {
    cfHostname = await cfAddCustomHostname(domain);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Cloudflare registration failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // ── 5. Persist to studio_domains ───────────────────────────────────────────
  const ssl_status = normalizeSslStatus(cfHostname.ssl?.status);
  const dns_status = normalizeDnsStatus(cfHostname.status);

  const { data: domainRow, error: insertErr } = await supabaseAdmin
    .from('studio_domains')
    .insert({
      studio_id: studioId,
      domain,
      ssl_status,
      dns_status,
      cloudflare_hostname_id: cfHostname.id,
    })
    .select('id, domain, ssl_status, dns_status, cloudflare_hostname_id, created_at')
    .single();

  if (insertErr || !domainRow) {
    // Best-effort CF rollback to avoid orphaned hostnames
    try {
      await cfDeleteCustomHostname(cfHostname.id);
    } catch {
      // Rollback failed — log and move on; can be cleaned up manually
      console.error(
        `[domains/add] CF rollback failed for hostname ${cfHostname.id} after DB insert error`
      );
    }
    return NextResponse.json(
      { error: insertErr?.message ?? 'Failed to save domain' },
      { status: 500 }
    );
  }

  // ── 6. Return the domain row + DNS setup instructions ──────────────────────
  const setup = buildSetupInstructions(cfHostname);

  return NextResponse.json({ success: true, domain: domainRow, setup });
}
