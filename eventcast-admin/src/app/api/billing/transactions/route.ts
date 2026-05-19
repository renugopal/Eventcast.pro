import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';

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

  try {
    // Fetch transactions ordered by creation date descending
    const { data: transactions, error } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('studio_id', studioId)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      transactions: transactions || []
    });
  } catch (err: any) {
    console.error('Wallet Transactions API Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
