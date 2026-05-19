"use client";

import React, { useState, useEffect } from "react";
import {
  Wallet as WalletIcon, CreditCard, ArrowUpRight, ArrowDownRight,
  Sparkles, RefreshCw, Zap, Check, AlertCircle, Calendar, Shield, Loader2, X
} from "lucide-react";
import { authFetch } from "@/lib/client-auth";

interface WalletProps {
  studioId: string | null;
}

export const Wallet: React.FC<WalletProps> = ({ studioId }) => {
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
        alert(data.message || `Successfully upgraded to ${tier}!`);
        fetchBillingData();
      } else {
        alert(data.error || "Failed to upgrade subscription");
      }
    } catch (err) {
      console.error(err);
      alert("An unexpected error occurred during upgrade.");
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

  const getTierBadgeColor = (tier: string) => {
    switch (tier.toLowerCase()) {
      case "agency": return { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/20" };
      case "pro": return { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20" };
      case "pay_per_event": return { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" };
      default: return { bg: "bg-white/5", text: "text-white/40", border: "border-white/10" };
    }
  };

  const getTierDisplayName = (tier: string) => {
    switch (tier.toLowerCase()) {
      case "agency": return "Agency Partner";
      case "pro": return "Professional Studio";
      case "pay_per_event": return "Pay-Per-Event Core";
      default: return "Free Demo Tier";
    }
  };

  if (isLoading) {
    return (
      <div className="w-full h-[60vh] flex flex-col items-center justify-center text-white/40 gap-4 animate-in fade-in duration-500">
        <Loader2 className="animate-spin text-blue-500" size={40} />
        <span className="text-[10px] font-black uppercase tracking-[0.3em]">Synching Financial Assets...</span>
      </div>
    );
  }

  const subBadge = getTierBadgeColor(subscription.plan_tier);

  return (
    <div className="w-full space-y-10 animate-in fade-in duration-700">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tighter leading-tight">
            Billing &amp; <span className="text-emerald-500">Wallet</span>
          </h2>
          <p className="text-white/40 font-bold uppercase tracking-[0.2em] mt-2 text-[10px] flex items-center gap-2">
            <Shield size={14} className="text-emerald-500" /> Account Security &amp; Ledger isolation active
          </p>
        </div>

        <button
          onClick={() => setIsTopUpOpen(true)}
          className="flex items-center gap-3 px-6 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] bg-emerald-500 hover:bg-emerald-400 text-white shadow-xl shadow-emerald-500/10 transition-all transform active:scale-95 duration-300"
        >
          <CreditCard size={16} /> Load Wallet Credits
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1: Balance */}
        <div
          className="relative w-full p-8 rounded-[2rem] border overflow-hidden backdrop-blur-xl bg-white/[0.02] border-white/[0.08]"
        >
          <div className="absolute top-0 right-0 p-4 opacity-[0.03] pointer-events-none">
            <WalletIcon size={120} className="text-emerald-500" />
          </div>
          <div className="flex items-start justify-between mb-6 relative z-10">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-emerald-500/15 border border-emerald-500/30">
              <WalletIcon size={22} className="text-emerald-400" />
            </div>
            <span className="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              ACTIVE FUNDS
            </span>
          </div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20 mb-2 relative z-10">Prepaid balance</p>
          <h3 className="text-4xl font-black text-white leading-none tracking-tighter relative z-10">
            ₹{balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </h3>
        </div>

        {/* Card 2: Tier */}
        <div
          className="relative w-full p-8 rounded-[2rem] border overflow-hidden backdrop-blur-xl bg-white/[0.02] border-white/[0.08]"
        >
          <div className="absolute top-0 right-0 p-4 opacity-[0.03] pointer-events-none">
            <Sparkles size={120} className={subBadge.text} />
          </div>
          <div className="flex items-start justify-between mb-6 relative z-10">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${subBadge.bg} border ${subBadge.border}`}>
              <Sparkles size={22} className={subBadge.text} />
            </div>
            <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${subBadge.bg} ${subBadge.text} border ${subBadge.border}`}>
              {subscription.plan_tier.toUpperCase()}
            </span>
          </div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20 mb-2 relative z-10">Active Tier Plan</p>
          <h3 className="text-2xl font-black text-white leading-none tracking-tighter relative z-10 pt-1.5">
            {getTierDisplayName(subscription.plan_tier)}
          </h3>
        </div>

        {/* Card 3: Spent */}
        <div
          className="relative w-full p-8 rounded-[2rem] border overflow-hidden backdrop-blur-xl bg-white/[0.02] border-white/[0.08]"
        >
          <div className="absolute top-0 right-0 p-4 opacity-[0.03] pointer-events-none">
            <CreditCard size={120} className="text-blue-500" />
          </div>
          <div className="flex items-start justify-between mb-6 relative z-10">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-blue-500/15 border border-blue-500/30">
              <CreditCard size={22} className="text-blue-400" />
            </div>
            <span className="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-blue-500/10 text-blue-400 border border-blue-500/20">
              AUDIT RECORD
            </span>
          </div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20 mb-2 relative z-10">Lifetime Funds Loaded</p>
          <h3 className="text-4xl font-black text-white leading-none tracking-tighter relative z-10">
            ₹{lifetimeTopup.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </h3>
        </div>
      </div>

      {/* Pricing Upgrade Grid & Transaction history */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        
        {/* Upgrade / Pricing Tiers (2 Columns) */}
        <div className="lg:col-span-2 space-y-8">
          <div className="flex items-center justify-between">
             <h3 className="text-[10px] font-black text-white flex items-center gap-3 uppercase tracking-[0.3em]">
               <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                 <Zap size={16} className="text-blue-400" />
               </div>
               Studio Plan Tiers
             </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Pay Per Event Tier */}
            <div className="p-8 rounded-[2.5rem] border border-white/[0.08] bg-white/[0.02] flex flex-col justify-between space-y-6 relative overflow-hidden group">
              {subscription.plan_tier === "pay_per_event" && (
                <div className="absolute top-4 right-4 bg-emerald-500 text-white text-[8px] font-black uppercase px-2.5 py-1 rounded-full tracking-widest shadow-lg shadow-emerald-500/20">
                  CURRENT TIER
                </div>
              )}
              <div className="space-y-4">
                <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full text-[9px] font-black uppercase tracking-widest">PAY-PER-EVENT</span>
                <h4 className="text-xl font-black text-white leading-none tracking-tight pt-2">Solo Broadcaster</h4>
                <div className="flex items-baseline gap-1 text-white">
                  <span className="text-3xl font-black">₹499</span>
                  <span className="text-[10px] text-white/30 font-bold uppercase tracking-wider">/ event</span>
                </div>
                <p className="text-xs text-white/40 leading-relaxed">
                  Perfect for freelancers and solo event operators who live stream occasionally and prefer a prepaid pay-as-you-go model.
                </p>
                <div className="h-px bg-white/[0.06] my-4" />
                <ul className="space-y-2.5 text-xs text-white/60">
                  <li className="flex items-center gap-2.5"><Check size={14} className="text-emerald-400 flex-shrink-0" /> <span>Prepaid event generation</span></li>
                  <li className="flex items-center gap-2.5"><Check size={14} className="text-emerald-400 flex-shrink-0" /> <span>All premium event templates</span></li>
                  <li className="flex items-center gap-2.5"><Check size={14} className="text-emerald-400 flex-shrink-0" /> <span>30 days VOD archive safety</span></li>
                  <li className="flex items-center gap-2.5"><Check size={14} className="text-emerald-400 flex-shrink-0" /> <span>No platform watermarks</span></li>
                </ul>
              </div>
              
              {subscription.plan_tier === "pay_per_event" ? (
                <button
                  disabled
                  className="w-full py-4 mt-6 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center gap-2 opacity-80"
                >
                  <Check size={14} /> Active Plan
                </button>
              ) : (
                <button
                  onClick={() => handleUpgradePlan("pay_per_event")}
                  disabled={isUpgrading !== null}
                  className="w-full py-4 mt-6 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] bg-emerald-500/10 hover:bg-emerald-500 hover:text-white text-emerald-400 border border-emerald-500/20 hover:border-transparent transition-all duration-300 flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
                >
                  {isUpgrading === "pay_per_event" ? <Loader2 className="animate-spin" size={14} /> : <Zap size={14} />}
                  Activate Plan
                </button>
              )}
            </div>

            {/* Pro subscription Tier */}
            <div className="p-8 rounded-[2.5rem] border border-blue-500/20 bg-blue-500/[0.02] flex flex-col justify-between space-y-6 relative overflow-hidden group">
              <div className="absolute -top-10 -right-10 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl group-hover:scale-125 transition-transform" />
              {subscription.plan_tier === "pro" ? (
                <div className="absolute top-4 right-4 bg-blue-500 text-white text-[8px] font-black uppercase px-2.5 py-1 rounded-full tracking-widest shadow-lg shadow-blue-500/20">
                  CURRENT PLAN
                </div>
              ) : (
                <div className="absolute top-4 right-4 bg-gradient-to-r from-blue-500 to-purple-500 text-white text-[8px] font-black uppercase px-2.5 py-1 rounded-full tracking-widest shadow-lg shadow-blue-500/20">
                  RECOMMENDED
                </div>
              )}
              <div className="space-y-4">
                <span className="px-3 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full text-[9px] font-black uppercase tracking-widest">PRO SUBSCRIPTION</span>
                <h4 className="text-xl font-black text-white leading-none tracking-tight pt-2 font-black font-black">Professional Studio</h4>
                <div className="flex items-baseline gap-1 text-white">
                  <span className="text-3xl font-black">₹4,999</span>
                  <span className="text-[10px] text-white/30 font-bold uppercase tracking-wider">/ month</span>
                </div>
                <p className="text-xs text-white/40 leading-relaxed">
                  Engineered for established media studios, wedding filmmakers, and premium live teams who run multiple productions per month.
                </p>
                <div className="h-px bg-white/[0.06] my-4" />
                <ul className="space-y-2.5 text-xs text-white/60">
                  <li className="flex items-center gap-2.5"><Check size={14} className="text-blue-400 flex-shrink-0" /> <span><strong>Custom Domain Mapping</strong> (e.g. live.studio.com)</span></li>
                  <li className="flex items-center gap-2.5"><Check size={14} className="text-blue-400 flex-shrink-0" /> <span>Includes 10 events / month</span></li>
                  <li className="flex items-center gap-2.5"><Check size={14} className="text-blue-400 flex-shrink-0" /> <span>Premium 90 days VOD archive</span></li>
                  <li className="flex items-center gap-2.5"><Check size={14} className="text-blue-400 flex-shrink-0" /> <span>Fully white-labeled custom branding</span></li>
                </ul>
              </div>
              
              {subscription.plan_tier === "pro" ? (
                <button
                  disabled
                  className="w-full py-4 mt-6 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center gap-2 opacity-80"
                >
                  <Check size={14} /> Active Plan
                </button>
              ) : (
                <button
                  onClick={() => handleUpgradePlan("pro")}
                  disabled={isUpgrading !== null}
                  className="w-full py-4 mt-6 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-400 hover:to-purple-400 text-white shadow-lg shadow-blue-500/10 transition-all duration-300 flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
                >
                  {isUpgrading === "pro" ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
                  Upgrade with Wallet (₹4,999/mo)
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Ledger Transaction History (1 Column) */}
        <div
          className="rounded-[2.5rem] border overflow-hidden flex flex-col bg-white/[0.02] border-white/[0.08] h-fit"
          style={{ maxHeight: "650px" }}
        >
          <div className="px-6 py-6 flex items-center justify-between border-b border-white/[0.06] bg-white/[0.01]">
            <h3 className="text-[10px] font-black text-white flex items-center gap-3 uppercase tracking-[0.3em]">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                <WalletIcon size={16} className="text-emerald-400" />
              </div>
              Prepaid Ledger
            </h3>
            <span className="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border border-emerald-500/20 bg-emerald-500/5 text-emerald-400">
              {transactions.length} Logs
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-4 max-h-[400px] custom-scrollbar">
            {transactions.length === 0 ? (
              <div className="py-20 text-center text-white/10 uppercase tracking-widest text-[10px] font-black">
                <WalletIcon size={40} className="mx-auto mb-4 opacity-10" />
                No transactions recorded yet.
              </div>
            ) : (
              transactions.map((tx, idx) => {
                const isCredit = tx.kind === "topup" || tx.kind === "refund";
                return (
                  <div
                    key={idx}
                    className="p-5 rounded-2xl border border-white/[0.05] bg-white/[0.01] hover:bg-white/[0.03] transition-all duration-300 group flex items-center justify-between"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-black flex-shrink-0 border ${
                        isCredit 
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" 
                          : "bg-red-500/10 text-red-400 border-red-500/20"
                      }`}>
                        {isCredit ? <ArrowDownRight size={16} /> : <ArrowUpRight size={16} />}
                      </div>
                      <div>
                        <h4 className="text-[11px] font-black text-white/80 uppercase tracking-widest">
                          {tx.kind.toUpperCase()}
                        </h4>
                        <p className="text-[9px] text-white/20 font-black uppercase mt-1">
                          {new Date(tx.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                    <span className={`text-sm font-black tracking-tight ${isCredit ? "text-emerald-400" : "text-red-400"}`}>
                      {isCredit ? "+" : "-"}₹{(Math.abs(tx.amount_paise) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Top Up Modal */}
      {isTopUpOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-500">
          <div 
            className="w-full max-w-md rounded-[3rem] border border-white/[0.08] shadow-2xl overflow-hidden relative animate-in zoom-in-95 duration-500 bg-[#0d0d17]"
          >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />
            
            <div className="p-8 border-b border-white/[0.08] flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black text-white tracking-tight">Load Credits</h3>
                <p className="text-[10px] text-white/20 font-black uppercase tracking-[0.3em] mt-1">Simulated Razorpay top-up portal</p>
              </div>
              <button 
                onClick={() => setIsTopUpOpen(false)} 
                className="w-10 h-10 flex items-center justify-center bg-white/5 hover:bg-red-500 text-white/40 hover:text-white rounded-xl transition-all border border-white/5"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-8 space-y-6">
              {topUpSuccess ? (
                <div className="text-center py-10 space-y-4 animate-in zoom-in-90 duration-500">
                  <div className="w-16 h-16 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full flex items-center justify-center mx-auto shadow-[0_0_40px_-5px_rgba(16,185,129,0.3)]">
                    <Check size={32} />
                  </div>
                  <h4 className="text-lg font-black text-white">Funds Loaded Successfully</h4>
                  <p className="text-xs text-white/30 uppercase tracking-widest font-black">Syncing wallet ledgers...</p>
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Select Credit Amount</label>
                    <div className="grid grid-cols-3 gap-3">
                      {["500", "1000", "2000"].map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setTopUpAmount(amt)}
                          className={`py-3.5 rounded-xl border font-black uppercase text-[11px] tracking-widest transition-all ${
                            topUpAmount === amt 
                              ? "border-emerald-500 bg-emerald-500/10 text-white shadow-lg" 
                              : "border-white/[0.08] bg-white/[0.02] text-white/40 hover:border-white/20"
                          }`}
                        >
                          ₹{amt}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="block text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Custom Amount (INR)</label>
                    <div className="relative">
                      <input
                        type="number"
                        placeholder="Enter amount..."
                        value={topUpAmount}
                        onChange={(e) => setTopUpAmount(e.target.value)}
                        className="w-full p-4 pl-10 bg-white/[0.03] border border-white/[0.08] rounded-xl outline-none focus:ring-2 focus:ring-emerald-500/50 text-white font-black text-base placeholder:text-white/10"
                      />
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 font-black">₹</span>
                    </div>
                  </div>

                  <button
                    onClick={handleSimulateTopUp}
                    disabled={isSimulating}
                    className="w-full py-5 bg-emerald-500 hover:bg-emerald-400 text-white rounded-2xl font-black uppercase tracking-[0.4em] text-xs transition-all shadow-xl shadow-emerald-500/10 flex items-center justify-center gap-3 active:scale-95 disabled:opacity-50"
                  >
                    {isSimulating ? <Loader2 className="animate-spin" size={16} /> : <CreditCard size={16} />}
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
