"use client";

import React, { useState, useEffect } from "react";
import {
  Wallet as WalletIcon, CreditCard, ArrowUpRight, ArrowDownRight,
  Sparkles, Zap, Check, Shield, Loader2, X, Info
} from "lucide-react";
import { authFetch } from "@/lib/client-auth";
import { useToast } from "./Toast";

interface WalletProps {
  studioId: string | null;
}

export const Wallet: React.FC<WalletProps> = ({ studioId }) => {
  const { success, error: toastError } = useToast();
  const [balance, setBalance] = useState<number>(0);
  const [lifetimeTopup, setLifetimeTopup] = useState<number>(0);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [subscription, setSubscription] = useState<any>({ plan_tier: "free", status: "active" });
  
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isTopUpOpen, setIsTopUpOpen] = useState<boolean>(false);
  const [topUpAmount, setTopUpAmount] = useState<string>("500");
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [topUpSuccess, setTopUpSuccess] = useState<boolean>(false);
  const [isUpgrading, setIsUpgrading] = useState<string | null>(null);
  
  // Billing cycle toggle: "monthly" or "yearly"
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");

  const handleUpgradePlan = async (tier: string) => {
    if (!studioId) return;
    setIsUpgrading(tier);
    try {
      const res = await authFetch("/api/billing/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_tier: tier }),
      });

      const data = await res.json();
      if (res.ok) {
        success(`Plan upgraded!`, data.message || `Successfully activated ${tier} plan.`);
        fetchBillingData();
      } else {
        toastError('Upgrade failed', data.error || 'Failed to upgrade subscription');
      }
    } catch (err) {
      console.error(err);
      toastError('Unexpected error', 'An error occurred during upgrade. Please try again.');
    } finally {
      setIsUpgrading(null);
    }
  };

  useEffect(() => {
    if (studioId) {
      fetchBillingData();
    }
  }, [studioId]);

  const fetchBillingData = async () => {
    setIsLoading(true);
    try {
      // 1. Fetch current wallet balance
      const balanceRes = await authFetch(`/api/billing/balance?studio_id=${studioId}`);
      if (balanceRes.ok) {
        const data = await balanceRes.json();
        setBalance(data.balance_paise / 100);
        setLifetimeTopup(data.lifetime_topup_paise / 100);
      }

      // 2. Fetch transactions
      const txRes = await authFetch(`/api/billing/transactions?studio_id=${studioId}`);
      if (txRes.ok) {
        const data = await txRes.json();
        setTransactions(data.transactions || []);
      }

      // 3. Fetch subscription
      const subRes = await authFetch(`/api/billing/subscription?studio_id=${studioId}`);
      if (subRes.ok) {
        const data = await subRes.json();
        setSubscription(data.subscription || { plan_tier: "free", status: "active" });
      }
    } catch (err) {
      console.error("Failed to load billing data", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSimulateTopUp = async () => {
    const amount = parseFloat(topUpAmount);
    if (isNaN(amount) || amount <= 0) return;

    setIsSimulating(true);
    try {
      const res = await authFetch("/api/billing/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studio_id: studioId,
          amount_paise: amount * 100,
          payment_id: "pay_sim_" + Math.random().toString(36).substring(2, 15),
          order_id: "order_sim_" + Math.random().toString(36).substring(2, 15),
        }),
      });

      if (res.ok) {
        setTopUpSuccess(true);
        setTimeout(() => {
          setIsTopUpOpen(false);
          setTopUpSuccess(false);
          fetchBillingData();
        }, 1500);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSimulating(false);
    }
  };

  const getTierDisplayName = (tier: string) => {
    switch (tier.toLowerCase()) {
      case "business": return "Business";
      case "pro": return "Professional";
      case "basic": return "Basic";
      case "pay_per_event": return "Pay-Per-Event";
      default: return "Free Demo Tier";
    }
  };

  if (isLoading) {
    return (
      <div className="w-full h-[60vh] flex flex-col items-center justify-center text-[var(--text-secondary)] gap-4 animate-in fade-in duration-500">
        <Loader2 className="animate-spin text-[var(--primary)]" size={40} />
        <span className="ec-section-sub">Syncing financial data…</span>
      </div>
    );
  }

  return (
    <div className="w-full pb-20 ec-animate-in ec-billing-page">
      
      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="ec-section-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="ec-page-title">Billing & Wallet</h1>
          <p className="ec-section-sub flex items-center gap-2 mt-1">
            <Shield size={14} style={{ color: "var(--success)" }} />
            Secure billing and wallet ledger
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsTopUpOpen(true)}
          className="ec-btn ec-btn-lg bg-emerald-500 hover:bg-emerald-600 text-white border-transparent"
        >
          <CreditCard size={18} /> Load wallet credits
        </button>
      </div>

      {/* ── Stats Cards ──────────────────────────────────────────────────────── */}
      <div className="ec-billing-stat-grid">
        <div className="ec-card ec-billing-stat-card">
          <div className="ec-billing-stat-top">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-emerald-50 text-emerald-600">
              <WalletIcon size={22} />
            </div>
            <span className="ec-badge" style={{ background: "var(--success-50)", color: "var(--success)", border: "1px solid #A7F3D0" }}>
              Active funds
            </span>
          </div>
          <p className="ec-label" style={{ marginBottom: 6 }}>Prepaid balance</p>
          <h3 className="text-3xl font-black text-[var(--foreground)] tracking-tight">
            ₹{balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </h3>
        </div>

        <div className="ec-card ec-billing-stat-card">
          <div className="ec-billing-stat-top">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-[var(--primary-subtle)] text-[var(--primary)]">
              <Sparkles size={22} />
            </div>
            <span className="ec-badge ec-badge-scheduled">
              {subscription.plan_tier.replace(/_/g, " ")}
            </span>
          </div>
          <p className="ec-label" style={{ marginBottom: 6 }}>Active tier plan</p>
          <h3 className="text-2xl font-black text-[var(--foreground)] tracking-tight">
            {getTierDisplayName(subscription.plan_tier)}
          </h3>
        </div>

        <div className="ec-card ec-billing-stat-card">
          <div className="ec-billing-stat-top">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-blue-50 text-blue-600">
              <CreditCard size={22} />
            </div>
            <span className="ec-badge" style={{ background: "var(--info-50)", color: "var(--info)", border: "1px solid #BFDBFE" }}>
              Audit record
            </span>
          </div>
          <p className="ec-label" style={{ marginBottom: 6 }}>Lifetime funds loaded</p>
          <h3 className="text-3xl font-black text-[var(--foreground)] tracking-tight">
            ₹{lifetimeTopup.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </h3>
        </div>
      </div>

      {/* ── Pricing Upgrade Grid ─────────────────────────────────────────────── */}
      <div className="ec-billing-plans-section">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <h3 className="text-xl font-black text-[var(--foreground)] tracking-tight flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--primary-subtle)] flex items-center justify-center">
              <Zap size={20} className="text-[var(--primary)]" />
            </div>
            Studio Plan Tiers
          </h3>
          
          {/* Monthly / Yearly Toggle */}
          <div
            className="flex items-center gap-2 p-1.5 rounded-xl"
            style={{ background: "var(--surface)", border: "2px solid var(--border-subtle)" }}
          >
            <button
              type="button"
              onClick={() => setBillingCycle("monthly")}
              className={`ec-btn ec-btn-sm ${billingCycle === "monthly" ? "ec-btn-secondary" : "ec-btn-ghost"}`}
              style={{ border: billingCycle === "monthly" ? undefined : "transparent" }}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle("yearly")}
              className={`ec-btn ec-btn-sm flex items-center gap-2 ${billingCycle === "yearly" ? "ec-btn-primary text-white" : "ec-btn-ghost"}`}
              style={{ border: billingCycle === "yearly" ? undefined : "transparent" }}
            >
              Yearly
              <span
                className="ec-badge"
                style={
                  billingCycle === "yearly"
                    ? { background: "rgba(255,255,255,0.2)", color: "#fff", border: "none" }
                    : { background: "var(--success-50)", color: "var(--success)", border: "1px solid #A7F3D0" }
                }
              >
                Save 20%
              </span>
            </button>
          </div>
        </div>

        <div className="ec-billing-plans-grid">
          {/* 1. Pay Per Event */}
          <div className="ec-card ec-billing-plan-card">
            <div>
              {subscription.plan_tier === "pay_per_event" && (
                <span className="ec-badge mb-4" style={{ background: "var(--success-50)", color: "var(--success)", border: "1px solid #A7F3D0" }}>
                  Current tier
                </span>
              )}
              <h4 className="text-xl font-black text-[var(--foreground)] tracking-tight">Pay-Per-Event</h4>
              <p className="text-xs text-[var(--text-secondary)] font-medium mt-2 mb-6 min-h-[40px]">
                Wallet-based prepaid model. Perfect for occasional streams.
              </p>
              <div className="flex items-baseline gap-1 text-[var(--foreground)]">
                <span className="text-4xl font-black tracking-tighter">₹299</span>
                <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>/ event</span>
              </div>
              <p className="text-sm font-semibold mt-2" style={{ color: "var(--accent)" }}>Launch offer (reg. ₹499)</p>

              <div className="h-px my-6" style={{ background: "var(--border-subtle)" }} />
              
              <ul className="space-y-4 text-sm font-medium text-[var(--text-secondary)]">
                <li className="flex items-start gap-3"><Check size={16} className="text-emerald-500 mt-0.5" /> <span>All premium templates</span></li>
                <li className="flex items-start gap-3"><Check size={16} className="text-emerald-500 mt-0.5" /> <span>30 days VOD archive</span></li>
                <li className="flex items-start gap-3"><Check size={16} className="text-emerald-500 mt-0.5" /> <span>No watermarks</span></li>
                <li className="flex items-start gap-3"><Check size={16} className="text-emerald-500 mt-0.5" /> <span>Guest Photo Wall (50 photos)</span></li>
              </ul>
            </div>
            
            <div className="ec-billing-plan-actions">
            
            <button
              type="button"
              onClick={() => handleUpgradePlan("pay_per_event")}
              disabled={subscription.plan_tier === "pay_per_event" || isUpgrading !== null}
              className={`ec-btn ec-btn-lg w-full ${
                subscription.plan_tier === "pay_per_event"
                  ? "ec-btn-secondary"
                  : "ec-btn-secondary"
              }`}
            >
              {isUpgrading === "pay_per_event" ? <Loader2 className="animate-spin" size={18} /> : null}
              {subscription.plan_tier === "pay_per_event" ? "Active plan" : "Switch to wallet"}
            </button>
            
            </div>
          </div>

          {/* 2. Basic Plan */}
          <div className="ec-card ec-billing-plan-card">
            <div>
              {subscription.plan_tier === "basic" && (
                <span className="ec-badge ec-badge-scheduled mb-4">Current plan</span>
              )}
              <h4 className="text-xl font-black text-[var(--foreground)] tracking-tight">Basic</h4>
              <p className="text-xs text-[var(--text-secondary)] font-medium mt-2 mb-6 min-h-[40px]">
                For growing studios needing a consistent monthly event quota.
              </p>
              <div className="flex items-baseline gap-1 text-[var(--foreground)]">
                <span className="text-4xl font-black tracking-tighter">
                  {billingCycle === "monthly" ? "₹1,499" : "₹14,990"}
                </span>
                <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                  / {billingCycle === "monthly" ? "mo" : "yr"}
                </span>
              </div>
              <p className="text-sm font-medium mt-2" style={{ color: "var(--text-secondary)" }}>
                Includes 5 events {billingCycle === "yearly" ? "/ year" : "/ month"}
              </p>

              <div className="h-px my-6" style={{ background: "var(--border-subtle)" }} />
              
              <ul className="space-y-4 text-sm font-medium text-[var(--text-secondary)]">
                <li className="flex items-start gap-3"><Check size={16} className="text-[var(--primary)] mt-0.5" /> <span><strong>5 events included</strong></span></li>
                <li className="flex items-start gap-3"><Check size={16} className="text-[var(--primary)] mt-0.5" /> <span>₹250 per extra event (auto-wallet)</span></li>
                <li className="flex items-start gap-3"><Check size={16} className="text-[var(--primary)] mt-0.5" /> <span>30 days VOD archive</span></li>
                <li className="flex items-start gap-3"><Check size={16} className="text-[var(--primary)] mt-0.5" /> <span>Standard Priority Support</span></li>
              </ul>
            </div>
            
            <div className="ec-billing-plan-actions">
            
            <button
              type="button"
              onClick={() => handleUpgradePlan("basic")}
              disabled={subscription.plan_tier === "basic" || isUpgrading !== null}
              className="ec-btn ec-btn-lg w-full ec-btn-secondary"
            >
              {isUpgrading === "basic" ? <Loader2 className="animate-spin" size={18} /> : null}
              {subscription.plan_tier === "basic" ? "Active plan" : "Subscribe to Basic"}
            </button>
            
            </div>
          </div>

          {/* 3. Professional Plan (Highlighted) */}
          <div
            className="ec-card ec-billing-plan-card border-2 relative"
            style={{
              borderColor: "var(--primary)",
              boxShadow: "var(--shadow-violet), var(--shadow-card)",
            }}
          >
            <span
              className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 ec-badge"
              style={{ background: "var(--primary)", color: "#FFFFFF", border: "none", padding: "8px 16px" }}
            >
              Most popular
            </span>
            <div>
              {subscription.plan_tier === "pro" && (
                <span className="ec-badge mb-4 text-white" style={{ background: "var(--primary)", border: "none" }}>
                  Current plan
                </span>
              )}
              <h4 className="text-xl font-black text-[var(--foreground)] tracking-tight">Professional</h4>
              <p className="text-xs text-[var(--text-secondary)] font-medium mt-2 mb-6 min-h-[40px]">
                Engineered for established media studios & wedding filmmakers.
              </p>
              <div className="flex items-baseline gap-1 text-[var(--foreground)]">
                <span className="text-4xl font-black tracking-tighter text-[var(--primary)]">
                  {billingCycle === "monthly" ? "₹3,499" : "₹34,990"}
                </span>
                <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                  / {billingCycle === "monthly" ? "mo" : "yr"}
                </span>
              </div>
              <p className="text-sm font-medium mt-2" style={{ color: "var(--primary)" }}>
                Includes 15 events {billingCycle === "yearly" ? "/ year" : "/ month"}
              </p>

              <div className="h-px my-6" style={{ background: "var(--border-subtle)" }} />
              
              <ul className="space-y-4 text-sm font-medium text-[var(--text-secondary)]">
                <li className="flex items-start gap-3"><Check size={16} className="text-[var(--primary)] mt-0.5" /> <span><strong>15 events included</strong></span></li>
                <li className="flex items-start gap-3"><Check size={16} className="text-[var(--primary)] mt-0.5" /> <span><strong>Custom Domain Mapping</strong></span></li>
                <li className="flex items-start gap-3"><Check size={16} className="text-[var(--primary)] mt-0.5" /> <span>Premium 90 days VOD archive</span></li>
                <li className="flex items-start gap-3"><Check size={16} className="text-[var(--primary)] mt-0.5" /> <span>₹200 per extra event (auto-wallet)</span></li>
              </ul>
            </div>
            
            <div className="ec-billing-plan-actions">
            
            <button
              type="button"
              onClick={() => handleUpgradePlan("pro")}
              disabled={subscription.plan_tier === "pro" || isUpgrading !== null}
              className={`ec-btn ec-btn-lg w-full ${
                subscription.plan_tier === "pro" ? "ec-btn-secondary" : "ec-btn-primary text-white"
              }`}
            >
              {isUpgrading === "pro" ? <Loader2 className="animate-spin" size={18} /> : null}
              {subscription.plan_tier === "pro" ? "Active plan" : "Upgrade to Pro"}
            </button>
            
            </div>
          </div>

          {/* 4. Business Plan */}
          <div className="ec-card ec-billing-plan-card">
            <div>
              {subscription.plan_tier === "business" && (
                <span className="ec-badge ec-badge-amber mb-4">Current plan</span>
              )}
              <h4 className="text-xl font-black text-[var(--foreground)] tracking-tight">Business</h4>
              <p className="text-xs text-[var(--text-secondary)] font-medium mt-2 mb-6 min-h-[40px]">
                Unlimited scalability for heavy production companies.
              </p>
              <div className="flex items-baseline gap-1 text-[var(--foreground)]">
                <span className="text-4xl font-black tracking-tighter">
                  {billingCycle === "monthly" ? "₹7,999" : "₹79,990"}
                </span>
                <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                  / {billingCycle === "monthly" ? "mo" : "yr"}
                </span>
              </div>
              <p className="text-sm font-semibold mt-2" style={{ color: "#B45309" }}>
                Unlimited events
              </p>

              <div className="h-px my-6" style={{ background: "var(--border-subtle)" }} />
              
              <ul className="space-y-4 text-sm font-medium text-[var(--text-secondary)]">
                <li className="flex items-start gap-3"><Check size={16} className="text-amber-500 mt-0.5" /> <span><strong>Unlimited Events</strong></span></li>
                <li className="flex items-start gap-3"><Check size={16} className="text-amber-500 mt-0.5" /> <span>All Pro Features included</span></li>
                <li className="flex items-start gap-3"><Check size={16} className="text-amber-500 mt-0.5" /> <span>1 Year VOD archive</span></li>
                <li className="flex items-start gap-3"><Check size={16} className="text-amber-500 mt-0.5" /> <span>Priority Dedicated Support</span></li>
              </ul>
            </div>
            
            <div className="ec-billing-plan-actions">
            
            <button
              type="button"
              onClick={() => handleUpgradePlan("business")}
              disabled={subscription.plan_tier === "business" || isUpgrading !== null}
              className="ec-btn ec-btn-lg w-full ec-btn-secondary"
            >
              {isUpgrading === "business" ? <Loader2 className="animate-spin" size={18} /> : null}
              {subscription.plan_tier === "business" ? "Active plan" : "Subscribe to Business"}
            </button>
            
            </div>
          </div>
        </div>
      </div>

      {/* ── Add-ons & Ledger ─────────────────────────────────────────────────── */}
      <div className="ec-billing-bottom-grid">
        
        {/* Add-ons Information */}
        <div className="ec-billing-addon-stack">
          <p className="ec-label">Available add-ons</p>
          <div className="ec-card ec-billing-addon-card border-l-4 border-l-blue-500">
            <h4 className="text-base font-black text-[var(--foreground)] flex items-center gap-2">
              <Zap size={16} className="text-blue-500" /> Multi-Destination Streaming
            </h4>
            <p className="text-xs text-[var(--text-secondary)] mt-2">
              Stream to multiple Facebook/YouTube pages simultaneously. Automatically deducted from wallet balance per event.
            </p>
            <div className="ec-billing-addon-prices">
              <div className="ec-billing-addon-price-row">
                <span className="font-bold text-[var(--foreground)]">Extra Destination</span>
                <span className="text-[var(--text-secondary)]">₹49 / dest</span>
              </div>
              <div className="ec-billing-addon-price-row">
                <span className="font-bold text-[var(--foreground)]">Bundle (5 Dests)</span>
                <span className="text-emerald-600 font-bold">₹99 / bundle</span>
              </div>
            </div>
          </div>

          <div className="ec-card ec-billing-addon-card border-l-4 border-l-amber-500">
            <h4 className="text-base font-black text-[var(--foreground)] flex items-center gap-2">
              <Info size={16} className="text-amber-500" /> Auto-Fallback Protection
            </h4>
            <p className="text-xs text-[var(--text-secondary)] mt-2">
              If your subscription expires, your account automatically falls back to the Pay-Per-Event tier. Your live events will never be interrupted.
            </p>
          </div>
        </div>

        {/* Ledger Transaction History */}
        <div>
          <div className="ec-card overflow-hidden flex flex-col h-full max-h-[500px]">
            <div
              className="px-8 py-6 flex items-center justify-between"
              style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-hover)" }}
            >
              <h3 className="ec-section-title flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: "var(--success-50)", color: "var(--success)" }}
                >
                  <WalletIcon size={18} />
                </div>
                Wallet ledger
              </h3>
              <span className="ec-badge" style={{ background: "var(--surface-hover)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                {transactions.length} entries
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-3 ec-scrollbar">
              {transactions.length === 0 ? (
                <div className="py-20 text-center" style={{ color: "var(--text-secondary)" }}>
                  <WalletIcon size={40} className="mx-auto mb-4 opacity-20" />
                  <p className="text-sm font-medium">No transactions recorded yet.</p>
                </div>
              ) : (
                transactions.map((tx, idx) => {
                  const isCredit = tx.kind === "topup" || tx.kind === "refund";
                  return (
                    <div
                      key={idx}
                      className="p-4 rounded-xl flex items-center justify-between transition-all"
                      style={{
                        border: "1px solid var(--border-subtle)",
                        background: "var(--surface)",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface)"; }}
                    >
                      <div className="flex items-center gap-4">
                        <div
                          className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={
                            isCredit
                              ? { background: "var(--success-50)", color: "var(--success)" }
                              : { background: "var(--error-50)", color: "var(--error)" }
                          }
                        >
                          {isCredit ? <ArrowDownRight size={18} /> : <ArrowUpRight size={18} />}
                        </div>
                        <div>
                          <h4 className="text-sm font-bold capitalize" style={{ color: "var(--foreground)" }}>
                            {tx.kind.replace(/_/g, " ")}
                          </h4>
                          <p className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
                            {new Date(tx.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                      <span className={`text-base font-bold ${isCredit ? "text-emerald-600" : ""}`} style={!isCredit ? { color: "var(--foreground)" } : undefined}>
                        {isCredit ? "+" : "-"}₹{(Math.abs(tx.amount_paise) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Top Up Modal ─────────────────────────────────────────────────────── */}
      {isTopUpOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300"
          style={{ background: "rgba(0,0,0,0.45)" }}
        >
          <div className="ec-card w-full max-w-md relative animate-in zoom-in-95 duration-300" style={{ padding: 0, overflow: "hidden" }}>
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-400 to-teal-400" />
            
            <div className="p-8 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <div>
                <h3 className="text-xl font-bold tracking-tight" style={{ color: "var(--foreground)" }}>Load credits</h3>
                <p className="ec-section-sub mt-1">Simulated Razorpay top-up</p>
              </div>
              <button
                type="button"
                onClick={() => setIsTopUpOpen(false)}
                className="ec-icon-btn"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-8 space-y-6">
              {topUpSuccess ? (
                <div className="text-center py-10 space-y-4 animate-in zoom-in-90 duration-500">
                  <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-[0_0_40px_-5px_rgba(16,185,129,0.2)]">
                    <Check size={32} />
                  </div>
                  <h4 className="text-lg font-black text-[var(--foreground)]">Funds Loaded Successfully</h4>
                  <p className="ec-section-sub">Syncing wallet ledger…</p>
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    <label className="ec-label">Select credit amount</label>
                    <div className="grid grid-cols-3 gap-3">
                      {["500", "1000", "2000"].map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setTopUpAmount(amt)}
                          className={`ec-btn ec-btn-secondary w-full ${
                            topUpAmount === amt ? "ring-2 ring-emerald-500 bg-emerald-50 text-emerald-700" : ""
                          }`}
                        >
                          ₹{amt}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="ec-label">Custom amount (INR)</label>
                    <div className="relative">
                      <input
                        type="number"
                        placeholder="Enter amount..."
                        value={topUpAmount}
                        onChange={(e) => setTopUpAmount(e.target.value)}
                        className="ec-input w-full pl-10"
                      />
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] font-black">₹</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleSimulateTopUp}
                    disabled={isSimulating}
                    className="ec-btn ec-btn-lg w-full bg-emerald-500 hover:bg-emerald-600 text-white border-transparent"
                  >
                    {isSimulating ? <Loader2 className="animate-spin" size={18} /> : <CreditCard size={18} />}
                    {isSimulating ? "Authorizing Funds..." : "Simulate Razorpay Payment"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
