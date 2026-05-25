"use client";

import { Video } from "lucide-react";

const BRAND_POINTS = [
  "Live streaming & event pages",
  "Guest wishes & photo wall",
  "Wallet billing & studio tools",
];

type AuthShellProps = {
  variant: "login" | "signup";
  cardTitle: string;
  cardSub: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

export function AuthShell({ variant, cardTitle, cardSub, children, footer }: AuthShellProps) {
  const brandTagline =
    variant === "login"
      ? "Sign in to manage events, streams, and your studio wallet."
      : "Create your studio account and start hosting events in minutes.";

  return (
    <div className="ec-auth-page">
      <div className="ec-auth-shell">
        <aside className="ec-auth-brand" aria-hidden={false}>
          <div className="ec-auth-brand-inner">
            <div className="ec-auth-brand-logo">
              <Video size={32} strokeWidth={2.25} />
            </div>
            <h1>
              Eventcast <span style={{ color: "var(--accent)" }}>PRO</span>
            </h1>
            <p>{brandTagline}</p>
            <ul className="ec-auth-brand-list">
              {BRAND_POINTS.map((point) => (
                <li key={point}>
                  <span aria-hidden />
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <main className="ec-auth-main">
          <div
            className={
              variant === "signup" ? "ec-auth-main-inner ec-auth-main-inner--signup" : "ec-auth-main-inner ec-auth-main-inner--login"
            }
          >
            <div className="ec-auth-mobile-brand">
              <div
                className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 mx-auto shadow-lg"
                style={{ background: "var(--primary)", color: "#fff" }}
              >
                <Video size={28} />
              </div>
              <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--foreground)" }}>
                Eventcast <span style={{ color: "var(--primary)" }}>PRO</span>
              </h1>
            </div>

            <div className="ec-auth-card">
              <h2 className="ec-auth-card-title">{cardTitle}</h2>
              <p className="ec-auth-card-sub">{cardSub}</p>
              {children}
              {footer ? (
                <div
                  className="w-full text-center text-sm"
                  style={{
                    marginTop: 32,
                    paddingTop: 32,
                    borderTop: "1px solid var(--border-subtle)",
                    color: "var(--text-secondary)",
                    lineHeight: 1.5,
                  }}
                >
                  {footer}
                </div>
              ) : null}
            </div>

            <p className="ec-auth-legal">
              Authorized personnel only. All access attempts are logged.
              <br />
              © 2026 Eventcast PRO • Premium live streaming solutions
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
