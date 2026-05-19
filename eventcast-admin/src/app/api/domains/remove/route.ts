import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';
import { cfDeleteCustomHostname } from '@/lib/cloudflare';

export const runtime = 'edge';

export async function DELETE(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { studioId } = auth;

  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: 'Server configuration error: Admin client not initialized' },
      { status: 500 }
    );
  }

  // ── 1. Parse domainId from body ────────────────────────────────────────────
  let domainId: string;
  try {
    const body = await req.json();
    domainId = (body?.domainId ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!domainId) {
    return NextResponse.json({ error: 'domainId is required' }, { status: 400 });
  }

  // ── 2. Fetch the domain row (scoped to this studio) ────────────────────────
  const { data: domainRow, error: fetchErr } = await supabaseAdmin
    .from('studio_domains')
    .select('id, domain, cloudflare_hostname_id')
    .eq('id', domainId)
    .eq('studio_id', studioId)
    .single();

  if (fetchErr || !domainRow) {
    return NextResponse.json({ error: 'Domain not found' }, { status: 404 });
  }

  // ── 3. Remove from Cloudflare (best-effort — don't block on failure) ───────
  if (domainRow.cloudflare_hostname_id) {
    try {
      await cfDeleteCustomHostname(domainRow.cloudflare_hostname_id as string);
    } catch (err: unknown) {
      // Log and continue — the DB row must still be deleted so the user
      // can re-try adding the domain later. CF orphans can be cleaned manually.
      console.error(
        `[domains/remove] CF delete failed for hostname ${domainRow.cloudflare_hostname_id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // ── 4. Delete from studio_domains ──────────────────────────────────────────
  const { error: deleteErr } = await supabaseAdmin
    .from('studio_domains')
    .delete()
    .eq('id', domainId);

  if (deleteErr) {
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
