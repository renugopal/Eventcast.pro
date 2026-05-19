"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { 
  Lock, Mail, Video, Loader2, AlertCircle, Camera, Globe, 
  Palette, CheckCircle2, ArrowRight, Sparkles 
} from "lucide-react";

const BRAND_COLORS = [
  { hex: "#3b82f6", name: "Classic Blue", bg: "bg-blue-500" },
  { hex: "#ec4899", name: "Rose Gold", bg: "bg-pink-500" },
  { hex: "#10b981", name: "Emerald Sage", bg: "bg-emerald-500" },
  { hex: "#8b5cf6", name: "Indigo Velvet", bg: "bg-violet-500" },
  { hex: "#f59e0b", name: "Royal Amber", bg: "bg-amber-500" },
  { hex: "#ef4444", name: "Crimson Silk", bg: "bg-red-500" },
];

export default function SignupPage() {
  const router = useRouter();
  
  // Form State
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [studioName, setStudioName] = useState("");
  const [slug, setSlug] = useState("");
  const [brandColorHex, setBrandColorHex] = useState("#3b82f6");
  
  // UI State
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSlugManuallyEdited, setIsSlugManuallyEdited] = useState(false);

  // Auto-generate slug from studio name
  useEffect(() => {
    if (!isSlugManuallyEdited && studioName) {
      const generated = studioName
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "") // Keep only alphanumeric, spaces, hyphens
        .trim()
        .replace(/\s+/g, "-") // Replace spaces with hyphens
        .replace(/-+/g, "-"); // Collapse consecutive hyphens
      setSlug(generated);
    }
  }, [studioName, isSlugManuallyEdited]);

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsSlugManuallyEdited(true);
    const value = e.target.value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, ""); // Allow only lowercase, numbers, hyphens
    setSlug(value);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/studios/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          studioName,
          slug,
          brandColorHex
        })
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create account. Please try again.");
      } else {
        setSuccess(true);
      }
    } catch (err) {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Premium Ambient Background Gradients */}
      <div className="absolute top-[-15%] left-[-15%] w-[50%] h-[50%] bg-blue-600/20 blur-[130px] rounded-full"></div>
      <div className="absolute bottom-[-15%] right-[-15%] w-[50%] h-[50%] bg-pink-600/10 blur-[130px] rounded-full"></div>

      <div className="max-w-lg w-full animate-in fade-in zoom-in duration-500 relative z-10 py-8">
        
        {/* Logo Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl shadow-xl shadow-blue-500/25 mb-4">
            <Video size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">Eventcast <span className="text-blue-500">PRO</span></h1>
          <p className="text-slate-400 mt-2">Start streaming your events in minutes</p>
        </div>

        {/* Signup / Success Card */}
        <div className="bg-slate-800/40 backdrop-blur-2xl p-8 rounded-3xl border border-slate-700/60 shadow-2xl">
          {success ? (
            <div className="text-center space-y-6 py-6 animate-in fade-in zoom-in duration-300">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full mb-2">
                <CheckCircle2 size={36} />
              </div>
              <h2 className="text-2xl font-black text-white">Account created!</h2>
              <p className="text-slate-300 leading-relaxed max-w-md mx-auto">
                Welcome, {studioName}! Your account is ready. We've set up your brand color and unique event URL:
                <span className="block mt-3 px-4 py-2 bg-slate-950/60 rounded-xl font-mono text-sm text-blue-400 border border-blue-500/10 truncate">
                  eventcast.pro/events/{slug}
                </span>
              </p>
              <div className="pt-4">
                <Link
                  href="/login"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-6 rounded-xl shadow-lg shadow-blue-600/20 transition-all flex items-center justify-center gap-2 group"
                >
                  Go to Control Center
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSignup} className="space-y-6">
              {error && (
                <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-center gap-3 text-red-400 text-sm">
                  <AlertCircle size={18} className="flex-shrink-0" />
                  <p>{error}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Email Address */}
                <div className="space-y-2 col-span-full">
                  <label className="text-xs font-black uppercase tracking-wider text-slate-400 ml-1">Business Email</label>
                  <div className="relative">
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="hello@brand.com"
                      className="w-full bg-slate-900/50 border border-slate-700/60 focus:border-blue-500 rounded-xl py-3 pl-11 pr-4 text-white placeholder:text-slate-600 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all text-sm font-medium"
                    />
                    <Mail className="absolute left-4 top-3.5 text-slate-500" size={16} />
                  </div>
                </div>

                {/* Password */}
                <div className="space-y-2 col-span-full">
                  <label className="text-xs font-black uppercase tracking-wider text-slate-400 ml-1">Password</label>
                  <div className="relative">
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min 6 characters"
                      className="w-full bg-slate-900/50 border border-slate-700/60 focus:border-blue-500 rounded-xl py-3 pl-11 pr-4 text-white placeholder:text-slate-600 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all text-sm font-medium"
                    />
                    <Lock className="absolute left-4 top-3.5 text-slate-500" size={16} />
                  </div>
                </div>

                {/* Brand Name */}
                <div className="space-y-2 md:col-span-1">
                  <label className="text-xs font-black uppercase tracking-wider text-slate-400 ml-1">Your Name / Brand Name</label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={studioName}
                      onChange={(e) => setStudioName(e.target.value)}
                      placeholder="e.g. Shanti Events"
                      className="w-full bg-slate-900/50 border border-slate-700/60 focus:border-blue-500 rounded-xl py-3 pl-11 pr-4 text-white placeholder:text-slate-600 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all text-sm font-medium"
                    />
                    <Camera className="absolute left-4 top-3.5 text-slate-500" size={16} />
                  </div>
                </div>

                {/* Custom Subdomain/Slug */}
                <div className="space-y-2 md:col-span-1">
                  <label className="text-xs font-black uppercase tracking-wider text-slate-400 ml-1">Your Unique Event URL</label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={slug}
                      onChange={handleSlugChange}
                      placeholder="e.g. shanti-events"
                      className="w-full bg-slate-900/50 border border-slate-700/60 focus:border-blue-500 rounded-xl py-3 pl-11 pr-4 text-white placeholder:text-slate-600 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all text-sm font-mono font-bold"
                    />
                    <Globe className="absolute left-4 top-3.5 text-slate-500" size={16} />
                  </div>
                </div>
              </div>

              {/* Dynamic URL Preview */}
              {slug && (
                <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-3.5 space-y-1.5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 block">Your Streaming Address Preview</span>
                  <div className="text-xs font-mono text-blue-400 truncate font-bold">
                    eventcast.pro/events/<span className="text-pink-400">{slug}</span>/[event-slug]
                  </div>
                </div>
              )}

              {/* Brand Accent Color */}
              <div className="space-y-3">
                <label className="text-xs font-black uppercase tracking-wider text-slate-400 ml-1 flex items-center gap-1.5">
                  <Palette size={14} /> Brand Accent Color
                </label>
                <div className="grid grid-cols-6 gap-2">
                  {BRAND_COLORS.map((color) => (
                    <button
                      key={color.hex}
                      type="button"
                      onClick={() => setBrandColorHex(color.hex)}
                      className={`h-10 rounded-xl transition-all relative ${color.bg} ${
                        brandColorHex === color.hex 
                          ? "ring-4 ring-white/20 scale-95 border border-white" 
                          : "opacity-60 hover:opacity-100 hover:scale-95"
                      }`}
                      title={color.name}
                    >
                      {brandColorHex === color.hex && (
                        <span className="absolute inset-0 flex items-center justify-center text-white text-xs font-bold drop-shadow">
                          ✓
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-500/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2 group text-sm"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="animate-spin" size={18} />
                    Setting up your account...
                  </>
                ) : (
                  <>
                    Create Your Free Account
                    <Sparkles size={16} className="group-hover:animate-pulse" />
                  </>
                )}
              </button>
            </form>
          )}
        </div>

        {/* Return to Login */}
        <p className="text-center text-slate-500 text-sm mt-8">
          Already have an account?{" "}
          <Link href="/login" className="text-blue-500 font-bold hover:underline">
            Log in here
          </Link>
        </p>

        <p className="text-center text-slate-600 text-xs mt-4">
          © 2026 Eventcast PRO • Premium Live Streaming Solutions
        </p>
      </div>
    </div>
  );
}
