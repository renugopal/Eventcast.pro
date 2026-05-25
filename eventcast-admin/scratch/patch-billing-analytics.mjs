import fs from "fs";

const walletPath = "d:/Eventcast.pro/eventcast-admin/src/app/components/Wallet.tsx";
const analyticsPath = "d:/Eventcast.pro/eventcast-admin/src/app/components/AnalyticsDashboard.tsx";

let w = fs.readFileSync(walletPath, "utf8");

w = w.replace(
  `<motion.div className="grid grid-cols-1 md:grid-cols-3 gap-6">`,
  `<div className="ec-billing-stat-grid">`
);
w = w.replace(`<div className="grid grid-cols-1 md:grid-cols-3 gap-6">`, `<div className="ec-billing-stat-grid">`);

const statCardOld = `className="ec-card p-8"`;
w = w.replaceAll(statCardOld, `className="ec-card ec-billing-stat-card"`);
w = w.replaceAll(
  `className="flex items-start justify-between mb-6"`,
  `className="ec-billing-stat-top"`
);
w = w.replaceAll(`marginBottom: 8`, `marginBottom: 6`);
w = w.replace(
  `<h3 className="text-4xl font-black text-[var(--foreground)] tracking-tight">\n            ₹{balance`,
  `<h3 className="text-3xl font-black text-[var(--foreground)] tracking-tight">\n            ₹{balance`
);
w = w.replace(
  `<h3 className="text-3xl font-black text-[var(--foreground)] tracking-tight">\n            {getTierDisplayName`,
  `<h3 className="text-2xl font-black text-[var(--foreground)] tracking-tight">\n            {getTierDisplayName`
);
w = w.replace(
  `<h3 className="text-4xl font-black text-[var(--foreground)] tracking-tight">\n            ₹{lifetimeTopup`,
  `<h3 className="text-3xl font-black text-[var(--foreground)] tracking-tight">\n            ₹{lifetimeTopup`
);

w = w.replace(
  `{/* ── Pricing Upgrade Grid ─────────────────────────────────────────────── */}
      <div className="space-y-8">`,
  `{/* ── Pricing Upgrade Grid ─────────────────────────────────────────────── */}
      <motion.div className="ec-billing-plans-section">`
);
w = w.replace(`<div className="space-y-8">`, `<div className="ec-billing-plans-section">`, 1);

w = w.replace(
  `<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">`,
  `<div className="ec-billing-plans-grid">`
);
w = w.replaceAll(
  `className="ec-card p-8 flex flex-col justify-between"`,
  `className="ec-card ec-billing-plan-card"`
);
w = w.replace(
  `className="ec-card p-8 flex flex-col justify-between border-2 relative"`,
  `className="ec-card ec-billing-plan-card border-2 relative"`
);

// Wrap each plan CTA
for (const tier of ["pay_per_event", "basic", "pro", "business"]) {
  const re = new RegExp(
    `(\\s+)(<button\\s+type="button"\\s+onClick=\\{\\(\\) => handleUpgradePlan\\("${tier}"\\)\\}[\\s\\S]*?</button>)`,
    "m"
  );
  w = w.replace(re, `$1<div className="ec-billing-plan-actions">$1$2$1</div>`);
}

w = w.replaceAll(`ec-btn ec-btn-lg w-full mt-8`, `ec-btn ec-btn-lg w-full`);

w = w.replace(
  `{/* ── Add-ons & Ledger ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">`,
  `{/* ── Add-ons & Ledger ─────────────────────────────────────────────────── */}
      <div className="ec-billing-bottom-grid">`
);
w = w.replace(
  `<div className="lg:col-span-1 space-y-6">`,
  `<div className="ec-billing-addon-stack">`
);
w = w.replace(`<div className="lg:col-span-2">`, `<div>`);

