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
    // 1. Fetch subscription details
    let { data: subscription, error } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('studio_id', studioId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 2. Lazy initialize subscription if it doesn't exist yet
    if (!subscription) {
      const { data: newSubscription, error: initError } = await supabaseAdmin
        .from('subscriptions')
        .insert({
          studio_id: studioId,
          plan_tier: 'free',
          status: 'active'
        })
        .select('*')
        .single();

      if (initError) {
        return NextResponse.json({ error: initError.message }, { status: 500 });
      }

      subscription = newSubscription;
    }

    return NextResponse.json({
      success: true,
      subscription
    });
  } catch (err: any) {
    console.error('Wallet Subscription API Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

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
    const { plan_tier } = await req.json();

    if (!['free', 'pay_per_event', 'pro', 'agency'].includes(plan_tier)) {
      return NextResponse.json({ error: 'Invalid plan tier requested' }, { status: 400 });
    }

    // Determine the cost in paise
    let planCostPaise = 0;
    let planDisplayName = 'Free Tier';
    
    if (plan_tier === 'pro') {
      planCostPaise = 499900; // ₹4,999.00
      planDisplayName = 'Professional Studio';
    } else if (plan_tier === 'agency') {
      planCostPaise = 999900; // ₹9,999.00
      planDisplayName = 'Agency Partner';
    } else if (plan_tier === 'pay_per_event') {
      planCostPaise = 0; // Prepaid, free to switch to
      planDisplayName = 'Pay-Per-Event Solo';
    }

    // If it's a paid plan, verify the studio has enough wallet balance
    if (planCostPaise > 0) {
      // 1. Fetch current balance
      const { data: wallet, error: walletError } = await supabaseAdmin
        .from('wallet_balances')
        .select('balance_paise')
        .eq('studio_id', studioId)
        .maybeSingle();

      if (walletError) {
        return NextResponse.json({ error: walletError.message }, { status: 500 });
      }

      const balance = wallet ? wallet.balance_paise : 0;
      if (balance < planCostPaise) {
        return NextResponse.json({ 
          error: `Insufficient wallet balance. You need ₹${(planCostPaise / 100).toLocaleString()} to upgrade to this plan, but your wallet only has ₹${(balance / 100).toLocaleString()}. Please top up your wallet credits first!` 
        }, { status: 402 });
      }

      // 2. Deduct amount from wallet_balances
      const newBalance = balance - planCostPaise;
      const { error: deductError } = await supabaseAdmin
        .from('wallet_balances')
        .update({ balance_paise: newBalance })
        .eq('studio_id', studioId);

      if (deductError) {
        return NextResponse.json({ error: 'Failed to deduct wallet balance: ' + deductError.message }, { status: 500 });
      }

      // 3. Log the debit transaction
      const { error: txError } = await supabaseAdmin
        .from('transactions')
        .insert({
          studio_id: studioId,
          kind: 'subscription',
          amount_paise: -planCostPaise,
          status: 'completed'
        });

      if (txError) {
        console.error('Failed to log subscription transaction:', txError);
      }
    }

    // 4. Update the subscriptions table
    // Plan lasts for 30 days
    const currentPeriodStart = new Date();
    const currentPeriodEnd = new Date();
    currentPeriodEnd.setDate(currentPeriodEnd.getDate() + 30);

    const { data: updatedSub, error: subError } = await supabaseAdmin
      .from('subscriptions')
      .upsert({
        studio_id: studioId,
        plan_tier,
        status: 'active',
        current_period_start: currentPeriodStart.toISOString(),
        current_period_end: currentPeriodEnd.toISOString(),
        cancel_at_period_end: false,
        updated_at: new Date().toISOString()
      })
      .select('*')
      .single();

    if (subError) {
      return NextResponse.json({ error: 'Failed to update subscription: ' + subError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      subscription: updatedSub,
      message: `Successfully upgraded to ${planDisplayName} plan!`
    });
  } catch (err: any) {
    console.error('Subscription Upgrade API Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
