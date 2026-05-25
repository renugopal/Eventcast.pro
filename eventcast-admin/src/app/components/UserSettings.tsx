"use client";

import { useState, useEffect, type CSSProperties, type ReactNode } from "react";
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

function Toast({ msg }: { msg: ToastMsg }) {
  if (!msg) return null;
  return (
    <div
      className="mb-6 p-4 rounded-xl flex items-center gap-3 text-sm font-semibold"
      style={
        msg.type === "success"
          ? { background: "var(--success-50)", border: "1px solid #A7F3D0", color: "var(--success)" }
          : { background: "var(--error-50)", border: "1px solid #FECDD3", color: "var(--error)" }
      }
    >
      {msg.type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
      {msg.text}
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  subtitle,
  iconStyle,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  iconStyle: CSSProperties;
}) {
  return (
    <div className="flex items-center gap-4 ec-settings-section-header">
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
        style={iconStyle}
      >
        {icon}
      </div>
      <div>
        <h2 className="ec-page-title" style={{ fontSize: "24px" }}>{title}</h2>
        <p className="ec-section-sub">{subtitle}</p>
      </div>
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
    active:  { background: "var(--success-50)", color: "var(--success)", border: "1px solid #A7F3D0" },
    pending: { background: "var(--accent-50)", color: "#92400E", border: "1px solid #FDE68A" },
    failed:  { background: "var(--error-50)", color: "var(--error)", border: "1px solid #FECDD3" },
  } as const;
  const icons = {
    active:  <CheckCircle2 size={11} />,
    pending: <Clock         size={11} />,
    failed:  <XCircle       size={11} />,
  } as const;
  return (
    <span className="ec-badge" style={styles[status]}>
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
  const isPending = domain.ssl_status === "pending" || domain.dns_status === "pending";
  useEffect(() => {
    if (!isPending || isRefreshing) return;
    const timer = setTimeout(onRefresh, 60_000);
    return () => clearTimeout(timer);
  }, [isPending, isRefreshing, onRefresh]);

  return (
    <div
      className="ec-card ec-card-sm flex items-center justify-between gap-4 transition-all"
      style={
        isPending
          ? { background: "var(--accent-50)", borderColor: "#FDE68A" }
          : undefined
      }
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">
          <p className="font-bold text-sm truncate" style={{ color: "var(--foreground)" }}>
            {domain.domain}
          </p>
          {isPending && (
            <span
              className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--warning)" }}
            >
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--warning)" }} />
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
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          title="Refresh DNS/SSL status"
          className="ec-icon-btn"
          aria-label="Refresh DNS/SSL status"
        >
          {isRefreshing ? (
            <Loader2 className="animate-spin" size={18} />
          ) : (
            <RefreshCw size={18} />
          )}
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={isRemoving}
          title="Remove domain"
          className="ec-icon-btn ec-icon-btn-danger"
          aria-label="Remove domain"
        >
          {isRemoving ? (
            <Loader2 className="animate-spin" size={18} />
          ) : (
            <Trash2 size={18} />
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
      <p className="ec-label" style={{ color: "var(--info)", marginBottom: 4 }}>{label}</p>

      <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
        <div
          className="p-3 rounded-xl font-mono text-xs truncate"
          style={{ background: "var(--surface-hover)", border: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}
        >
          <span style={{ color: "var(--text-tertiary)", marginRight: 8 }}>Name:</span>
          {name}
        </div>
        <button
          type="button"
          onClick={() => onCopy(name)}
          title="Copy name"
          className={`ec-btn ec-btn-sm ${copiedKey === name ? "ec-btn-primary text-white" : "ec-btn-secondary"}`}
        >
          {copiedKey === name ? <CheckCircle2 size={14} /> : <Copy size={14} />}
          {copiedKey === name && <span>Copied!</span>}
        </button>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
        <div
          className="p-3 rounded-xl font-mono text-xs truncate"
          style={{ background: "var(--surface-hover)", border: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}
        >
          <span style={{ color: "var(--text-tertiary)", marginRight: 8 }}>Value:</span>
          {value}
        </div>
        <button
          type="button"
          onClick={() => onCopy(value)}
          title="Copy value"
          className={`ec-btn ec-btn-sm ${copiedKey === value ? "ec-btn-primary text-white" : "ec-btn-secondary"}`}
        >
          {copiedKey === value ? <CheckCircle2 size={14} /> : <Copy size={14} />}
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
    <div
      className="mt-6 p-6 rounded-xl space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300"
      style={{ background: "var(--info-50)", border: "1px solid #BFDBFE" }}
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="ec-label" style={{ color: "var(--info)", marginBottom: 4 }}>
            DNS Setup Required
          </p>
          <p className="ec-section-sub">
            Add these records in your DNS provider for{" "}
            <span className="font-mono font-semibold" style={{ color: "var(--info)" }}>
              {instructions.domain}
            </span>
          </p>
        </div>
        <button type="button" onClick={onDismiss} className="ec-btn ec-btn-ghost ec-btn-sm">
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

      <p
        className="text-xs font-medium pt-2 border-t"
        style={{ color: "var(--text-tertiary)", borderColor: "var(--border-subtle)" }}
      >
        After adding these records, click the refresh icon on the domain row to check propagation. DNS updates may take up to 24 hours.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export const UserSettings: React.FC<UserSettingsProps> = ({ studioId, studioSlug, user }) => {
  const [displayName,   setDisplayName]   = useState("");
  const [brandColorHex, setBrandColorHex] = useState("#3b82f6");
  const [logoUrl,       setLogoUrl]       = useState("");
  const [studioData,    setStudioData]    = useState<any>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg,    setProfileMsg]    = useState<ToastMsg>(null);

  const [pwdSubmitting, setPwdSubmitting] = useState(false);
  const [pwdMsg,        setPwdMsg]        = useState<ToastMsg>(null);

  const [subscription,  setSubscription]  = useState<any>({ plan_tier: "free", status: "active" });

  const [domains,           setDomains]           = useState<StudioDomain[]>([]);
  const [domainsLoading,    setDomainsLoading]    = useState(false);
  const [newDomain,         setNewDomain]         = useState("");
  const [addingDomain,      setAddingDomain]      = useState(false);
  const [domainMsg,         setDomainMsg]         = useState<ToastMsg>(null);
  const [setupInstructions, setSetupInstructions] = useState<DomainSetupInstructions | null>(null);
  const [refreshingId,      setRefreshingId]      = useState<string | null>(null);
  const [removingId,        setRemovingId]        = useState<string | null>(null);

  useEffect(() => {
    if (!studioId) return;

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
    <div className="w-full pb-20 ec-animate-in ec-settings-page">

      <div className="ec-section-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="ec-page-title">Settings</h1>
          <p className="ec-section-sub">Studio profile, security, and preferences</p>
        </div>
      </div>

      {/* Row 1 — Profile + Password */}
      <div className="ec-settings-grid">
      {/* ── A) Profile & Branding ─────────────────────────────────────────── */}
      <div className="ec-card ec-settings-card border-l-4 border-l-pink-500">
        <SectionHeader
          icon={<User size={24} />}
          title="Profile & Branding"
          subtitle="Your name, color & logo"
          iconStyle={{ background: "#FFF1F2", color: "#E11D48", border: "2px solid #FECDD3" }}
        />

        <Toast msg={profileMsg} />

        <div className="ec-settings-body">
          <div className="ec-settings-field">
            <label className="ec-label">Your Name / Brand Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Shanti Studios"
              className="ec-input"
            />
          </div>

          <div className="ec-settings-field">
            <label className="ec-label flex items-center gap-1.5">
              <Palette size={12} /> Brand Accent Color
            </label>
            <div className="ec-color-grid">
              {BRAND_COLORS.map((color) => (
                <button
                  key={color.hex}
                  type="button"
                  onClick={() => setBrandColorHex(color.hex)}
                  title={color.name}
                  className={`h-10 rounded-lg transition-all relative ${color.bg} ${
                    brandColorHex === color.hex
                      ? "ring-4 ring-[var(--primary)] scale-95 border-2 border-white"
                      : "opacity-70 hover:opacity-100 hover:scale-95"
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

          <div className="ec-settings-field">
            <label className="ec-label">Logo URL (optional)</label>
            <input
              type="url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://..."
              className="ec-input"
            />
            {logoUrl && (
              <img
                src={logoUrl}
                alt="Logo preview"
                className="mt-3 h-14 rounded-xl object-contain p-2 border"
                style={{ background: "var(--surface-hover)", borderColor: "var(--border)" }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            )}
          </div>

          <div className="ec-settings-actions">
            <button
              type="button"
              onClick={handleSaveProfile}
              disabled={profileSaving}
              className="ec-btn ec-btn-lg ec-btn-primary w-full text-white"
            >
              {profileSaving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
              {profileSaving ? "Saving…" : "Save Profile"}
            </button>
          </div>
        </div>
      </div>

      {/* ── B) Change Password ────────────────────────────────────────────── */}
      <div className="ec-card ec-settings-card border-l-4 border-l-blue-500">
        <SectionHeader
          icon={<Shield size={24} />}
          title="Change Password"
          subtitle="Update your login credentials"
          iconStyle={{ background: "var(--info-50)", color: "var(--info)", border: "2px solid #BFDBFE" }}
        />

        <Toast msg={pwdMsg} />

        <form onSubmit={handlePasswordUpdate} className="ec-settings-body">
          <div
            className="ec-settings-note"
            style={{ background: "var(--info-50)", border: "1px solid #BFDBFE", color: "var(--info)" }}
          >
            <Zap size={18} className="flex-shrink-0 mt-0.5" />
            <p>Security Notice: Changing your password will log you out of all other active sessions across devices.</p>
          </div>
          <div className="ec-settings-field">
            <label className="ec-label">Current Password</label>
            <input type="password" name="currentPassword" required placeholder="Enter current password" className="ec-input" />
          </div>
          <div className="ec-settings-fields-row">
            <div className="ec-settings-field">
              <label className="ec-label">New Password (min 6 characters)</label>
              <input type="password" name="newPassword" required minLength={6} placeholder="Enter new password" className="ec-input" />
            </div>
            <div className="ec-settings-field">
              <label className="ec-label">Confirm New Password</label>
              <input type="password" name="confirmPassword" required placeholder="Re-enter new password" className="ec-input" />
            </div>
          </div>
          <div className="ec-settings-actions">
            <button
              type="submit"
              disabled={pwdSubmitting}
              className="ec-btn ec-btn-lg ec-btn-primary w-full text-white"
            >
              {pwdSubmitting ? <Loader2 className="animate-spin" size={20} /> : <Shield size={20} />}
              {pwdSubmitting ? "Updating…" : "Update Password"}
            </button>
          </div>
        </form>
      </div>
      </div>

      {/* Row 2 — Account + Defaults */}
      <div className="ec-settings-grid">
      {/* ── C) Account Info (read-only) ───────────────────────────────────── */}
      <div className="ec-card ec-settings-card border-l-4 border-l-emerald-500">
        <SectionHeader
          icon={<Info size={24} />}
          title="Account Info"
          subtitle="Your account details"
          iconStyle={{ background: "var(--success-50)", color: "var(--success)", border: "1px solid #A7F3D0" }}
        />

        <div className="ec-settings-body">
        <div className="ec-settings-info-grid">
          {[
            { label: "Email Address",    value: user?.email ?? "—" },
            { label: "Account Plan",     value: planLabel },
            { label: "Unique Event URL", value: eventUrlSlug },
            { label: "Member Since",     value: memberSince },
          ].map(({ label, value }) => (
            <div key={label} className="ec-settings-info-tile space-y-1">
              <p className="ec-label" style={{ marginBottom: 0 }}>{label}</p>
              <p className="font-bold text-sm break-all" style={{ color: "var(--foreground)" }}>{value}</p>
            </div>
          ))}
        </div>
        </div>
      </div>

      {/* ── Default Settings (browser prefs) ─────────────────────────────── */}
      <div className="ec-card ec-settings-card border-l-4 border-l-violet-500">
        <SectionHeader
          icon={<Layout size={24} />}
          title="Default Settings"
          subtitle="Preferences saved in your browser"
          iconStyle={{ background: "var(--primary-50)", color: "var(--primary)", border: "2px solid var(--violet-200)" }}
        />

        <div className="ec-settings-body">
        <div className="ec-settings-fields-row">
          <div className="ec-settings-field">
            <label className="ec-label">Default Template</label>
            <div className="relative">
              <select
                className="ec-input ec-input-has-chevron appearance-none cursor-pointer"
                defaultValue={typeof window !== "undefined" ? localStorage.getItem("defaultTemplate") ?? "wedding-template-01" : "wedding-template-01"}
                onChange={(e) => localStorage.setItem("defaultTemplate", e.target.value)}
              >
                <option value="wedding-template-01">Wedding: Pink &amp; Gold</option>
                <option value="half-saree-template-01">Half Saree: Emerald</option>
                <option value="dhoti-ceremony-template-01">Dhoti: Royal Blue</option>
                <option value="engagement-template-01">Engagement</option>
                <option value="birthday-template-01">Birthday</option>
              </select>
              <ChevronRight
                className="absolute right-4 top-1/2 -translate-y-1/2 rotate-90 pointer-events-none"
                size={18}
                style={{ color: "var(--text-tertiary)" }}
              />
            </div>
          </div>

          <div className="ec-settings-field">
            <label className="ec-label">Default YouTube Privacy</label>
            <div className="relative">
              <select
                className="ec-input ec-input-has-chevron appearance-none cursor-pointer"
                defaultValue={typeof window !== "undefined" ? localStorage.getItem("defaultYoutubePrivacy") ?? "public" : "public"}
                onChange={(e) => localStorage.setItem("defaultYoutubePrivacy", e.target.value)}
              >
                <option value="public">Public (Everyone)</option>
                <option value="unlisted">Unlisted (Link Only)</option>
              </select>
              <ChevronRight
                className="absolute right-4 top-1/2 -translate-y-1/2 rotate-90 pointer-events-none"
                size={18}
                style={{ color: "var(--text-tertiary)" }}
              />
            </div>
          </div>
        </div>

        <div
          className="ec-settings-note"
          style={{ background: "var(--success-50)", border: "1px solid #A7F3D0", color: "var(--success)" }}
        >
          <CheckCircle2 size={16} />
          Preferences synchronized with local cache storage
        </div>
        </div>
      </div>
      </div>

      {/* Row 3 — Team + Domains */}
      <div className="ec-settings-grid">
      {/* ── Team Members ──────────────────────────────────────────────────── */}
      <div className="ec-card ec-settings-card border-l-4 border-l-emerald-500">
        <SectionHeader
          icon={<Users size={24} />}
          title="Team Members"
          subtitle="Manage access"
          iconStyle={{ background: "var(--success-50)", color: "var(--success)", border: "1px solid #A7F3D0" }}
        />

        <div className="ec-settings-body">
        <div className="ec-settings-member-row">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center font-bold text-base text-white shrink-0"
              style={{ background: "var(--primary)" }}
            >
              {user?.email?.charAt(0).toUpperCase() ?? "A"}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm truncate" style={{ color: "var(--foreground)" }}>{user?.email ?? "Super Admin"}</p>
              <p className="ec-section-sub" style={{ color: "var(--primary)", fontWeight: 700, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Owner
              </p>
            </div>
          </div>
          <span className="ec-badge ec-badge-live shrink-0">Active</span>
        </div>
        <div className="ec-settings-actions">
          <button
            type="button"
            disabled
            className="ec-btn ec-btn-secondary w-full"
          >
            <PlusCircle size={18} /> Add Team Member (Coming Soon)
          </button>
        </div>
        </div>
      </div>

      {/* ── D) Custom Domains ─────────────────────────────────────────────── */}
      <div className="ec-card ec-settings-card border-l-4 border-l-cyan-500">
        <SectionHeader
          icon={<Globe size={24} />}
          title="Custom Domains"
          subtitle="White-label your event URLs"
          iconStyle={{ background: "var(--info-50)", color: "var(--info)", border: "2px solid #BFDBFE" }}
        />

        {!["pro", "agency"].includes(subscription?.plan_tier ?? "") ? (
          <div
            className="flex flex-col items-center gap-4 py-8 px-4 rounded-xl border border-dashed text-center"
            style={{ borderColor: "var(--border)" }}
          >
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: "var(--info-50)" }}
            >
              <Globe size={28} style={{ color: "var(--info)", opacity: 0.5 }} />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>
                Custom Domains require a{" "}
                <span style={{ color: "var(--info)" }}>Pro</span> or{" "}
                <span style={{ color: "var(--info)" }}>Agency</span> plan
              </p>
              <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                Map{" "}
                <code className="font-mono" style={{ color: "var(--info)" }}>live.yourstudio.com</code>{" "}
                to serve fully white-labeled events
              </p>
            </div>
          </div>
        ) : (
          <>
            <Toast msg={domainMsg} />

            {domainsLoading ? (
              <div className="flex items-center gap-3 text-sm font-medium py-4" style={{ color: "var(--text-tertiary)" }}>
                <Loader2 className="animate-spin" size={18} /> Loading domains…
              </div>
            ) : domains.length === 0 ? (
              <div className="py-6 text-center text-sm" style={{ color: "var(--text-tertiary)" }}>
                No custom domains configured yet
              </div>
            ) : (
              <div className="space-y-3 mb-6">
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

            <div>
              <label className="ec-label">Add Custom Domain</label>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddDomain()}
                  placeholder="live.yourstudio.com"
                  className="ec-input flex-1"
                />
                <button
                  type="button"
                  onClick={handleAddDomain}
                  disabled={addingDomain || !newDomain.trim()}
                  className="ec-btn ec-btn-lg ec-btn-primary text-white whitespace-nowrap"
                >
                  {addingDomain ? (
                    <Loader2 className="animate-spin" size={18} />
                  ) : (
                    <Plus size={18} />
                  )}
                  {addingDomain ? "Adding…" : "Add Domain"}
                </button>
              </div>
            </div>

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

    </div>
  );
};
