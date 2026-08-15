"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/client-auth";

export default function PlatformRetentionPage() {
  const [defaultDays, setDefaultDays] = useState<number | null>(null);
  const [draftDefaultDays, setDraftDefaultDays] = useState("");
  const [studioId, setStudioId] = useState("");
  const [overrideDays, setOverrideDays] = useState<number | null>(null);
  const [overrideInput, setOverrideInput] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPolicy();
  }, []);

  async function loadPolicy() {
    try {
      const res = await authFetch("/api/platform/retention-policy");
      const json = await res.json();
      if (json.success) {
        setDefaultDays(json.defaultRetentionDays);
        setDraftDefaultDays(String(json.defaultRetentionDays));
      }
    } catch {
      setError("Failed to load global retention policy");
    }
  }

  async function saveDefault() {
    setError(null);
    setMessage(null);
    const days = parseInt(draftDefaultDays, 10);
    if (!Number.isInteger(days) || days <= 0) {
      setError("Default retention days must be a positive integer");
      return;
    }
    try {
      const res = await authFetch("/api/platform/retention-policy", {
        method: "PATCH",
        body: JSON.stringify({ defaultRetentionDays: days }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error ?? "Failed to update the global default");
        return;
      }
      setDefaultDays(json.defaultRetentionDays);
      setMessage("Global default retention updated.");
    } catch {
      setError("Failed to update the global default");
    }
  }

  async function loadOverride() {
    setError(null);
    setMessage(null);
    if (!studioId.trim()) return;
    try {
      const res = await authFetch(`/api/platform/studios/${encodeURIComponent(studioId.trim())}/retention-override`);
      const json = await res.json();
      if (!json.success) {
        setError(json.error ?? "Failed to load studio override");
        return;
      }
      setOverrideDays(json.retentionDays);
      setOverrideInput(json.retentionDays != null ? String(json.retentionDays) : "");
    } catch {
      setError("Failed to load studio override");
    }
  }

  async function saveOverride() {
    setError(null);
    setMessage(null);
    const days = parseInt(overrideInput, 10);
    if (!Number.isInteger(days) || days <= 0) {
      setError("Override retention days must be a positive integer");
      return;
    }
    try {
      const res = await authFetch(`/api/platform/studios/${encodeURIComponent(studioId.trim())}/retention-override`, {
        method: "PUT",
        body: JSON.stringify({ retentionDays: days }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error ?? "Failed to set the studio override");
        return;
      }
      setOverrideDays(days);
      setMessage("Studio retention override saved.");
    } catch {
      setError("Failed to set the studio override");
    }
  }

  async function clearOverride() {
    setError(null);
    setMessage(null);
    try {
      const res = await authFetch(`/api/platform/studios/${encodeURIComponent(studioId.trim())}/retention-override`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error ?? "Failed to clear the studio override");
        return;
      }
      setOverrideDays(null);
      setOverrideInput("");
      setMessage("Studio retention override cleared — the global default now applies to future freezes.");
    } catch {
      setError("Failed to clear the studio override");
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: "20px", fontWeight: 800, marginBottom: "16px" }}>Retention Policies</h1>

      {error && <p style={{ color: "var(--error)", marginBottom: "12px" }}>{error}</p>}
      {message && <p style={{ color: "var(--success)", marginBottom: "12px" }}>{message}</p>}

      <div className="ec-card" style={{ padding: "16px", marginBottom: "16px" }}>
        <h2 style={{ fontSize: "15px", fontWeight: 700, marginBottom: "8px" }}>Global default (days)</h2>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px" }}>
          Current: {defaultDays ?? "…"}. Changing this affects only events whose retention freezes after this
          change — an already-frozen event&apos;s retention is never retroactively rewritten.
        </p>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            className="ec-input"
            type="number"
            min={1}
            value={draftDefaultDays}
            onChange={(e) => setDraftDefaultDays(e.target.value)}
            style={{ width: "120px" }}
          />
          <button type="button" className="ec-btn ec-btn-primary" onClick={saveDefault}>
            Save default
          </button>
        </div>
      </div>

      <div className="ec-card" style={{ padding: "16px" }}>
        <h2 style={{ fontSize: "15px", fontWeight: 700, marginBottom: "8px" }}>Studio-account override</h2>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px" }}>
          Overrides the global default for one studio only. Also never retroactively rewrites an
          already-frozen event.
        </p>
        <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
          <input
            className="ec-input"
            placeholder="Studio ID"
            value={studioId}
            onChange={(e) => setStudioId(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="button" className="ec-btn ec-btn-ghost" onClick={loadOverride}>
            Load
          </button>
        </div>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px" }}>
          Current override: {overrideDays != null ? `${overrideDays} days` : "none (global default applies)"}
        </p>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            className="ec-input"
            type="number"
            min={1}
            value={overrideInput}
            onChange={(e) => setOverrideInput(e.target.value)}
            style={{ width: "120px" }}
          />
          <button type="button" className="ec-btn ec-btn-primary" onClick={saveOverride}>
            Set / update override
          </button>
          <button type="button" className="ec-btn ec-btn-ghost" onClick={clearOverride}>
            Clear override
          </button>
        </div>
      </div>
    </div>
  );
}
