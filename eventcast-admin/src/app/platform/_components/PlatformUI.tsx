"use client";

import type { ReactNode } from "react";
import type { PlatformResource, UnavailableFact } from "../_lib/platformClient";

/**
 * Shared presentation primitives for the Platform Console.
 *
 * Extracted so every operational page renders headings, stat tiles, tables,
 * and — most importantly — "this fact has no authoritative source" notices
 * the same way. Uses the existing `ec-*` visual system and the same inline
 * style conventions as the already-shipped Platform pages; no new styling
 * framework is introduced.
 */

export function PageHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div style={{ marginBottom: "16px" }}>
      <h1 style={{ fontSize: "20px", fontWeight: 800 }}>{title}</h1>
      {description && (
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px", maxWidth: "70ch" }}>
          {description}
        </p>
      )}
    </div>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="ec-card" style={{ padding: "16px" }}>
      <div style={{ fontSize: "24px", fontWeight: 800 }}>{value}</div>
      <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{label}</div>
      {hint && <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "4px" }}>{hint}</div>}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "12px" }}>
      {children}
    </div>
  );
}

export function Section({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <div className="ec-card" style={{ padding: "16px", marginTop: "16px" }}>
      <h2 style={{ fontSize: "15px", fontWeight: 700, marginBottom: note ? "4px" : "10px" }}>{title}</h2>
      {note && (
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "10px", maxWidth: "80ch" }}>{note}</p>
      )}
      {children}
    </div>
  );
}

/**
 * The single way this console renders a fact it cannot honestly report.
 * Always shows the server-supplied reason verbatim — never a placeholder
 * number, never a dash that could read as zero.
 */
export function UnavailableNote({ label, fact }: { label: string; fact: UnavailableFact | { available: false; reason: string } }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: "8px",
        background: "var(--surface-2, rgba(0,0,0,0.03))",
        border: "1px dashed var(--border)",
        marginTop: "10px",
      }}
    >
      <strong style={{ fontSize: "12px" }}>{label}: unavailable</strong>
      <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px", maxWidth: "80ch" }}>{fact.reason}</p>
    </div>
  );
}

export function DefinitionList({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl style={{ display: "grid", gridTemplateColumns: "minmax(140px, max-content) 1fr", gap: "6px 16px", fontSize: "13px" }}>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: "contents" }}>
          <dt style={{ color: "var(--text-secondary)" }}>{label}</dt>
          <dd style={{ margin: 0, wordBreak: "break-word" }}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DataTable({
  columns,
  rows,
  emptyMessage,
}: {
  columns: string[];
  rows: ReactNode[][];
  emptyMessage: string;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
            {columns.map((column) => (
              <th key={column} style={{ padding: "10px", whiteSpace: "nowrap" }}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} style={{ borderBottom: "1px solid var(--border)" }}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} style={{ padding: "10px" }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} style={{ padding: "16px", color: "var(--text-secondary)" }}>
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Renders loading/error uniformly so each page only writes its ready state. */
export function ResourceGate<T>({
  resource,
  children,
}: {
  resource: PlatformResource<T>;
  children: (data: T) => ReactNode;
}) {
  if (resource.status === "loading") {
    return <p style={{ color: "var(--text-secondary)" }}>Loading…</p>;
  }
  if (resource.status === "error") {
    return <p style={{ color: "var(--error)" }}>{resource.message}</p>;
  }
  return <>{children(resource.data)}</>;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "not reported";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
