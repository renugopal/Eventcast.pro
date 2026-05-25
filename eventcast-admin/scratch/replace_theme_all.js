const fs = require('fs');
const path = require('path');

const filesToProcess = [
  '../src/app/components/PhotographerManagement.tsx',
  '../src/app/components/UserSettings.tsx',
  '../src/app/components/LiveMonitor.tsx',
  '../src/app/components/AnalyticsDashboard.tsx',
  '../src/app/components/GuestPhotoModeration.tsx',
  '../src/app/components/WishesModeration.tsx'
];

const replacements = [
  { from: /text-white\/30/g, to: 'text-[var(--text-tertiary)]' },
  { from: /text-white\/40/g, to: 'text-[var(--text-secondary)]' },
  { from: /text-white\/60/g, to: 'text-[var(--text-secondary)]' },
  { from: /text-white\/10/g, to: 'text-[var(--text-tertiary)]' },
  { from: /text-white\/20/g, to: 'text-[var(--text-tertiary)]' },
  { from: /text-white\/5/g, to: 'text-[var(--border-subtle)]' },
  { from: /bg-white\/\[0\.04\]/g, to: 'bg-[var(--bg-secondary)]' },
  { from: /bg-white\/\[0\.03\]/g, to: 'bg-[var(--bg-secondary)]' },
  { from: /hover:bg-white\/\[0\.03\]/g, to: 'hover:bg-[var(--bg-tertiary)]' },
  { from: /bg-white\/5/g, to: 'bg-[var(--bg-tertiary)]' },
  { from: /bg-white\/10/g, to: 'bg-[var(--border-subtle)]' },
  { from: /hover:bg-white\/10/g, to: 'hover:bg-[var(--border-subtle)]' },
  { from: /border-white\/\[0\.08\]/g, to: 'border-[var(--border-subtle)]' },
  { from: /border-white\/\[0\.05\]/g, to: 'border-[var(--border-subtle)]' },
  { from: /border-white\/10/g, to: 'border-[var(--border-subtle)]' },
  { from: /border-white\/5/g, to: 'border-transparent' },
  { from: /text-white(?!(\/[0-9]+|\]))/g, to: 'text-[var(--foreground)]' },
  { from: /bg-\[\#0d0d17\]/g, to: 'bg-white text-black' },
  { from: /rgba\(255,255,255,0\.02\)/g, to: 'var(--bg-secondary)' },
  { from: /rgba\(255,255,255,0\.08\)/g, to: 'var(--border-subtle)' },
  { from: /rgba\(255,255,255,0\.01\)/g, to: 'var(--bg-primary)' },
  { from: /bg-blue-600\/\[0\.03\]/g, to: 'bg-blue-500/10' },
  { from: /text-white/g, to: 'text-[var(--foreground)]' }, // catch remaining
  // Fix button text on hover that might have been changed to foreground erroneously
  { from: /hover:text-\[var\(--foreground\)\] bg-red/g, to: 'hover:text-white bg-red' },
  { from: /text-\[var\(--foreground\)\] font-black text-lg/g, to: 'text-white font-black text-lg' },
  { from: /text-\[var\(--foreground\)\] bg-/g, to: 'text-white bg-' },
];

for (const relPath of filesToProcess) {
  const filePath = path.join(__dirname, relPath);
  if (!fs.existsSync(filePath)) continue;

  let content = fs.readFileSync(filePath, 'utf8');

  for (const { from, to } of replacements) {
    content = content.replace(from, to);
  }

  // Special fixes
  content = content.replace(/bg-blue-600 text-\[var\(--foreground\)\]/g, 'bg-[var(--primary)] text-white');
  content = content.replace(/bg-red-600 text-\[var\(--foreground\)\]/g, 'bg-red-600 text-white');
  content = content.replace(/bg-red-500 hover:text-\[var\(--foreground\)\]/g, 'bg-red-500 hover:text-white');
  content = content.replace(/bg-blue-500 hover:text-\[var\(--foreground\)\]/g, 'bg-blue-500 hover:text-white');
  
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Updated ${relPath}`);
}
