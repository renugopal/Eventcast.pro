-- Create transactions kind enum
DO $$ BEGIN
    CREATE TYPE transaction_kind AS ENUM ('topup', 'debit', 'refund', 'subscription');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create wallet_balances table
CREATE TABLE IF NOT EXISTS wallet_balances (
    studio_id UUID PRIMARY KEY REFERENCES studios(id) ON DELETE CASCADE,
    balance_paise INTEGER NOT NULL DEFAULT 0,
    lifetime_topup_paise INTEGER NOT NULL DEFAULT 0,
    last_event_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
    kind transaction_kind NOT NULL,
    amount_paise INTEGER NOT NULL, -- positive for credit, negative for debit
    razorpay_payment_id TEXT,
    razorpay_order_id TEXT,
    event_id UUID REFERENCES events(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    idempotency_key TEXT UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
    studio_id UUID PRIMARY KEY REFERENCES studios(id) ON DELETE CASCADE,
    plan_tier TEXT NOT NULL DEFAULT 'free', -- 'free', 'pay_per_event', 'pro', 'agency'
    razorpay_subscription_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    current_period_start TIMESTAMP WITH TIME ZONE,
    current_period_end TIMESTAMP WITH TIME ZONE,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on all 3 billing tables
ALTER TABLE wallet_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS wallet_balances_select_policy ON wallet_balances;
DROP POLICY IF EXISTS transactions_select_policy ON transactions;
DROP POLICY IF EXISTS subscriptions_select_policy ON subscriptions;

-- Add SELECT policies for members to see their own studio's billing info
CREATE POLICY wallet_balances_select_policy ON wallet_balances
    FOR SELECT USING (
        studio_id IN (SELECT studio_id FROM studio_members WHERE user_id = auth.uid())
    );

CREATE POLICY transactions_select_policy ON transactions
    FOR SELECT USING (
        studio_id IN (SELECT studio_id FROM studio_members WHERE user_id = auth.uid())
    );

CREATE POLICY subscriptions_select_policy ON subscriptions
    FOR SELECT USING (
        studio_id IN (SELECT studio_id FROM studio_members WHERE user_id = auth.uid())
    );
