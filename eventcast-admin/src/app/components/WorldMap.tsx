"use client";

import React, { useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface CountryStat {
  country: string;   // ISO 3166-1 alpha-2 code e.g. 'IN'
  label: string;     // Display name e.g. 'India'
  count: number;
  percentage: number;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  label: string;
  count: number;
  percentage: number;
  code: string;
}

interface WorldMapProps {
  data: CountryStat[];
}

// ---------------------------------------------------------------------------
// Country name lookup (ISO → display name)
// ---------------------------------------------------------------------------
export const COUNTRY_NAMES: Record<string, string> = {
  IN: "India",
  US: "United States",
  GB: "United Kingdom",
  AE: "UAE",
  CA: "Canada",
  AU: "Australia",
  SG: "Singapore",
  MY: "Malaysia",
  SA: "Saudi Arabia",
  QA: "Qatar",
  KW: "Kuwait",
  BH: "Bahrain",
  OM: "Oman",
  DE: "Germany",
  FR: "France",
  NL: "Netherlands",
  SE: "Sweden",
  NO: "Norway",
  CH: "Switzerland",
  IT: "Italy",
  ES: "Spain",
  PL: "Poland",
  NZ: "New Zealand",
  ZA: "South Africa",
  KE: "Kenya",
  NG: "Nigeria",
  BR: "Brazil",
  MX: "Mexico",
  JP: "Japan",
  KR: "South Korea",
  CN: "China",
  PK: "Pakistan",
  BD: "Bangladesh",
  LK: "Sri Lanka",
  NP: "Nepal",
  Unknown: "Unknown",
};

// ---------------------------------------------------------------------------
// Colour helpers — density-based glow
// ---------------------------------------------------------------------------
function getRegionColor(count: number, maxCount: number): { fill: string; stroke: string; glow: boolean } {
  if (count === 0 || maxCount === 0) {
    return { fill: "rgba(255,255,255,0.04)", stroke: "rgba(255,255,255,0.06)", glow: false };
  }
  const ratio = count / maxCount;
  if (ratio >= 0.7) {
    return { fill: "rgba(99,179,237,0.55)", stroke: "rgba(99,179,237,0.9)", glow: true };
  } else if (ratio >= 0.4) {
    return { fill: "rgba(99,179,237,0.35)", stroke: "rgba(99,179,237,0.6)", glow: true };
  } else if (ratio >= 0.15) {
    return { fill: "rgba(99,179,237,0.18)", stroke: "rgba(99,179,237,0.4)", glow: false };
  }
  return { fill: "rgba(99,179,237,0.07)", stroke: "rgba(99,179,237,0.2)", glow: false };
}

// ---------------------------------------------------------------------------
// Flag emoji helper
// ---------------------------------------------------------------------------
export function flagEmoji(code: string): string {
  if (!code || code === "Unknown" || code.length !== 2) return "🌐";
  const base = 0x1F1E0 - 0x41;
  return String.fromCodePoint(base + code.charCodeAt(0)) +
         String.fromCodePoint(base + code.charCodeAt(1));
}

// ---------------------------------------------------------------------------
// SVG Region paths (simplified, stylized world outlines)
// Each path is a simplified polygon approximation of major world regions.
// viewBox: "0 0 1000 500"
// ---------------------------------------------------------------------------
const REGIONS: Array<{
  id: string;
  label: string;
  codes: string[];       // ISO codes this region covers
  d: string;             // SVG path data
  labelX: number;        // tooltip anchor X
  labelY: number;        // tooltip anchor Y
}> = [
  // ── India ──────────────────────────────────────────────────────────────
  {
    id: "IN",
    label: "India",
    codes: ["IN"],
    d: "M 620 195 L 640 185 L 660 190 L 670 205 L 665 225 L 655 245 L 645 265 L 635 280 L 625 265 L 615 245 L 610 225 L 615 210 Z",
    labelX: 640,
    labelY: 230,
  },
  // ── South Asia (Pak/BD/LK/NP) ────────────────────────────────────────
  {
    id: "SOUTH_ASIA",
    label: "South Asia",
    codes: ["PK", "BD", "LK", "NP"],
    d: "M 595 190 L 615 185 L 620 195 L 615 210 L 600 215 L 590 205 Z M 660 190 L 680 192 L 685 205 L 670 205 Z M 640 285 L 648 295 L 638 298 L 632 288 Z",
    labelX: 605,
    labelY: 200,
  },
  // ── Southeast Asia ───────────────────────────────────────────────────
  {
    id: "SEA",
    label: "SE Asia",
    codes: ["SG", "MY", "TH", "VN", "PH", "ID"],
    d: "M 680 220 L 710 215 L 730 225 L 735 245 L 725 255 L 705 260 L 690 250 L 680 235 Z M 720 265 L 740 260 L 750 275 L 735 282 L 720 278 Z",
    labelX: 710,
    labelY: 238,
  },
  // ── East Asia (JP/KR/CN) ─────────────────────────────────────────────
  {
    id: "EAST_ASIA",
    label: "East Asia",
    codes: ["JP", "KR", "CN", "TW"],
    d: "M 720 155 L 760 145 L 790 155 L 800 175 L 785 190 L 760 195 L 735 188 L 720 175 Z M 800 168 L 820 162 L 828 175 L 815 182 L 800 178 Z",
    labelX: 760,
    labelY: 168,
  },
  // ── Middle East / Gulf ───────────────────────────────────────────────
  {
    id: "GULF",
    label: "Gulf / Middle East",
    codes: ["AE", "SA", "QA", "KW", "BH", "OM", "IQ", "IR"],
    d: "M 555 190 L 590 180 L 600 190 L 595 210 L 580 220 L 560 220 L 545 210 L 548 196 Z",
    labelX: 572,
    labelY: 202,
  },
  // ── Western Europe ───────────────────────────────────────────────────
  {
    id: "W_EUROPE",
    label: "W. Europe",
    codes: ["GB", "DE", "FR", "NL", "BE", "CH", "AT", "SE", "NO", "DK", "FI", "IT", "ES", "PT", "IE"],
    d: "M 455 105 L 500 95 L 525 100 L 535 120 L 525 145 L 505 155 L 480 155 L 460 145 L 448 125 Z",
    labelX: 490,
    labelY: 127,
  },
  // ── Eastern Europe / Russia ───────────────────────────────────────────
  {
    id: "E_EUROPE",
    label: "E. Europe / Russia",
    codes: ["RU", "UA", "PL", "CZ", "SK", "HU", "RO", "BG", "GR"],
    d: "M 530 80 L 640 65 L 700 80 L 710 120 L 690 145 L 650 155 L 610 150 L 575 145 L 550 130 L 535 110 Z",
    labelX: 620,
    labelY: 112,
  },
  // ── North America ────────────────────────────────────────────────────
  {
    id: "N_AMERICA",
    label: "North America",
    codes: ["US", "CA", "MX"],
    d: "M 130 85 L 250 75 L 300 90 L 320 130 L 310 175 L 280 210 L 240 225 L 200 220 L 160 205 L 130 180 L 110 145 L 115 110 Z",
    labelX: 215,
    labelY: 150,
  },
  // ── South America ────────────────────────────────────────────────────
  {
    id: "S_AMERICA",
    label: "S. America",
    codes: ["BR", "AR", "CL", "CO", "VE", "PE"],
    d: "M 200 240 L 270 235 L 295 260 L 285 310 L 265 355 L 245 385 L 225 390 L 205 370 L 190 335 L 185 295 L 188 265 Z",
    labelX: 240,
    labelY: 308,
  },
  // ── Africa ────────────────────────────────────────────────────────────
  {
    id: "AFRICA",
    label: "Africa",
    codes: ["ZA", "NG", "KE", "EG", "ET", "GH", "TZ"],
    d: "M 460 200 L 510 190 L 540 205 L 545 245 L 535 290 L 510 330 L 485 355 L 462 345 L 445 310 L 440 270 L 445 235 Z",
    labelX: 492,
    labelY: 272,
  },
  // ── Australia / Oceania ───────────────────────────────────────────────
  {
    id: "OCEANIA",
    label: "Australia / NZ",
    codes: ["AU", "NZ"],
    d: "M 750 310 L 820 305 L 855 325 L 858 365 L 840 390 L 805 398 L 770 388 L 748 365 L 745 335 Z M 870 360 L 890 355 L 895 372 L 878 378 Z",
    labelX: 800,
    labelY: 350,
  },
  // ── Central Asia ──────────────────────────────────────────────────────
  {
    id: "C_ASIA",
    label: "Central Asia",
    codes: ["KZ", "UZ", "TM", "KG", "TJ", "AF"],
    d: "M 590 130 L 640 122 L 665 135 L 670 158 L 650 165 L 620 168 L 598 160 L 588 148 Z",
    labelX: 628,
    labelY: 148,
  },
];

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export const WorldMap: React.FC<WorldMapProps> = ({ data }) => {
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false, x: 0, y: 0, label: "", count: 0, percentage: 0, code: "",
  });
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Build a lookup: ISO code → count
  const countByCode: Record<string, number> = {};
  data.forEach((d) => { countByCode[d.country] = d.count; });

  // Max count for colour scaling
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  // Aggregate count per region (sum all matching ISO codes)
  function regionCount(codes: string[]): number {
    return codes.reduce((sum, c) => sum + (countByCode[c] ?? 0), 0);
  }

  function handleMouseEnter(
    e: React.MouseEvent<SVGPathElement>,
    region: typeof REGIONS[0],
    count: number,
  ) {
    const rect = (e.currentTarget.closest("svg") as SVGSVGElement).getBoundingClientRect();
    const pct = data.reduce((sum, d) => {
      if (region.codes.includes(d.country)) return sum + d.percentage;
      return sum;
    }, 0);
    setTooltip({
      visible: true,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top - 16,
      label: region.label,
      count,
      percentage: Math.round(pct * 10) / 10,
      code: region.id,
    });
    setHoveredId(region.id);
  }

  function handleMouseMove(e: React.MouseEvent<SVGPathElement>) {
    const rect = (e.currentTarget.closest("svg") as SVGSVGElement).getBoundingClientRect();
    setTooltip((prev) => ({ ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top - 16 }));
  }

  function handleMouseLeave() {
    setTooltip((prev) => ({ ...prev, visible: false }));
    setHoveredId(null);
  }

  return (
    <div className="relative w-full select-none">
      {/* SVG Map */}
      <svg
        viewBox="0 0 1000 500"
        className="w-full h-auto"
        style={{ filter: "drop-shadow(0 0 40px rgba(99,179,237,0.06))" }}
      >
        {/* Ocean background */}
        <rect width="1000" height="500" fill="rgba(10,14,26,0.6)" rx="16" />

        {/* Subtle grid lines */}
        {[100, 200, 300, 400].map((y) => (
          <line key={y} x1="0" y1={y} x2="1000" y2={y}
            stroke="rgba(255,255,255,0.025)" strokeWidth="1" />
        ))}
        {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((x) => (
          <line key={x} x1={x} y1="0" x2={x} y2="500"
            stroke="rgba(255,255,255,0.025)" strokeWidth="1" />
        ))}

        {/* Equator line */}
        <line x1="0" y1="245" x2="1000" y2="245"
          stroke="rgba(99,179,237,0.08)" strokeWidth="1" strokeDasharray="4 6" />

        {/* Regions */}
        {REGIONS.map((region) => {
          const cnt = regionCount(region.codes);
          const { fill, stroke, glow } = getRegionColor(cnt, maxCount);
          const isHovered = hoveredId === region.id;

          return (
            <g key={region.id}>
              {/* Glow effect for active regions */}
              {glow && (
                <path
                  d={region.d}
                  fill="rgba(99,179,237,0.12)"
                  filter="url(#regionGlow)"
                />
              )}
              {/* Pulsing ring for high-traffic regions */}
              {cnt > 0 && glow && (
                <circle
                  cx={region.labelX}
                  cy={region.labelY}
                  r="6"
                  fill="rgba(99,179,237,0.6)"
                  className="animate-ping"
                  style={{ transformOrigin: `${region.labelX}px ${region.labelY}px` }}
                />
              )}
              {/* Main region path */}
              <path
                d={region.d}
                fill={isHovered ? "rgba(99,179,237,0.45)" : fill}
                stroke={isHovered ? "rgba(99,179,237,1)" : stroke}
                strokeWidth={isHovered ? "1.5" : "0.8"}
                style={{
                  transition: "fill 0.3s ease, stroke 0.3s ease, filter 0.3s ease",
                  cursor: cnt > 0 ? "pointer" : "default",
                  filter: isHovered ? "brightness(1.4)" : "none",
                }}
                onMouseEnter={(e) => handleMouseEnter(e, region, cnt)}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
              />
              {/* Dot marker for active countries */}
              {cnt > 0 && (
                <circle
                  cx={region.labelX}
                  cy={region.labelY}
                  r="3"
                  fill="rgba(99,179,237,0.9)"
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}

        {/* SVG filter for glow */}
        <defs>
          <filter id="regionGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      </svg>

      {/* Tooltip */}
      {tooltip.visible && (
        <div
          className="pointer-events-none absolute z-50"
          style={{ left: tooltip.x + 12, top: tooltip.y }}
        >
          <div className="bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-3 shadow-2xl min-w-[160px]">
            <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-1">
              {tooltip.code === "Unknown" ? "🌐" : flagEmoji(tooltip.code)} {tooltip.label}
            </p>
            <p className="text-2xl font-black text-white leading-none">
              {tooltip.count.toLocaleString()}
            </p>
            <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mt-1">
              {tooltip.percentage}% of views
            </p>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-6 mt-4 px-2">
        <p className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em]">
          Intensity
        </p>
        <div className="flex items-center gap-2">
          {[
            { c: "rgba(255,255,255,0.06)", l: "No data" },
            { c: "rgba(99,179,237,0.15)", l: "Low" },
            { c: "rgba(99,179,237,0.35)", l: "Mid" },
            { c: "rgba(99,179,237,0.65)", l: "High" },
          ].map(({ c, l }) => (
            <div key={l} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm border border-white/10" style={{ background: c }} />
              <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">{l}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
