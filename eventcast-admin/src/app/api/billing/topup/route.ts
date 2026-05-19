import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'edge';

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

  try {
    const { amount_paise, payment_id, order_id } = await req.json();

    if (!amount_paise || amount_paise <= 0) {
      return NextResponse.json(
        { error: 'Invalid top-up amount' },
        { status: 400 }
      );
    }

    // 1. Record the transaction in the ledger
    const { data: transaction, error: txError } = await supabaseAdmin
      .from('transactions')
      .insert({
        studio_id: studioId,
        kind: 'topup',
        amount_paise: amount_paise,
        razorpay_payment_id: payment_id,
        razorpay_order_id: order_id,
        status: 'completed'
      })
      .select()
      .single();

    if (txError) {
      return NextResponse.json({ error: txError.message }, { status: 500 });
    }

    // 2. Fetch the current wallet balance to increment
    const { data: wallet, error: walletError } = await supabaseAdmin
      .from('wallet_balances')
      .select('balance_paise, lifetime_topup_paise')
      .eq('studio_id', studioId)
      .maybeSingle();

    if (walletError) {
      return NextResponse.json({ error: walletError.message }, { status: 500 });
    }

    const currentBalance = wallet ? wallet.balance_paise : 0;
    const currentLifetime = wallet ? wallet.lifetime_topup_paise : 0;

    // 3. Update or upsert the wallet balance atomically
    const { error: upsertError } = await supabaseAdmin
      .from('wallet_balances')
      .upsert({
        studio_id: studioId,
        balance_paise: currentBalance + amount_paise,
        lifetime_topup_paise: currentLifetime + amount_paise,
        updated_at: new Date().toISOString()
      });

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Wallet balance updated successfully',
      transaction
    });

  } catch (err: any) {
    console.error('Wallet Topup API Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
