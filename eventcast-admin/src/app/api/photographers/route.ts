import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'edge';

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const studioId = auth.studioId;

  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('photographers')
      .select('*')
      .eq('studio_id', studioId);

    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, photographers: data || [] });
  } catch (error: any) {
    console.error("Failed to fetch photographers:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
