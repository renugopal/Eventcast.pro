"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Lock, Mail, Loader2, AlertCircle } from "lucide-react";
import { AuthShell } from "../components/AuthShell";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        router.push("/");
      }
    };
    checkUser();
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const { error: loginError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (loginError) {
        setError(loginError.message);
      } else {
        router.push("/");
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell
      variant="login"
      cardTitle="Welcome back"
      cardSub="Sign in to your studio dashboard"
      footer={
        <>
          Don&apos;t have a studio account?{" "}
          <Link href="/signup" className="font-semibold" style={{ color: "var(--primary)" }}>
            Create one here
          </Link>
        </>
      }
    >
      <form onSubmit={handleLogin} className="ec-auth-form">
        {error && (
          <div className="bg-red-50 border border-red-200 p-4 rounded-xl flex items-center gap-3 text-red-700 text-sm">
            <AlertCircle size={18} className="flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        <div>
          <label className="ec-auth-label" htmlFor="login-email">
            Admin email
          </label>
          <div className="relative ec-auth-input-wrap">
            <input
              id="login-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@eventcast.pro"
              className="ec-input w-full"
              autoComplete="email"
            />
            <Mail className="ec-auth-field-icon" size={18} />
          </div>
        </div>

        <div>
          <label className="ec-auth-label" htmlFor="login-password">
            Password
          </label>
          <div className="relative ec-auth-input-wrap">
            <input
              id="login-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="ec-input w-full"
              autoComplete="current-password"
            />
            <Lock className="ec-auth-field-icon" size={18} />
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
                <Loader2 className="animate-spin" size={20} />
                Authenticating…
              </>
            ) : (
              "Access dashboard"
            )}
          </button>
        </div>
      </form>
    </AuthShell>
  );
}
