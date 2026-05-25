"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Lock, Mail, Loader2, AlertCircle, Camera, Globe,
  Palette, CheckCircle2, ArrowRight, Sparkles
} from "lucide-react";
import { AuthShell } from "../components/AuthShell";

const BRAND_COLORS = [
  { hex: "#5B21B6", name: "Deep Violet", className: "bg-violet-700" },
  { hex: "#3b82f6", name: "Classic Blue", className: "bg-blue-500" },
  { hex: "#ec4899", name: "Rose Gold", className: "bg-pink-500" },
  { hex: "#10b981", name: "Emerald Sage", className: "bg-emerald-500" },
  { hex: "#f59e0b", name: "Royal Amber", className: "bg-amber-500" },
  { hex: "#ef4444", name: "Crimson Silk", className: "bg-red-500" },
];

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [studioName, setStudioName] = useState("");
  const [slug, setSlug] = useState("");
  const [brandColorHex, setBrandColorHex] = useState("#5B21B6");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSlugManuallyEdited, setIsSlugManuallyEdited] = useState(false);

  useEffect(() => {
    if (!isSlugManuallyEdited && studioName) {
      const generated = studioName
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
      setSlug(generated);
    }
  }, [studioName, isSlugManuallyEdited]);

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsSlugManuallyEdited(true);
    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/studios/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, studioName, slug, brandColorHex }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create account. Please try again.");
      } else {
        setSuccess(true);
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <AuthShell variant="signup" cardTitle="Account created" cardSub="Your studio is ready to go">
        <div className="text-center space-y-5 py-2 animate-in fade-in zoom-in duration-300">
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-full mx-auto"
            style={{ background: "var(--success-50)", color: "var(--success)", border: "2px solid #A7F3D0" }}
          >
            <CheckCircle2 size={32} />
          </div>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            Welcome, <strong style={{ color: "var(--foreground)" }}>{studioName}</strong>! Your unique event URL:
          </p>
          <div className="ec-auth-url-preview text-left">
            <p className="ec-auth-label mb-1">Your streaming address</p>
            <p className="text-sm font-mono font-bold break-all" style={{ color: "var(--primary)" }}>
              eventcast.pro/events/{slug}
            </p>
          </div>
          <div
            className="w-full"
            style={{
              marginTop: 32,
              paddingTop: 32,
              borderTop: "1px solid var(--border-subtle)",
            }}
          >
            <Link
              href="/login"
              className="ec-btn ec-btn-lg ec-btn-primary text-white w-full"
            >
              Go to control center
              <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      variant="signup"
      cardTitle="Create your studio"
      cardSub="Free account — set up in under two minutes"
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-semibold" style={{ color: "var(--primary)" }}>
            Log in here
          </Link>
        </>
      }
    >
      <form onSubmit={handleSignup} className="ec-auth-form">
        {error && (
          <div className="bg-red-50 border border-red-200 p-4 rounded-xl flex items-center gap-3 text-red-700 text-sm">
            <AlertCircle size={18} className="flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        <div>
          <label className="ec-auth-label" htmlFor="signup-email">
            Business email
          </label>
          <div className="relative ec-auth-input-wrap">
            <input
              id="signup-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="hello@brand.com"
              className="ec-input w-full"
              autoComplete="email"
            />
            <Mail className="ec-auth-field-icon" size={18} />
          </div>
        </div>

        <div>
          <label className="ec-auth-label" htmlFor="signup-password">
            Password
          </label>
          <div className="relative ec-auth-input-wrap">
            <input
              id="signup-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 6 characters"
              className="ec-input w-full"
              autoComplete="new-password"
            />
            <Lock className="ec-auth-field-icon" size={18} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="ec-auth-label" htmlFor="signup-brand">
              Your name / brand name
            </label>
            <div className="relative ec-auth-input-wrap">
              <input
                id="signup-brand"
                type="text"
                required
                value={studioName}
                onChange={(e) => setStudioName(e.target.value)}
                placeholder="e.g. Shanti Events"
                className="ec-input w-full"
              />
              <Camera className="ec-auth-field-icon" size={18} />
            </div>
          </div>

          <div>
            <label className="ec-auth-label" htmlFor="signup-slug">
              Unique event URL
            </label>
            <div className="relative ec-auth-input-wrap">
              <input
                id="signup-slug"
                type="text"
                required
                value={slug}
                onChange={handleSlugChange}
                placeholder="shanti-events"
                className="ec-input w-full font-mono text-sm"
              />
              <Globe className="ec-auth-field-icon" size={18} />
            </div>
          </div>
        </div>

        {slug ? (
          <div className="ec-auth-url-preview">
            <p className="ec-auth-label mb-1">Preview</p>
            <p className="text-sm font-mono font-semibold break-all" style={{ color: "var(--primary)" }}>
              eventcast.pro/events/<span style={{ color: "var(--accent)" }}>{slug}</span>/[event-slug]
            </p>
          </div>
        ) : null}

        <div>
          <label className="ec-auth-label flex items-center gap-1.5 mb-3">
            <Palette size={14} style={{ color: "var(--primary)" }} />
            Brand accent color
          </label>
          <div className="ec-auth-color-grid">
            {BRAND_COLORS.map((color) => (
              <button
                key={color.hex}
                type="button"
                onClick={() => setBrandColorHex(color.hex)}
                className={`ec-auth-color-swatch ${color.className} ${
                  brandColorHex === color.hex ? "is-selected" : ""
                }`}
                title={color.name}
                aria-label={color.name}
                aria-pressed={brandColorHex === color.hex}
              />
            ))}
          </div>
        </div>

        <div
          className="w-full"
          style={{
            marginTop: 32,
            paddingTop: 32,
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          <button
            type="submit"
            disabled={isLoading}
            className="ec-btn ec-btn-lg ec-btn-primary text-white w-full"
          >
            {isLoading ? (
              <>
                <Loader2 className="animate-spin" size={18} />
                Setting up your account…
              </>
            ) : (
              <>
                Create free account
                <Sparkles size={16} />
              </>
            )}
          </button>
        </div>
      </form>
    </AuthShell>
  );
}
