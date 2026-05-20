"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/client-auth";
import {
  Palette, Save, Shield, User, Info, CheckCircle2, AlertCircle,
  Loader2, Zap, Layout, Users, PlusCircle, ChevronRight,
  Globe, Trash2, RefreshCw, Copy, Clock, XCircle, Plus,
} from "lucide-react";

const BRAND_COLORS = [
  { hex: "#3b82f6", name: "Classic Blue",    bg: "bg-blue-500" },
  { hex: "#ec4899", name: "Rose Gold",       bg: "bg-pink-500" },
  { hex: "#10b981", name: "Emerald Sage",    bg: "bg-emerald-500" },
  { hex: "#8b5cf6", name: "Indigo Velvet",   bg: "bg-violet-500" },
  { hex: "#f59e0b", name: "Royal Amber",     bg: "bg-amber-500" },
  { hex: "#ef4444", name: "Crimson Silk",    bg: "bg-red-500" },
];

interface UserSettingsProps {
  studioId: string | null;
  studioSlug: string | null;
  user: any;
}

type ToastMsg = { type: "success" | "error"; text: string } | null;

const CARD = "p-8 md:p-12 rounded-[3rem] border backdrop-blur-2xl shadow-2xl relative overflow-hidden";
const CARD_STYLE = { background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" };
const INPUT = "w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white text-base placeholder:text-white/10";
const LABEL = "block text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-3";

function Toast({ msg }: { msg: ToastMsg }) {
  if (!msg) return null;
  return (
    <div className={`mb-6 p-4 rounded-2xl flex items-center gap-3 text-sm font-black ${
      msg.type === "success"
        ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
        : "bg-red-500/10 border border-red-500/20 text-red-400"
    }`}>
      {msg.type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
      {msg.text}
    </div>
  );
}

// ── Domain types ─────────────────────────────────────────────────────────────

interface StudioDomain {
  id: string;
  domain: string;
  ssl_status: "pending" | "active" | "failed";
  dns_status: "pending" | "active" | "failed";
  cloudflare_hostname_id: string | null;
  created_at: string;
}

interface DomainSetupInstructions {
  domain: string;
  cnameTarget: string;
  ownershipTxtName: string | null;
  ownershipTxtValue: string | null;
  sslTxtName: string | null;
  sslTxtValue: string | null;
}

// ── Domain sub-components ─────────────────────────────────────────────────────

function StatusBadge({
  label,
  status,
}: {
  label: string;
  status: "pending" | "active" | "failed";
}) {
  const styles = {
    active:  "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    pending: "text-amber-400  bg-amber-500/10  border-amber-500/20",
    failed:  "text-red-400    bg-red-500/10    border-red-500/20",
  } as const;
  const icons = {
    active:  <CheckCircle2 size={9} />,
    pending: <Clock         size={9} />,
    failed:  <XCircle       size={9} />,
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-widest ${styles[status]}`}
    >
      {icons[status]}
      {label}: {status}
    </span>
  );
}

function DomainRow({
  domain,
  isRefreshing,
  isRemoving,
  onRefresh,
  onRemove,
}: {
  domain: StudioDomain;
  isRefreshing: boolean;
  isRemoving: boolean;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  // Auto-refresh every 60s while either status is still 'pending'
  const isPending = domain.ssl_status === 'pending' || domain.dns_status === 'pending';
  useEffect(() => {
    if (!isPending || isRefreshing) return;
    const timer = setTimeout(onRefresh, 60_000);
    return () => clearTimeout(timer);
  }, [isPending, isRefreshing, onRefresh]);

  return (
    <div className={`p-5 rounded-2xl border flex items-center justify-between gap-4 group transition-all ${
      isPending
        ? 'bg-amber-500/[0.03] border-amber-500/20 hover:bg-amber-500/[0.05]'
        : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]'
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">
          <p className="font-black text-white text-sm truncate">{domain.domain}</p>
          {isPending && (
            <span className="flex items-center gap-1 text-[9px] font-black text-amber-400/70 uppercase tracking-widest">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Propagating
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <StatusBadge label="SSL" status={domain.ssl_status} />
          <StatusBadge label="DNS" status={domain.dns_status} />
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          title="Refresh DNS/SSL status"
          className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/40 hover:text-cyan-400 transition-all disabled:opacity-30"
        >
          {isRefreshing ? (
            <Loader2 className="animate-spin" size={15} />
          ) : (
            <RefreshCw size={15} />
          )}
        </button>
        <button
          onClick={onRemove}
          disabled={isRemoving}
          title="Remove domain"
          className="p-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-all disabled:opacity-30"
        >
          {isRemoving ? (
            <Loader2 className="animate-spin" size={15} />
          ) : (
            <Trash2 size={15} />
          )}
        </button>
      </div>
    </div>
  );
}

function DnsRecord({
  label,
  name,
  value,
  copiedKey,
  onCopy,
}: {
  label: string;
  name: string;
  value: string;
  copiedKey: string | null;
  onCopy: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[9px] font-black uppercase tracking-[0.25em] text-cyan-400/60">{label}</p>

      {/* Name row */}
      <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
        <div className="p-3 bg-black/20 rounded-xl border border-white/5 font-mono text-[11px] text-white/50 truncate">
          <span className="text-white/25 mr-2">Name:</span>{name}
        </div>
        <button
          onClick={() => onCopy(name)}
          title="Copy name"
          className={`p-2.5 rounded-xl transition-all flex items-center gap-1.5 text-[9px] font-black ${
            copiedKey === name
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "bg-white/5 hover:bg-white/10 text-white/30 hover:text-white"
          }`}
        >
          {copiedKey === name ? <CheckCircle2 size={13} /> : <Copy size={13} />}
          {copiedKey === name && <span>Copied!</span>}
        </button>
      </div>

      {/* Value row */}
      <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
        <div className="p-3 bg-black/20 rounded-xl border border-white/5 font-mono text-[11px] text-white/50 truncate">
          <span className="text-white/25 mr-2">Value:</span>{value}
        </div>
        <button
          onClick={() => onCopy(value)}
          title="Copy value"
          className={`p-2.5 rounded-xl transition-all flex items-center gap-1.5 text-[9px] font-black ${
            copiedKey === value
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "bg-white/5 hover:bg-white/10 text-white/30 hover:text-white"
          }`}
        >
          {copiedKey === value ? <CheckCircle2 size={13} /> : <Copy size={13} />}
          {copiedKey === value && <span>Copied!</span>}
        </button>
      </div>
    </div>
  );
}

function DnsSetupCard({
  instructions,
  onDismiss,
}: {
  instructions: DomainSetupInstructions;
  onDismiss: () => void;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  function copyToClipboard(text: string) {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedKey(text);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  return (
    <div className="mt-6 p-6 bg-cyan-500/[0.04] rounded-3xl border border-cyan-500/20 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-400">
            🌐 DNS Setup Required
          </p>
          <p className="text-white/30 text-[10px] font-black mt-1 tracking-wider">
            Add these records in your DNS provider for{" "}
            <span className="text-cyan-300/60 font-mono">{instructions.domain}</span>
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="text-white/20 hover:text-white/50 transition-colors text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-lg hover:bg-white/5"
        >
          Dismiss
        </button>
      </div>

      <DnsRecord
        label="CNAME — Point your subdomain to Eventcast"
        name={instructions.domain}
        value={instructions.cnameTarget}
        copiedKey={copiedKey}
        onCopy={copyToClipboard}
      />

      {instructions.ownershipTxtName && instructions.ownershipTxtValue && (
        <DnsRecord
          label="TXT — Ownership Verification"
          name={instructions.ownershipTxtName}
          value={instructions.ownershipTxtValue}
          copiedKey={copiedKey}
          onCopy={copyToClipboard}
        />
      )}

      {instructions.sslTxtName && instructions.sslTxtValue && (
        <DnsRecord
          label="TXT — SSL Certificate (DCV)"
          name={instructions.sslTxtName}
          value={instructions.sslTxtValue}
          copiedKey={copiedKey}
          onCopy={copyToClipboard}
        />
      )}

      <p className="text-white/25 text-[10px] font-black uppercase tracking-widest pt-2 border-t border-white/5">
        ⏱ After adding these records, click the refresh icon on the domain row to check propagation. DNS updates may take up to 24 hours.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export const UserSettings: React.FC<UserSettingsProps> = ({ studioId, studioSlug, user }) => {
  // ── Profile & Branding ──────────────────────────────────────────────────
  const [displayName,   setDisplayName]   = useState("");
  const [brandColorHex, setBrandColorHex] = useState("#3b82f6");
  const [logoUrl,       setLogoUrl]       = useState("");
  const [studioData,    setStudioData]    = useState<any>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg,    setProfileMsg]    = useState<ToastMsg>(null);

  // ── Change Password ──────────────────────────────────────────────────────
  const [pwdSubmitting, setPwdSubmitting] = useState(false);
  const [pwdMsg,        setPwdMsg]        = useState<ToastMsg>(null);

  // ── Subscription Plan Tier ───────────────────────────────────────────────
  const [subscription,  setSubscription]  = useState<any>({ plan_tier: "free", status: "active" });

  // ── Custom Domains ────────────────────────────────────────────────────────
  const [domains,           setDomains]           = useState<StudioDomain[]>([]);
  const [domainsLoading,    setDomainsLoading]    = useState(false);
  const [newDomain,         setNewDomain]         = useState("");
  const [addingDomain,      setAddingDomain]      = useState(false);
  const [domainMsg,         setDomainMsg]         = useState<ToastMsg>(null);
  const [setupInstructions, setSetupInstructions] = useState<DomainSetupInstructions | null>(null);
  const [refreshingId,      setRefreshingId]      = useState<string | null>(null);
  const [removingId,        setRemovingId]        = useState<string | null>(null);

  // ── Load studio row and subscription on mount ─────────────────────────────
  useEffect(() => {
    if (!studioId) return;
    
    // Fetch studio basic profile info
    supabase
      .from("studios")
      .select("display_name, brand_color_hex, logo_url, created_at")
      .eq("id", studioId)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setStudioData(data);
        setDisplayName(data.display_name ?? "");
        setBrandColorHex(data.brand_color_hex ?? "#3b82f6");
        setLogoUrl(data.logo_url ?? "");
      });

    // Fetch studio active billing subscription tier
    supabase
      .from("subscriptions")
      .select("plan_tier, status")
      .eq("studio_id", studioId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setSubscription(data);
        } else {
          setSubscription({ plan_tier: "free", status: "active" });
        }
      });
  }, [studioId]);

  // ── Load custom domains on mount ─────────────────────────────────────────
  useEffect(() => {
    if (!studioId) return;
    setDomainsLoading(true);
    supabase
      .from("studio_domains")
      .select("id, domain, ssl_status, dns_status, cloudflare_hostname_id, created_at")
      .eq("studio_id", studioId)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setDomains((data as StudioDomain[]) ?? []);
        setDomainsLoading(false);
      });
  }, [studioId]);

  // ── Add custom domain ─────────────────────────────────────────────────────
  async function handleAddDomain() {
    const trimmed = newDomain.trim().toLowerCase();
    if (!trimmed) return;
    setAddingDomain(true);
    setDomainMsg(null);
    try {
      const res = await authFetch("/api/domains/add", {
        method: "POST",
        body: JSON.stringify({ domain: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDomainMsg({ type: "error", text: data.error ?? "Failed to add domain" });
        return;
      }
      setDomains((prev) => [data.domain as StudioDomain, ...prev]);
      setNewDomain("");
      if (data.setup) setSetupInstructions(data.setup as DomainSetupInstructions);
      setDomainMsg({ type: "success", text: "Domain added! Configure the DNS records shown below." });
    } catch {
      setDomainMsg({ type: "error", text: "Network error. Please try again." });
    } finally {
      setAddingDomain(false);
    }
  }

  // ── Refresh domain status ─────────────────────────────────────────────────
  async function handleRefreshStatus(domainId: string) {
    setRefreshingId(domainId);
    try {
      const res = await authFetch(`/api/domains/status?domainId=${domainId}`);
      const data = await res.json();
      if (res.ok && data.domain) {
        setDomains((prev) =>
          prev.map((d) => (d.id === domainId ? (data.domain as StudioDomain) : d))
        );
        if (data.setup) setSetupInstructions(data.setup as DomainSetupInstructions);
      }
    } finally {
      setRefreshingId(null);
    }
  }

  // ── Remove custom domain ──────────────────────────────────────────────────
  async function handleRemoveDomain(domainId: string) {
    setRemovingId(domainId);
    try {
      const res = await authFetch("/api/domains/remove", {
        method: "DELETE",
        body: JSON.stringify({ domainId }),
      });
      if (res.ok) {
        const removed = domains.find((d) => d.id === domainId);
        setDomains((prev) => prev.filter((d) => d.id !== domainId));
        if (removed && setupInstructions?.domain === removed.domain) {
          setSetupInstructions(null);
        }
      }
    } finally {
      setRemovingId(null);
    }
  }

  // ── Save profile ─────────────────────────────────────────────────────────
  async function handleSaveProfile() {
    if (!studioId) return;
    setProfileSaving(true);
    setProfileMsg(null);
    const { error } = await supabase
      .from("studios")
      .update({
        display_name:    displayName,
        brand_color_hex: brandColorHex,
        logo_url:        logoUrl || null,
      })
      .eq("id", studioId);
    setProfileSaving(false);
    setProfileMsg(
      error
        ? { type: "error",   text: error.message }
        : { type: "success", text: "Profile saved successfully!" },
    );
    setTimeout(() => setProfileMsg(null), 3500);
  }

  // ── Change password ───────────────────────────────────────────────────────
  async function handlePasswordUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = e.currentTarget;
    const currentPwd = (f.elements.namedItem("currentPassword") as HTMLInputElement).value;
    const newPwd     = (f.elements.namedItem("newPassword")     as HTMLInputElement).value;
    const confirmPwd = (f.elements.namedItem("confirmPassword") as HTMLInputElement).value;

    if (newPwd !== confirmPwd) {
      setPwdMsg({ type: "error", text: "New passwords do not match." });
      return;
    }
    if (newPwd.length < 6) {
      setPwdMsg({ type: "error", text: "Password must be at least 6 characters." });
      return;
    }

    setPwdSubmitting(true);
    setPwdMsg(null);

    // Verify current password by re-authenticating
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: user?.email ?? "",
      password: currentPwd,
    });
    if (authError) {
      setPwdMsg({ type: "error", text: "Current password is incorrect." });
      setPwdSubmitting(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: newPwd });
    setPwdSubmitting(false);
    if (error) {
      setPwdMsg({ type: "error", text: error.message });
    } else {
      setPwdMsg({ type: "success", text: "Password updated! Please re-login on all devices." });
      f.reset();
    }
    setTimeout(() => setPwdMsg(null), 5000);
  }

  // ── Derived account info ─────────────────────────────────────────────────
  const planLabel = 
    subscription?.plan_tier === "pro" 
      ? "Professional Studio" 
      : subscription?.plan_tier === "agency" 
      ? "Agency Partner" 
      : subscription?.plan_tier === "pay_per_event"
      ? "Pay-Per-Event Solo"
      : "Free Demo Tier";
  const memberSince  = user?.created_at
    ? new Date(user.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "—";
  const eventUrlSlug = studioSlug ? `eventcast.pro/events/${studioSlug}/…` : "—";

  return (
    <div className="max-w-4xl mx-auto space-y-12 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-700">

      {/* ── A) Profile & Branding ─────────────────────────────────────────── */}
      <div className={CARD} style={CARD_STYLE}>
        <div className="absolute top-0 right-0 w-64 h-64 bg-pink-600/[0.03] blur-[100px] -z-10" />
        <h2 className="text-2xl font-black text-white mb-10 flex items-center gap-4">
          <div className="w-12 h-12 bg-pink-500/10 text-pink-400 rounded-2xl flex items-center justify-center border border-pink-500/20 shadow-lg shadow-pink-500/5">
            <User size={24} />
          </div>
          <div>
            <span className="block text-xl tracking-tight">Profile & Branding</span>
            <span className="block text-[10px] font-black uppercase tracking-[0.3em] text-white/20 mt-1">Your name, color & logo</span>
          </div>
        </h2>

        <Toast msg={profileMsg} />

        <div className="space-y-8">
          {/* Display Name */}
          <div>
            <label className={LABEL}>Your Name / Brand Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Shanti Studios"
              className={INPUT}
            />
          </div>

          {/* Brand Color */}
          <div>
            <label className={`${LABEL} flex items-center gap-1.5`}>
              <Palette size={12} /> Brand Accent Color
            </label>
            <div className="grid grid-cols-6 gap-2">
              {BRAND_COLORS.map((color) => (
                <button
                  key={color.hex}
                  type="button"
                  onClick={() => setBrandColorHex(color.hex)}
                  title={color.name}
                  className={`h-12 rounded-xl transition-all relative ${color.bg} ${
                    brandColorHex === color.hex
                      ? "ring-4 ring-white/20 scale-95 border border-white"
                      : "opacity-60 hover:opacity-100 hover:scale-95"
                  }`}
                >
                  {brandColorHex === color.hex && (
                    <span className="absolute inset-0 flex items-center justify-center text-white font-bold drop-shadow">
                      ✓
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Logo URL */}
          <div>
            <label className={LABEL}>Logo URL (optional)</label>
            <input
              type="url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://..."
              className={INPUT}
            />
            {logoUrl && (
              <img
                src={logoUrl}
                alt="Logo preview"
                className="mt-3 h-14 rounded-xl object-contain bg-white/5 p-2 border border-white/10"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            )}
          </div>

          {/* Save */}
          <button
            onClick={handleSaveProfile}
            disabled={profileSaving}
            className="w-full py-5 bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white rounded-[2rem] font-black uppercase tracking-[0.4em] text-sm shadow-[0_20px_50px_-10px_rgba(236,72,153,0.4)] transition-all disabled:opacity-30 flex items-center justify-center gap-4 group"
          >
            {profileSaving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} className="group-hover:scale-110 transition-transform" />}
            {profileSaving ? "Saving…" : "Save Profile"}
          </button>
        </div>
      </div>

      {/* ── B) Change Password ────────────────────────────────────────────── */}
      <div className={CARD} style={CARD_STYLE}>
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/[0.03] blur-[100px] -z-10" />
        <h2 className="text-2xl font-black text-white mb-10 flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-500/10 text-blue-400 rounded-2xl flex items-center justify-center border border-blue-500/20 shadow-lg shadow-blue-500/5">
            <Shield size={24} />
          </div>
          <div>
            <span className="block text-xl tracking-tight">Change Password</span>
            <span className="block text-[10px] font-black uppercase tracking-[0.3em] text-white/20 mt-1">Update your login credentials</span>
          </div>
        </h2>

        <div className="mb-8 p-6 bg-blue-500/5 rounded-2xl border border-blue-500/10 text-blue-400 text-[11px] font-black uppercase tracking-widest leading-relaxed flex items-start gap-4">
          <Zap size={18} className="flex-shrink-0 mt-0.5" />
          <p>Security Notice: Changing your password will log you out of all other active sessions across devices.</p>
        </div>

        <Toast msg={pwdMsg} />

        <form onSubmit={handlePasswordUpdate} className="space-y-8">
          <div>
            <label className={LABEL}>Current Password</label>
            <input type="password" name="currentPassword" required placeholder="Enter current password" className={INPUT} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <label className={LABEL}>New Password (min 6 characters)</label>
              <input type="password" name="newPassword" required minLength={6} placeholder="Enter new password" className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>Confirm New Password</label>
              <input type="password" name="confirmPassword" required placeholder="Re-enter new password" className={INPUT} />
            </div>
          </div>
          <button
            type="submit"
            disabled={pwdSubmitting}
            className="w-full py-5 bg-blue-600 hover:bg-blue-500 text-white rounded-[2rem] font-black uppercase tracking-[0.4em] text-sm shadow-[0_20px_50px_-10px_rgba(59,130,246,0.5)] transition-all disabled:opacity-30 flex items-center justify-center gap-4 group"
          >
            {pwdSubmitting ? <Loader2 className="animate-spin" size={20} /> : <Shield size={20} className="group-hover:rotate-12 transition-transform" />}
            {pwdSubmitting ? "Updating…" : "Update Password"}
          </button>
        </form>
      </div>

      {/* ── C) Account Info (read-only) ───────────────────────────────────── */}
      <div className={CARD} style={CARD_STYLE}>
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-emerald-600/[0.03] blur-[100px] -z-10" />
        <h2 className="text-2xl font-black text-white mb-10 flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-500/10 text-emerald-400 rounded-2xl flex items-center justify-center border border-emerald-500/20 shadow-lg shadow-emerald-500/5">
            <Info size={24} />
          </div>
          <div>
            <span className="block text-xl tracking-tight">Account Info</span>
            <span className="block text-[10px] font-black uppercase tracking-[0.3em] text-white/20 mt-1">Your account details</span>
          </div>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[
            { label: "Email Address",   value: user?.email ?? "—" },
            { label: "Account Plan",    value: planLabel },
            { label: "Unique Event URL",value: eventUrlSlug },
            { label: "Member Since",    value: memberSince },
          ].map(({ label, value }) => (
            <div key={label} className="p-6 bg-white/[0.02] rounded-2xl border border-white/[0.06] space-y-2">
              <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">{label}</p>
              <p className="font-black text-white text-sm tracking-tight break-all">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Default Settings (browser prefs) ─────────────────────────────── */}
      <div className={CARD} style={CARD_STYLE}>
        <div className="absolute top-0 left-0 w-64 h-64 bg-purple-600/[0.03] blur-[100px] -z-10" />
        <h3 className="text-xl font-black text-white mb-10 flex items-center gap-4">
          <div className="w-12 h-12 bg-purple-500/10 text-purple-400 rounded-2xl flex items-center justify-center border border-purple-500/20 shadow-lg shadow-purple-500/5">
            <Layout size={24} />
          </div>
          <div>
            <span className="block text-xl tracking-tight">Default Settings</span>
            <span className="block text-[10px] font-black uppercase tracking-[0.3em] text-white/20 mt-1">Preferences saved in your browser</span>
          </div>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          <div>
            <label className={LABEL}>Default Template</label>
            <div className="relative group">
              <select
                className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white text-sm appearance-none cursor-pointer group-hover:border-white/20"
                defaultValue={typeof window !== "undefined" ? localStorage.getItem("defaultTemplate") ?? "wedding-template-01" : "wedding-template-01"}
                onChange={(e) => localStorage.setItem("defaultTemplate", e.target.value)}
              >
                <option value="wedding-template-01"        className="bg-[#0d0d17]">Wedding: Pink &amp; Gold</option>
                <option value="half-saree-template-01"     className="bg-[#0d0d17]">Half Saree: Emerald</option>
                <option value="dhoti-ceremony-template-01" className="bg-[#0d0d17]">Dhoti: Royal Blue</option>
                <option value="engagement-template-01"     className="bg-[#0d0d17]">Engagement</option>
                <option value="birthday-template-01"       className="bg-[#0d0d17]">Birthday</option>
              </select>
              <ChevronRight className="absolute right-5 top-1/2 -translate-y-1/2 rotate-90 text-white/20 pointer-events-none" size={20} />
            </div>
          </div>

          <div>
            <label className={LABEL}>Default YouTube Privacy</label>
            <div className="relative group">
              <select
                className="w-full p-5 bg-white/[0.03] border border-white/[0.08] rounded-2xl outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-black text-white text-sm appearance-none cursor-pointer group-hover:border-white/20"
                defaultValue={typeof window !== "undefined" ? localStorage.getItem("defaultYoutubePrivacy") ?? "public" : "public"}
                onChange={(e) => localStorage.setItem("defaultYoutubePrivacy", e.target.value)}
              >
                <option value="public"   className="bg-[#0d0d17]">Public (Everyone)</option>
                <option value="unlisted" className="bg-[#0d0d17]">Unlisted (Link Only)</option>
              </select>
              <ChevronRight className="absolute right-5 top-1/2 -translate-y-1/2 rotate-90 text-white/20 pointer-events-none" size={20} />
            </div>
          </div>
        </div>

        <div className="mt-10 p-6 bg-white/[0.02] rounded-2xl border border-white/[0.05] text-white/40 text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-4">
          <CheckCircle2 size={16} className="text-green-500" /> Preferences synchronized with local cache storage
        </div>
      </div>

      {/* ── Team Members ──────────────────────────────────────────────────── */}
      <div className={CARD} style={CARD_STYLE}>
        <div className="absolute bottom-0 right-0 w-64 h-64 bg-green-600/[0.03] blur-[100px] -z-10" />
        <h3 className="text-xl font-black text-white mb-10 flex items-center gap-4">
          <div className="w-12 h-12 bg-green-500/10 text-green-400 rounded-2xl flex items-center justify-center border border-green-500/20 shadow-lg shadow-green-500/5">
            <Users size={24} />
          </div>
          <div>
            <span className="block text-xl tracking-tight">Team Members</span>
            <span className="block text-[10px] font-black uppercase tracking-[0.3em] text-white/20 mt-1">Manage access</span>
          </div>
        </h3>

        <div className="space-y-4">
          <div className="p-6 bg-white/[0.03] rounded-3xl border border-white/[0.08] flex items-center justify-between group hover:bg-white/[0.05] transition-all">
            <div className="flex items-center gap-5">
              <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center font-black text-xl shadow-lg shadow-blue-600/20 group-hover:scale-105 transition-transform">
                {user?.email?.charAt(0).toUpperCase() ?? "A"}
              </div>
              <div>
                <p className="font-black text-white tracking-tight">{user?.email ?? "Super Admin"}</p>
                <p className="text-[10px] text-blue-500 font-black uppercase tracking-widest mt-1">Owner</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,1)]" />
              <span className="text-[10px] font-black text-green-400 uppercase tracking-[0.2em]">Active</span>
            </div>
          </div>
        </div>

        <button className="mt-10 px-6 py-4 bg-white/5 hover:bg-white/10 text-white/40 hover:text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] flex items-center gap-3 border border-white/5 transition-all">
          <PlusCircle size={18} /> Add Team Member (Coming Soon)
        </button>
      </div>

      {/* ── D) Custom Domains ─────────────────────────────────────────────── */}
      <div className={CARD} style={CARD_STYLE}>
        <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-600/[0.03] blur-[100px] -z-10" />
        <h2 className="text-2xl font-black text-white mb-10 flex items-center gap-4">
          <div className="w-12 h-12 bg-cyan-500/10 text-cyan-400 rounded-2xl flex items-center justify-center border border-cyan-500/20 shadow-lg shadow-cyan-500/5">
            <Globe size={24} />
          </div>
          <div>
            <span className="block text-xl tracking-tight">Custom Domains</span>
            <span className="block text-[10px] font-black uppercase tracking-[0.3em] text-white/20 mt-1">White-label your event URLs</span>
          </div>
        </h2>

        {/* Plan gate */}
        {!["pro", "agency"].includes(subscription?.plan_tier ?? "") ? (
          <div className="flex flex-col items-center gap-5 py-8 px-4 rounded-3xl border border-dashed border-white/10 text-center">
            <div className="w-16 h-16 bg-cyan-500/10 rounded-3xl flex items-center justify-center">
              <Globe size={28} className="text-cyan-400/40" />
            </div>
            <div className="space-y-2">
              <p className="text-white/40 text-sm font-black uppercase tracking-wider">
                Custom Domains require a{" "}
                <span className="text-cyan-400">Pro</span> or{" "}
                <span className="text-cyan-400">Agency</span> plan
              </p>
              <p className="text-white/20 text-xs font-black tracking-wider">
                Map{" "}
                <code className="text-cyan-400/50 font-mono">live.yourstudio.com</code>{" "}
                to serve fully white-labeled events
              </p>
            </div>
          </div>
        ) : (
          <>
            <Toast msg={domainMsg} />

            {/* Domain list */}
            {domainsLoading ? (
              <div className="flex items-center gap-3 text-white/30 text-sm font-black py-4">
                <Loader2 className="animate-spin" size={18} /> Loading domains…
              </div>
            ) : domains.length === 0 ? (
              <div className="py-6 text-center text-white/20 text-[11px] font-black uppercase tracking-widest">
                No custom domains configured yet
              </div>
            ) : (
              <div className="space-y-3 mb-8">
                {domains.map((d) => (
                  <DomainRow
                    key={d.id}
                    domain={d}
                    isRefreshing={refreshingId === d.id}
                    isRemoving={removingId === d.id}
                    onRefresh={() => handleRefreshStatus(d.id)}
                    onRemove={() => handleRemoveDomain(d.id)}
                  />
                ))}
              </div>
            )}

            {/* Add domain */}
            <div>
              <label className={LABEL}>Add Custom Domain</label>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddDomain()}
                  placeholder="live.yourstudio.com"
                  className={`${INPUT} flex-1`}
                />
                <button
                  onClick={handleAddDomain}
                  disabled={addingDomain || !newDomain.trim()}
                  className="px-6 py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-2xl font-black text-sm uppercase tracking-[0.2em] shadow-[0_10px_30px_-10px_rgba(6,182,212,0.4)] transition-all disabled:opacity-30 flex items-center gap-2 whitespace-nowrap"
                >
                  {addingDomain ? (
                    <Loader2 className="animate-spin" size={16} />
                  ) : (
                    <Plus size={16} />
                  )}
                  {addingDomain ? "Adding…" : "Add Domain"}
                </button>
              </div>
            </div>

            {/* DNS setup instructions (shown after add, or after status refresh) */}
            {setupInstructions && (
              <DnsSetupCard
                instructions={setupInstructions}
                onDismiss={() => setSetupInstructions(null)}
              />
            )}
          </>
        )}
      </div>

    </div>
  );
};
