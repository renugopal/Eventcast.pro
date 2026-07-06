import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'edge';

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  // No verified payment-provider integration exists yet. Fail closed: never
  // trust client-supplied amount_paise/payment_id/order_id, never record a
  // transaction, and never change a wallet balance.
  return NextResponse.json(
    { error: 'Wallet top-ups are temporarily unavailable while secure payment verification is being implemented.' },
    { status: 503 }
  );
}
