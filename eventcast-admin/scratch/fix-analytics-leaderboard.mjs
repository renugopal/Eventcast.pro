import fs from "fs";

const p = "src/app/components/AnalyticsDashboard.tsx";
let s = fs.readFileSync(p, "utf8");

const marker = 'className="text-right flex items-center gap-8';
const idx = s.indexOf(marker);
if (idx === -1) {
  console.error("start marker not found");
  process.exit(1);
}
const lineStart = s.lastIndexOf("\n", idx) + 1;

const rowClose = "\n                </motion.div>\n              );";
const rowCloseAlt = rowClose.replace(/motion\./g, "");
const end = s.indexOf(rowCloseAlt, idx);
if (end === -1) {
  console.error("end marker not found");
  process.exit(1);
}

const t = "div";
const replacement = [
  `<${t} className="ec-analytics-leaderboard-intensity">`,
  '  <div className="flex justify-between w-full text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>',
  "    <span>Intensity</span>",
  '    <span className="text-blue-600">{intensityPct}%</span>',
  `  </${t}>`,
  '  <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden border border-gray-200">',
  "    <motion.div ",
  '      className="bg-blue-500 h-full rounded-full transition-all duration-1000 ease-out" ',
  "      style={{ width: `${Math.min(100, intensityPct)}%` }} ",
  "    />",
  `  </${t}>`,
  `</${t}>`,
  "",
  `<${t} className="ec-analytics-leaderboard-views">`,
  '  <p className="font-black text-xl md:text-2xl tracking-tight leading-none group-hover:text-blue-600 transition-colors" style={{ color: "var(--foreground)" }}>{(event.view_count || 0).toLocaleString()}</p>',
  '  <p className="text-xs font-medium uppercase tracking-wide mt-1" style={{ color: "var(--text-tertiary)" }}>Total Views</p>',
  `</${t}>`,
]
  .map((line) => line.replace(/motion\./g, ""))
  .map((line) => (line.startsWith("  ") ? "                  " + line.trimStart() : "                  " + line))
  .join("\n");

s = s.slice(0, lineStart) + replacement + s.slice(end);

fs.writeFileSync(p, s);
console.log("patched AnalyticsDashboard leaderboard row");