w = w.replaceAll(`className="ec-card p-6 border-l-4`, `className="ec-card ec-billing-addon-card border-l-4`);
w = w.replace(
  `<div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-bold text-[var(--foreground)]">Extra Destination</span>
                <span className="text-[var(--text-secondary)]">₹49 / dest</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-bold text-[var(--foreground)]">Bundle (5 Dests)</span>
                <span className="text-emerald-600 font-bold">₹99 / bundle</span>
              </motion.div>
            </motion.div>`,
  `<div className="ec-billing-addon-prices">
              <div className="ec-billing-addon-price-row">
                <span className="font-bold text-[var(--foreground)]">Extra Destination</span>
                <span className="text-[var(--text-secondary)]">₹49 / dest</span>
              </div>
              <div className="ec-billing-addon-price-row">
                <span className="font-bold text-[var(--foreground)]">Bundle (5 Dests)</span>
                <span className="text-emerald-600 font-bold">₹99 / bundle</span>
              </div>
            </motion.div>`
);

w = w.replaceAll(`motion.div`, `div`);

fs.writeFileSync(walletPath, w);

let a = fs.readFileSync(analyticsPath, "utf8");
a = a.replace(
  `<div className="w-full space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">`,
  `<div className="w-full pb-20 animate-in fade-in slide-in-from-bottom-4 duration-700 ec-analytics-page">`
);
a = a.replace(
  `<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">`,
  `<div className="ec-grid-stats">`
);
a = a.replace(
  `className="lg:col-span-3 ec-card relative overflow-hidden"`,
  `className="lg:col-span-3 ec-card ec-analytics-leaderboard relative overflow-hidden"`
);
a = a.replace(
  `<div className="space-y-3 relative z-10">`,
  `<div className="ec-analytics-leaderboard-list relative z-10">`
);

const leaderboardRowFrom = `                <div 
                  key={event.id} 
                  onClick={() => setSelectedEventId(event.id)}
                  className="flex items-center justify-between p-5 lg:p-6 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-md hover:bg-blue-50/40 cursor-pointer transition-all duration-200 group relative overflow-hidden active:scale-[0.995]"
                >
                  <div className="flex items-center gap-6 relative z-10 min-w-0">
                    <motion.div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center font-bold border border-gray-200 text-sm group-hover:scale-105 group-hover:text-blue-600 group-hover:border-blue-300 group-hover:bg-blue-50 transition-all duration-300" style={{ color: "var(--text-tertiary)" }}>`;

const leaderboardRowFromFixed = leaderboardRowFrom.replaceAll(`motion.div`, `motion.div`);

const leaderboardRowTo = `                <div 
                  key={event.id} 
                  onClick={() => setSelectedEventId(event.id)}
                  className="ec-analytics-leaderboard-row group"
                >
                  <div className="ec-analytics-leaderboard-main">
                    <div className="w-11 h-11 bg-gray-50 rounded-xl flex items-center justify-center font-bold border border-gray-200 text-sm group-hover:scale-105 group-hover:text-blue-600 group-hover:border-blue-300 group-hover:bg-blue-50 transition-all duration-300 shrink-0" style={{ color: "var(--text-tertiary)" }}>`;

if (a.includes(`className="flex items-center justify-between p-5 lg:p-6 bg-white`)) {
  a = a.replace(
    /                <div \n                  key=\{event\.id\} \n                  onClick=\{\(\) => setSelectedEventId\(event\.id\)\}\n                  className="flex items-center justify-between p-5 lg:p-6 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-md hover:bg-blue-50\/40 cursor-pointer transition-all duration-200 group relative overflow-hidden active:scale-\[0\.995\]"\n                >\n                  <div className="flex items-center gap-6 relative z-10 min-w-0">\n                    <div className="w-12 h-12 bg-gray-50/,
    `                <div 
                  key={event.id} 
                  onClick={() => setSelectedEventId(event.id)}
                  className="ec-analytics-leaderboard-row group"
                >
                  <div className="ec-analytics-leaderboard-main">
                    <div className="w-11 h-11 bg-gray-50`
  );
}

a = a.replace(
  `<div className="text-right flex items-center gap-8 lg:gap-12 relative z-10 flex-shrink-0">
                    <div className="hidden lg:flex flex-col items-end gap-2 w-52">`,
  `<motion.div className="ec-analytics-leaderboard-intensity">
                    <div className="flex flex-col gap-2 w-full">`
);
a = a.replace(
  `<div className="min-w-[88px]">`,
  `<div className="ec-analytics-leaderboard-views">`
);

a = a.replaceAll(`motion.div`, `div`);

fs.writeFileSync(analyticsPath, a);
console.log("done");
