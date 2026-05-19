import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';
import {
  cfGetCustomHostname,
  normalizeSslStatus,
  normalizeDnsStatus,
  buildSetupInstructions,
} from '@/lib/cloudflare';

export const runtime = 'edge';

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { studioId } = auth;

  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: 'Server configuration error: Admin client not initialized' },
      { status: 500 }
    );
  }

  // ── 1. Parse domainId from query string ────────────────────────────────────
  const { searchParams } = new URL(req.url);
  const domainId = searchParams.get('domainId');

  if (!domainId) {
    return NextResponse.json({ error: 'domainId query parameter is required' }, { status: 400 });
  }

  // ── 2. Load the domain row (scoped to this studio) ─────────────────────────
  const { data: domainRow, error: fetchErr } = await supabaseAdmin
    .from('studio_domains')
    .select('id, domain, ssl_status, dns_status, cloudflare_hostname_id, created_at')
    .eq('id', domainId)
    .eq('studio_id', studioId)
    .single();

  if (fetchErr || !domainRow) {
    return NextResponse.json({ error: 'Domain not found' }, { status: 404 });
  }

  // ── 3. If no Cloudflare ID, return current DB state as-is ─────────────────
  if (!domainRow.cloudflare_hostname_id) {
    return NextResponse.json({ success: true, domain: domainRow, setup: null });
  }

  // ── 4. Poll Cloudflare for fresh status ────────────────────────────────────
  let cfHostname;
  try {
    cfHostname = await cfGetCustomHostname(domainRow.cloudflare_hostname_id as string);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Cloudflare status check failed';
    // Don't hard-fail — return stale DB data with an error note
    return NextResponse.json({ error: msg, domain: domainRow }, { status: 502 });
  }

  // ── 5. Update DB with latest status ────────────────────────────────────────
  const ssl_status = normalizeSslStatus(cfHostname.ssl?.status);
  const dns_status = normalizeDnsStatus(cfHostname.status);

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('studio_domains')
    .update({
      ssl_status,
      dns_status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', domainId)
    .select('id, domain, ssl_status, dns_status, cloudflare_hostname_id, created_at')
    .single();

  if (updateErr || !updated) {
    return NextResponse.json({ error: updateErr?.message ?? 'Status update failed' }, { status: 500 });
  }

  const setup = buildSetupInstructions(cfHostname);

  return NextResponse.json({ success: true, domain: updated, setup });
}
