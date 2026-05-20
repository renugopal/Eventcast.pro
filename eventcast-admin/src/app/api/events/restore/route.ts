import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'edge';

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await req.json();

    if (!supabaseAdmin) {
      throw new Error("Supabase Admin client is not configured");
    }

    const { error } = await supabaseAdmin
      .from('events')
      .update({ archived_at: null })
      .eq('id', id);

    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, message: "Event restored successfully" });

  } catch (error: any) {
    console.error("Restore Endpoint Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
