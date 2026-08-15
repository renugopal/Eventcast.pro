import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireSuperAdmin } from '@/lib/superAdmin';
import { CANONICAL_TEMPLATES } from '@/lib/eventContract';
import { reconcileTemplateUsage } from '@/lib/platformOperations';

/**
 * GET /api/platform/templates — read-only operational template facts
 * (Baseline §15 "Templates"). `requireSuperAdmin`-gated.
 *
 * The authoritative registry in this repository today is
 * `CANONICAL_TEMPLATES` in `src/lib/eventContract.ts`. This route reconciles
 * it against the `template_id` values events actually reference, so an
 * unregistered id in production is visible rather than hidden.
 *
 * Deliberately read-only: no template deployment pipeline, editor, version
 * publishing path, or remote template mutation mechanism exists in the
 * Baseline or in this repository, and none is invented here. An honest
 * read-only surface is preferable to an invented write path.
 */
export const runtime = 'edge';

const db = supabaseAdmin || supabase;

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await db.from('events').select('template_id');

  if (error) {
    return NextResponse.json({ success: false, error: 'Failed to load template usage' }, { status: 500 });
  }

  const templates = reconcileTemplateUsage(
    CANONICAL_TEMPLATES,
    ((data ?? []) as { template_id: string | null }[]).map((row) => row.template_id)
  );

  return NextResponse.json({
    success: true,
    templates,
    mutation: {
      available: false,
      reason:
        'Templates are read-only in the Operations Console. No canonical template package registry with a ' +
        'deployment/publishing pipeline exists yet — CANONICAL_TEMPLATES is a source-level registry, and template ' +
        'assets are deployed with the render Worker. No remote template mutation path is invented here.',
    },
  });
}
