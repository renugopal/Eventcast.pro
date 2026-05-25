const fs = require("fs");
const p = "d:/Eventcast.pro/eventcast-admin/src/app/components/UserSettings.tsx";
let t = fs.readFileSync(p, "utf8");

function fixDiv(s) {
  return s.replace(/<\/?motion\.div\b/g, (m) => m.replace("motion.", ""));
}

const teamOld = fixDiv(`        <motion.div className="ec-panel ec-card-sm flex items-center justify-between gap-4">
          <motion.div className="flex items-center gap-4">
            <motion.div
              className="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg text-white"
              style={{ background: "var(--primary)" }}
            >
              {user?.email?.charAt(0).toUpperCase() ?? "A"}
            </motion.div>
            <motion.div>
              <p className="font-bold" style={{ color: "var(--foreground)" }}>{user?.email ?? "Super Admin"}</p>
              <p className="ec-section-sub" style={{ color: "var(--primary)", fontWeight: 700, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Owner
              </p>
            </motion.div>
          </motion.div>
          <span className="ec-badge ec-badge-live">Active</span>
        </motion.div>

        <button
          type="button"
          disabled
          className="mt-6 ec-btn ec-btn-secondary"
        >
          <PlusCircle size={18} /> Add Team Member (Coming Soon)
        </button>`);

const teamNew = fixDiv(`        <motion.div className="ec-settings-body">
        <motion.div className="ec-settings-member-row">
          <motion.div className="flex items-center gap-3 min-w-0">
            <motion.div
              className="w-11 h-11 rounded-xl flex items-center justify-center font-bold text-base text-white shrink-0"
              style={{ background: "var(--primary)" }}
            >
              {user?.email?.charAt(0).toUpperCase() ?? "A"}
            </motion.div>
            <motion.div className="min-w-0">
              <p className="font-bold text-sm truncate" style={{ color: "var(--foreground)" }}>{user?.email ?? "Super Admin"}</p>
              <p className="ec-section-sub" style={{ color: "var(--primary)", fontWeight: 700, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Owner
              </p>
            </motion.div>
          </motion.div>
          <span className="ec-badge ec-badge-live shrink-0">Active</span>
        </motion.div>
        <motion.div className="ec-settings-actions">
          <button
            type="button"
            disabled
            className="ec-btn ec-btn-secondary w-full"
          >
            <PlusCircle size={18} /> Add Team Member (Coming Soon)
          </button>
        </motion.div>
        </motion.div>`);

if (!t.includes(teamOld.split("\n")[0])) {
  console.error("Team block not found");
  process.exit(1);
}
t = t.replace(teamOld, teamNew);

const pwdOld = fixDiv(`        <motion.div
          className="mb-6 p-4 rounded-xl flex items-start gap-3 text-sm font-medium"
          style={{ background: "var(--info-50)", border: "1px solid #BFDBFE", color: "var(--info)" }}
        >
          <Zap size={18} className="flex-shrink-0 mt-0.5" />
          <p>Security Notice: Changing your password will log you out of all other active sessions across devices.</p>
        </motion.div>

        <Toast msg={pwdMsg} />

        <form onSubmit={handlePasswordUpdate} className="ec-settings-body">
          <motion.div>
            <label className="ec-label">Current Password</label>`);

const pwdNew = fixDiv(`        <Toast msg={pwdMsg} />

        <form onSubmit={handlePasswordUpdate} className="ec-settings-body">
          <motion.div
            className="ec-settings-note"
            style={{ background: "var(--info-50)", border: "1px solid #BFDBFE", color: "var(--info)" }}
          >
            <Zap size={18} className="flex-shrink-0 mt-0.5" />
            <p>Security Notice: Changing your password will log you out of all other active sessions across devices.</p>
          </motion.div>
          <motion.div className="ec-settings-field">
            <label className="ec-label">Current Password</label>`);

if (t.includes(pwdOld.split("\n")[0])) {
  t = t.replace(pwdOld, pwdNew);
} else {
  console.warn("Pwd block not found, skipping");
}

t = t.replace(
  `<motion.div className="grid grid-cols-1 md:grid-cols-2 gap-5">`,
  fixDiv(`<motion.div className="ec-settings-fields-row">`)
);
t = t.replace(
  `<motion.div>\n              <label className="ec-label">New Password`,
  fixDiv(`<motion.div className="ec-settings-field">\n              <label className="ec-label">New Password`)
);
t = t.replace(
  `<motion.div>\n              <label className="ec-label">Confirm New Password`,
  fixDiv(`<motion.div className="ec-settings-field">\n              <label className="ec-label">Confirm New Password`)
);

t = t.replace(
  `<motion.div className="ec-settings-info-grid">`,
  fixDiv(`<motion.div className="ec-settings-body">\n        <motion.div className="ec-settings-info-grid">`)
);
t = t.replace(
  /(\s+<\/motion\.div>\s+\{\/\* ── Default Settings)/,
  fixDiv(`        </motion.div>$1`)
);

// Remove any accidental motion.div left in file
t = fixDiv(t);

fs.writeFileSync(p, t);
console.log("Patched UserSettings.tsx");
