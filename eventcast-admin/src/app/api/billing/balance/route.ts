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
    // 1. Fetch balance for the studio
    let { data: wallet, error } = await supabaseAdmin
      .from('wallet_balances')
      .select('balance_paise, lifetime_topup_paise')
      .eq('studio_id', studioId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 2. Lazy initialize if no wallet exists yet
    if (!wallet) {
      const { data: newWallet, error: initError } = await supabaseAdmin
        .from('wallet_balances')
        .insert({
          studio_id: studioId,
          balance_paise: 0,
          lifetime_topup_paise: 0
        })
        .select('balance_paise, lifetime_topup_paise')
        .single();

      if (initError) {
        return NextResponse.json({ error: initError.message }, { status: 500 });
      }

      wallet = newWallet;
    }

    return NextResponse.json({
      success: true,
      balance_paise: wallet.balance_paise,
      lifetime_topup_paise: wallet.lifetime_topup_paise
    });
  } catch (err: any) {
    console.error('Wallet Balance API Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
