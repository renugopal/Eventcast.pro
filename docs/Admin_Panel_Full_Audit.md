# Eventcast Admin Panel — Full System Audit

**Date:** May 16, 2026  
**Scope:** `eventcast-admin` (Next.js 16 / React 19)  
**Auditor:** Automated full-stack scan (UI/UX + Backend Data Architecture)  
**Verdict:** Functional but not production-hardened. Several critical gaps exist in backend reliability, security, and UI polish.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [UI/UX Assessment](#2-uiux-assessment)
   - 2.1 [Current State](#21-current-state)
   - 2.2 [Critical UI Defects](#22-critical-ui-defects)
   - 2.3 [Component Audit](#23-component-audit)
   - 2.4 [Design System Gaps](#24-design-system-gaps)
   - 2.5 [UI Rebuild Roadmap](#25-ui-rebuild-roadmap)
3. [Data Sync & Backend Automation](#3-data-sync--backend-automation)
   - 3.1 [Architecture Overview](#31-architecture-overview)
   - 3.2 [API Endpoint Inventory](#32-api-endpoint-inventory)
   - 3.3 [Disconnected States & Data Races](#33-disconnected-states--data-races)
   - 3.4 [Cron & Automation Reliability](#34-cron--automation-reliability)
   - 3.5 [Authentication & Security Gaps](#35-authentication--security-gaps)
4. [Hidden Errors & Edge Cases](#4-hidden-errors--edge-cases)
5. [Step-by-Step Rebuild Roadmap](#5-step-by-step-rebuild-roadmap)
6. [Priority Matrix](#6-priority-matrix)

---

## 1. Executive Summary

The Eventcast Admin Panel is a **bespoke Next.js 16 App Router SaaS dashboard** that orchestrates four external systems: Supabase (database), GitHub Pages (static site deployment), Restreamer/Datarhei (streaming infrastructure), and YouTube (live broadcast relay). The system is functionally complete for its core workflow but carries significant technical debt in three areas:

| Area | Rating | Key Problem |
|------|--------|-------------|
| UI/UX | ⚠️ 5/10 | Split visual languages, no design system, `alert()` dialogs, broken animations |
| Backend Reliability | ⚠️ 4/10 | No transactional safety across 4 systems, silent DB drift, optional auth on crons |
| Security | 🔴 3/10 | Cron endpoints publicly accessible when `CRON_SECRET` is unset, hardcoded credentials in scripts |

---

## 2. UI/UX Assessment

### 2.1 Current State

The UI has **two incompatible visual languages** that are never reconciled:

| Context | Theme | Colors | Feel |
|---------|-------|--------|------|
| Main admin shell | Light | `slate-50` / white / `blue-600` | Generic dashboard |
| LiveMonitor | Dark "mission control" | `#07070d` / red / blue | Separate product |
| Login page | Dark card | Glass effect | Separate product |

This creates a jarring context switch every time the user navigates to the Live Monitor tab — it feels like opening a different application.

**Stack fact-check:**
- Framework: Next.js `16.2.4`, React `19.2.4`
- Styling: Tailwind v4 (`@import "tailwindcss"` in `globals.css`) — **no `tailwind.config.ts`**
- Icons: `lucide-react`
- Component library: **None** (no shadcn/ui, no Radix UI, no CVA)
- Animations: `animate-in` / `fade-in` / `zoom-in` class names are used throughout but **`tailwindcss-animate` is not installed** — these animations are completely inert in the browser

### 2.2 Critical UI Defects

#### DEF-01: Broken Animations (All Pages)
`animate-in`, `fade-in-0`, `zoom-in-95`, `slide-in-from-top-2` are used in `Sidebar.tsx`, `login/page.tsx`, `DashboardHome.tsx`, `AssetLibrary.tsx`, `EventTable.tsx`, and modals — but `tailwindcss-animate` is **not in `package.json`**. These classes produce zero CSS output. Every entrance animation in the admin panel is silently dead.

#### DEF-02: Font Override Kills Brand Typography
`layout.tsx` loads **Geist** and **Geist Mono** as CSS variables `--font-geist-sans` / `--font-geist-mono`. But `globals.css` overrides `body` with:
```css
body {
  font-family: Arial, Helvetica, sans-serif;
}
```
Geist is downloaded but never rendered. Every text element shows Arial unless a component explicitly sets `font-sans` *and* that utility maps to `--font-geist-sans` (which it does not without a `tailwind.config.ts` entry).

#### DEF-03: `alert()` / `confirm()` as UX (8+ locations)
Browser native dialogs are used for all critical user feedback: stream restarts, event deletions, YouTube toggling, asset copy, password changes. This is not acceptable in a SaaS product. Specific locations:
- `EventTable.tsx` — delete events, copy stream key, restart stream
- `AssetPreviewModal.tsx` — "URL Copied!" confirm
- `WishesModeration.tsx` — delete wish
- `page.tsx` — password change, multiple event form actions

#### DEF-04: "System Online" is a Lie
In `LiveMonitor.tsx`, the top bar permanently displays **"System Online"** as a static string. This badge is not connected to the result of `fetchLiveStatus`. If the Restreamer API is down, the badge still shows green "System Online" while the stream list is empty or stale.

#### DEF-05: `SystemPulse` Shows 100% Health on API Failure
`SystemPulse.tsx` polls `/api/system/intelligence`. If the API call fails or returns `!json.success`, `loading` becomes `false` but `health` defaults to a hardcoded healthy value. The widget will display green/100% health scores even when Cloudinary is unreachable or over quota.

#### DEF-06: Duplicate Navigation Icon
In `Sidebar.tsx`, both "Moderation" and "Account Settings" are assigned the same `Settings` icon from `lucide-react`. This makes the navigation visually ambiguous on smaller viewports.

#### DEF-07: `key={index}` in Dynamic Lists
React reconciliation keys based on array index are used in:
- `LiveMonitor.tsx` — wishes list (`key={idx}`)
- `AssetLibrary.tsx` — asset grid (`key={i}`)

These cause incorrect DOM reuse when items are added, removed, or reordered.

#### DEF-08: `page.tsx` is a God Component
The root `page.tsx` is a single enormous client component handling: Supabase auth, all event data fetching, a full create/edit form with 20+ fields, tab routing, health modals, photographer management, and layout. This makes it untestable, extremely hard to maintain, and causes full re-renders on any state change.

#### DEF-09: Build Quality Gates Disabled
`next.config.ts` sets both `ignoreDuringBuilds: true` (ESLint) and `ignoreBuildErrors: true` (TypeScript). Production builds will succeed even with type errors and lint violations. This masks real bugs.

#### DEF-10: `AnalyticsDashboard` Reports Fabricated Metrics
"Unique Visitors" is calculated as `totalViews * 0.65` — a hardcoded 65% estimate with no statistical basis. This figure is displayed without any footnote, asterisk, or caveat. If shown to clients, this is a data integrity issue.

### 2.3 Component Audit

| Component | Purpose | Issues |
|-----------|---------|--------|
| `page.tsx` | Shell + all data + all tabs | God component; `alert()`; direct Supabase queries mixed with API calls |
| `Sidebar.tsx` | Navigation | Duplicate icons; dead animations |
| `LiveMonitor.tsx` | Live stream control | "System Online" lie; silent fetch errors; `key={idx}`; `any` types throughout |
| `DashboardHome.tsx` | Stats overview | `p.state === 'running'` string check vs LiveMonitor's object-shaped state — **inconsistent counting** |
| `EventTable.tsx` | Events CRUD | `alert()`/`confirm()` everywhere; inline `style` column widths; high complexity |
| `AnalyticsDashboard.tsx` | Stats | Fabricated "unique visitors" metric; dynamic bar heights via `style` |
| `AssetLibrary.tsx` | Asset browser | `key={i}`; dead animations |
| `AssetPreviewModal.tsx` | Media preview | `alert()` for copy feedback |
| `WishesModeration.tsx` | Wishes table | `window.confirm()` for delete |
| `SystemPulse.tsx` | Health widget | Shows healthy when API fails |
| `PhotographerManagement.tsx` | Photographer CRUD | Generally solid; form state managed from parent |

### 2.4 Design System Gaps

| Gap | Impact |
|-----|--------|
| No component library (shadcn/Radix) | Every UI element is hand-rolled with no accessibility, no keyboard navigation, no ARIA |
| No design token file (`tailwind.config.ts`) | Colors/spacing are hardcoded in each component; global rebranding requires touching 20+ files |
| No toast/notification system | 8+ `alert()` dialogs instead of toasts |
| No modal abstraction | Every modal is a one-off fixed overlay |
| No form validation library | Forms have ad-hoc client validation or none at all |
| No error boundary | Any component crash silently fails or cascades to a white screen |
| Split dark/light themes | No unified dark mode strategy; 3 different "dark" implementations |

### 2.5 UI Rebuild Roadmap

#### Phase A — Foundation (Week 1–2)

**A1. Fix `tailwind.config.ts` and Geist font**
```ts
// tailwind.config.ts
import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'monospace'],
      },
      colors: {
        brand: {
          50: '#f0f4ff',
          600: '#2563eb',
          900: '#1e3a8a',
        },
        surface: {
          DEFAULT: '#ffffff',
          muted: '#f8fafc',
          subtle: '#f1f5f9',
        }
      }
    }
  }
}
```

**A2. Install shadcn/ui and tailwindcss-animate**
```bash
npx shadcn@latest init
# Select: New York style, Zinc base color, CSS variables
```
This installs Radix UI primitives, tailwindcss-animate, CVA, and class-variance-authority — giving you Dialog, Toast, DropdownMenu, Sheet, Badge, and 40+ accessible components.

**A3. Replace all `alert()` / `confirm()` with shadcn `<Toast>` and `<AlertDialog>`**
Priority targets: EventTable (5 instances), AssetPreviewModal, WishesModeration, page.tsx password change.

#### Phase B — Layout & Shell (Week 2–3)

**B1. Unify the visual language**
Choose one primary mode: **dark-first SaaS** (like Linear, Vercel, Raycast). Apply to the entire shell — not just LiveMonitor. This eliminates the jarring context switch and makes the product feel premium.

Recommended palette:
```css
/* globals.css */
:root {
  --background: 10 10 15;           /* near-black #0a0a0f */
  --surface: 16 16 24;              /* card bg #101018 */
  --surface-muted: 22 22 34;        /* subtle bg #161622 */
  --foreground: 248 250 252;        /* slate-50 */
  --muted-foreground: 148 163 184;  /* slate-400 */
  --border: 30 30 46;               /* subtle border */
  --accent: 99 102 241;             /* indigo-500 */
  --accent-foreground: 255 255 255;
}
```

**B2. Decompose `page.tsx`**
Break the god component into:
- `src/providers/EventProvider.tsx` — all event data fetching + state
- `src/app/(admin)/layout.tsx` — admin shell (sidebar + main area)
- `src/app/(admin)/dashboard/page.tsx` → `DashboardHome`
- `src/app/(admin)/events/page.tsx` → `EventTable`
- `src/app/(admin)/monitor/page.tsx` → `LiveMonitor`
- etc.

Use Next.js App Router route groups `(admin)` to share the shell layout without URL segments.

**B3. Sidebar upgrade**
- Fix duplicate `Settings` icon (use `Shield` for Moderation)
- Add active state indicator (left border accent or background pill)
- Add tooltip on collapsed state
- Use shadcn `<Sheet>` for the mobile drawer

#### Phase C — Component Quality (Week 3–4)

**C1. Fix LiveMonitor "System Online" status**
Wire the online badge to actual `fetchLiveStatus` response:
```tsx
const [systemStatus, setSystemStatus] = useState<'online' | 'degraded' | 'offline'>('offline')

// In fetchLiveStatus:
if (response.ok) setSystemStatus('online')
else setSystemStatus('offline')
```

**C2. Add skeleton loaders**
Replace blank states during loading with `shadcn <Skeleton>` components in:
- LiveMonitor stream grid (aspect-ratio skeleton cards)
- DashboardHome stats row
- EventTable rows

**C3. Add global `<ErrorBoundary>`**
Wrap each tab panel in a React error boundary so component crashes don't white-screen the entire admin.

**C4. Fix `AnalyticsDashboard` metrics**
Either remove "Unique Visitors" entirely or add a visible disclaimer: `"Estimated (±35%)"`. Better: replace with real session-based counting via Supabase.

**C5. Fix all `key={index}` usages**
Use stable IDs: `key={wish.id}`, `key={asset.public_id}`.

**C6. Re-enable build quality gates**
```ts
// next.config.ts
const nextConfig = {
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
}
```
Then fix the type errors that surface.

---

## 3. Data Sync & Backend Automation

### 3.1 Architecture Overview

```
Browser Client (authFetch)
       │
       ▼
Next.js API Routes (Edge Runtime)
       │
   ┌───┴──────────────────────────────────┐
   │                                       │
   ▼                                       ▼
Supabase DB                          Restreamer API
(events, wishes,                   (Datarhei Core v3)
 photographers,                  ┌──────┴──────────┐
 stream_alerts)                  │                 │
                                HLS            RTMP out
                                player         (YouTube)
                                               │
                                               ▼
                               YouTube Data API v3
                               (broadcasts, streams)
                                               │
                                               ▼
                               GitHub Git Data API
                               (static site on Pages)
```

The system has **no message queue, no saga/compensation pattern, and no distributed transaction** across these four systems. All multi-system operations are fire-and-continue sequences.

### 3.2 API Endpoint Inventory

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| POST | `/api/events/generate` | `requireAdmin` | Create/update event: Supabase → Restreamer → GitHub Pages |
| POST | `/api/events/delete` | `requireAdmin` | Delete event: Restreamer → Cloudinary → GitHub → Supabase |
| GET | `/api/media/live-status` | `requireAdmin` | List all Restreamer processes |
| POST | `/api/media/restart-channel` | `requireAdmin` | Restart one Restreamer process |
| POST | `/api/media/toggle-youtube` | `requireAdmin` | Enable/disable YouTube RTMP output |
| POST | `/api/youtube` | `requireAdmin` | Create YouTube broadcast + stream, bind, set thumbnail |
| POST | `/api/youtube/toggle-live` | `requireAdmin` | Update broadcast title + DB `youtube_status` |
| GET | `/api/youtube/sync-status` | `requireAdmin` | Fetch all broadcast states from YouTube API |
| POST | `/api/cloudinary-signature` | `requireAdmin` | Sign upload preset for client-side Cloudinary uploads |
| POST | `/api/resolve-url` | `requireAdmin` | Follow redirects for venue map URLs |
| GET | `/api/system/intelligence` | `requireAdmin` | Cloudinary usage → health score |
| GET | `/api/cron/sync-live-status` | `?secret=` (optional!) | Scheduled: YouTube title + status sync |
| GET | `/api/cron/stream-health-monitor` | `?secret=` (optional!) | Scheduled: Restreamer health + WhatsApp alerts |
| GET | `/api/assets` | — | **Disabled stub** (returns 404-style JSON) |

### 3.3 Disconnected States & Data Races

#### RACE-01: GitHub Branch Commit Race (HIGH)
`events/generate` and `events/delete` both follow the same pattern:
1. GET current branch ref → get commit SHA
2. GET current tree SHA
3. POST new tree
4. POST new commit
5. PATCH branch ref

If two events are published concurrently (e.g. bulk creation or rapid form submissions), both requests read the same "current" parent SHA. One commit will succeed; the other will get a **422 from GitHub** ("Update is not a fast-forward"). The second event's site will not be published, but its Supabase row already exists.

**Fix:** Use GitHub's `createOrUpdateFileContents` API (single-file PUT) instead of tree manipulation, or add a Redis/KV lock around the branch mutation sequence.

#### RACE-02: Partial Event Creation (MEDIUM-HIGH)
`events/generate` sequence:
1. ✅ Supabase `insert/update` — succeeds
2. ⚠️ Restreamer `setupChannel` — if fails, `notes` updated, **flow continues**
3. ❌ GitHub tree push — if fails, error returned

Result: DB row exists, Restreamer may or may not have a channel, GitHub site may or may not exist. The user gets an error response but the DB record is live. On retry, the `update` path handles the DB, but Restreamer and GitHub state is ambiguous.

**Fix:** Implement a `deployment_status` field on `events` (`pending | deploying | live | failed`) and a compensation/retry queue.

#### RACE-03: Partial Event Deletion (MEDIUM)
`events/delete` sequence (all errors are non-fatal except the last):
1. ⚠️ Restreamer delete — logged, continues
2. ⚠️ Cloudinary delete — logged, continues
3. ⚠️ GitHub folder delete — logged, continues
4. ❌ **Supabase row delete — if this fails, returns 500**

If Supabase delete fails after the first three steps succeed: the GitHub site is gone, the Restreamer channel is gone, Cloudinary assets are gone, but **the DB row still exists** pointing to non-existent infrastructure. The admin panel will show a broken event card.

**Fix:** Delete Supabase row first (the source of truth). If it succeeds, proceed with infrastructure cleanup as best-effort background tasks.

#### RACE-04: YouTube `toggle-live` DB Drift (MEDIUM)
In `youtube/toggle-live`:
```ts
// This block runs ONLY if supabaseAdmin is non-null
// supabaseAdmin is null if SUPABASE_SERVICE_ROLE_KEY is unset
await supabaseAdmin.from('events').update({ youtube_status: isLive ? 'live' : 'completed' })
// The result is not checked — .error is ignored
```
If the service role key is missing, YouTube title is updated but DB `youtube_status` stays stale forever. The cron `sync-live-status` may re-set it, but there is a window of drift.

#### RACE-05: OAuth Token Not Validated (MEDIUM)
`youtube/toggle-live` calls `fetch(tokenUrl)` to refresh the Google OAuth token but does **not check `tokenRes.ok`** before extracting `access_token`. A failed refresh yields `access_token: undefined`, which is silently sent as `Authorization: Bearer undefined` to YouTube — resulting in a 401 that surfaces as a confusing API error.

#### RACE-06: `media/toggle-youtube` Empty Service Key (MEDIUM)
```ts
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''  // empty string if unset
)
```
An empty string service role key creates a broken Supabase client. RLS will reject all queries silently, making it appear as if there is no `youtube_stream_key` for the event, causing the toggle to fail with a misleading error.

#### RACE-07: `youtube/sync-status` RLS Mismatch (LOW-MEDIUM)
This route calls `requireAdmin` (validates JWT) but then queries Supabase using the **anon client** without attaching the validated JWT. Whether data is returned depends entirely on Supabase RLS policies. If RLS requires authentication, this query may return empty rows while the route believes it has admin access.

### 3.4 Cron & Automation Reliability

#### CRON-01: No In-Repo Schedule Definition (HIGH)
Neither `vercel.json` nor any other config file defines the cron schedule. The crons exist as HTTP GET endpoints but their invocation schedule lives entirely in an external dashboard (Vercel Cron UI, UptimeRobot, etc.). This creates an undocumented operational dependency — if the external scheduler is reset or lost, crons silently stop running with no indication in the codebase.

**Fix:** Add `vercel.json`:
```json
{
  "crons": [
    { "path": "/api/cron/sync-live-status", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/stream-health-monitor", "schedule": "*/5 * * * *" }
  ]
}
```
Cron authentication via Vercel's built-in `CRON_JOB_EXECUTION_KEY` header is more reliable than a manual `?secret=` query param.

#### CRON-02: Unauthenticated Cron Endpoints (CRITICAL)
```ts
// Both cron routes:
if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```
The condition `process.env.CRON_SECRET && ...` means: **if `CRON_SECRET` is unset, skip the auth check entirely**. Both cron endpoints are publicly accessible GET requests that anyone can trigger, causing:
- Arbitrary YouTube API calls (rate limit consumption)
- Arbitrary Supabase writes to `stream_alerts`
- WhatsApp alerts sent to configured numbers

**Fix (immediate):**
```ts
const secret = request.nextUrl.searchParams.get('secret')
if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

#### CRON-03: Timezone Bug in Live Window Calculation
`cron/sync-live-status` parses `event_date` and `timer_target_time` using `new Date(string)` which interprets strings in the system/runtime timezone. Vercel Edge runs in UTC. If event times are stored as IST, the 12-hour live window will be shifted by 5h30m, causing cron to mark events as "completed" 5.5 hours early.

**Fix:** Store all timestamps as UTC in Supabase or use explicit UTC parsing.

#### CRON-04: `stream_alerts` Table Has No Migration
The `stream_alerts` table is referenced in `stream-health-monitor` with a DDL comment in the source file but no committed migration. If deployed to a new Supabase project, the insert will silently fail (no `stream_alerts` table).

**Fix:** Add a `supabase/migrations/` directory with a proper migration file.

### 3.5 Authentication & Security Gaps

| Issue | Severity | Detail |
|-------|----------|--------|
| Cron auth optional | CRITICAL | `CRON_SECRET` unset = public endpoints |
| No `middleware.ts` | HIGH | Admin auth relies on per-route `requireAdmin` — any new route that forgets to call it is unprotected by default |
| Hardcoded credentials in `src/scripts/seed.js` | HIGH | Supabase URL + service role key hardcoded in a script file; if committed to a public repo, credentials are exposed |
| `supabaseAdmin` fallback to `null` | MEDIUM | Several routes silently skip DB writes when service role key is missing |
| `SUPABASE_SERVICE_ROLE_KEY \|\| ''` fallback | MEDIUM | Creates broken client instead of failing fast |
| No rate limiting | MEDIUM | All API routes are rate-unlimited; `/api/events/generate` triggers GitHub + Restreamer on each call |
| Anon key in generated `config.js` | LOW | `NEXT_PUBLIC_SUPABASE_ANON_KEY` is embedded in every generated static event site; acceptable if RLS is properly configured, but RLS coverage is unverified |

---

## 4. Hidden Errors & Edge Cases

### React State Issues

| ID | Location | Issue |
|----|----------|-------|
| STATE-01 | `DashboardHome.tsx` | `p.state === 'running'` — compares process state as flat string. `LiveMonitor.tsx` treats `state` as an object (`{ exec: 'running' }`). These are inconsistent; live count on the dashboard may always show 0. |
| STATE-02 | `LiveMonitor.tsx` | Wishes list is filtered to `today` client-side using `new Date()` in the browser. If the user's browser timezone differs from Supabase storage timezone, the wishes feed may appear empty on valid event days. |
| STATE-03 | `page.tsx` | All tab panels are conditionally rendered with `activeTab ===` checks but not `React.memo`'d or `lazy`-loaded. Every tab mount/unmount triggers full re-initialization including Supabase fetches. |
| STATE-04 | `EventTable.tsx` | Optimistic UI patterns are missing; after a stream restart or YouTube toggle, UI shows stale state until the next 15-second poll. |

### Missing Error Boundaries

No `error.tsx` files exist in any App Router route segment. No React `<ErrorBoundary>` wrapper classes are implemented anywhere. A single component crash (e.g., HLS initialization error in `LiveMonitor`) will propagate upward and potentially white-screen the entire admin panel.

### Unhandled Edge Cases

| ID | Location | Edge Case |
|----|----------|-----------|
| EDGE-01 | `LiveMonitor.tsx` | HLS.js is loaded via `dynamic(() => import('hls.js'))`. If the import fails (network error, CSP), the stream card renders no fallback — blank area. |
| EDGE-02 | `events/generate` | Slug collision: if two events with the same name + type are created, the slug is identical. The second `insert` will fail or overwrite depending on constraint configuration — unclear from the code. |
| EDGE-03 | `events/delete` | If the GitHub delete call returns 404 (folder already gone), it is treated as a skip. But a 403 (token expired/revoked) is also silently swallowed in the outer catch, making it impossible to tell if the site was deleted or if the delete failed. |
| EDGE-04 | `restreamer.ts` | The JWT token cache is per-Edge-isolate. Under Vercel's serverless model, isolates are short-lived. Every cold start re-authenticates. Under high load with many cold starts, this can trigger Restreamer rate limiting on `/api/login`. |
| EDGE-05 | `youtube/toggle-live` | `scheduledStartTime: new Date().toISOString()` is set on every toggle — including when toggling OFF. This resets the broadcast's scheduled start time to "now" on every status change, which may corrupt the YouTube broadcast timeline. |
| EDGE-06 | `portal/[slug]/page.tsx` | The public portal page fetches event data using the **anon Supabase key**. No error boundary or structured not-found handling exists — if RLS blocks the query, the page silently shows no event data with no user-visible explanation. |

---

## 5. Step-by-Step Rebuild Roadmap

### Sprint 1 — Critical Security & Reliability (Week 1)

- [ ] **S1-01** Fix cron auth: make `CRON_SECRET` mandatory, not optional. Return 401 if not set.
- [ ] **S1-02** Remove hardcoded credentials from `src/scripts/seed.js`. Use `.env.local` + dotenv.
- [ ] **S1-03** Add `vercel.json` with explicit cron schedule definitions.
- [ ] **S1-04** Fix `media/toggle-youtube` empty service key fallback — throw if key is missing.
- [ ] **S1-05** Fix `youtube/toggle-live` OAuth check: `if (!tokenRes.ok) return 500`.
- [ ] **S1-06** Fix `youtube/toggle-live` DB update: await + check `.error`, log if supabaseAdmin is null.
- [ ] **S1-07** Create `middleware.ts` that protects `/api/*` routes by default, with explicit allowlist for public routes (`/api/cron/*` handled by their own secret).

### Sprint 2 — Backend Hardening (Week 2)

- [ ] **S2-01** Add `deployment_status` column to `events` table (`pending | deploying | live | failed`).
- [ ] **S2-02** Rewrite `events/generate` to update `deployment_status` at each step; surface failures without leaving orphan rows.
- [ ] **S2-03** Rewrite `events/delete` to delete Supabase row first, then clean up infrastructure as best-effort.
- [ ] **S2-04** Add `supabase/migrations/` directory with proper migration files for all referenced tables including `stream_alerts`.
- [ ] **S2-05** Fix timezone handling in `cron/sync-live-status`: store and parse all times as UTC.
- [ ] **S2-06** Fix `youtube/sync-status` to use the admin Supabase client (not anon) or attach the validated JWT.
- [ ] **S2-07** Fix `youtube/toggle-live` to not reset `scheduledStartTime` when toggling OFF.

### Sprint 3 — UI Foundation (Week 3)

- [ ] **S3-01** Create `tailwind.config.ts` with Geist font mapping and unified design tokens.
- [ ] **S3-02** Fix `globals.css` to remove the Arial override.
- [ ] **S3-03** Install `shadcn/ui`: `npx shadcn@latest init` (New York style, CSS variables).
- [ ] **S3-04** Install `tailwindcss-animate` and verify all existing `animate-in` classes now work.
- [ ] **S3-05** Add shadcn `<Toaster>` globally in `layout.tsx`.
- [ ] **S3-06** Replace all `alert()` / `confirm()` with `toast()` and `<AlertDialog>`.
- [ ] **S3-07** Re-enable TypeScript and ESLint build checks in `next.config.ts`. Fix all surfaced errors.

### Sprint 4 — Layout & Shell Redesign (Week 4)

- [ ] **S4-01** Implement unified dark-first color system across all surfaces.
- [ ] **S4-02** Decompose `page.tsx` into proper App Router route groups with separate page files.
- [ ] **S4-03** Create `src/providers/EventProvider.tsx` to centralize event data state.
- [ ] **S4-04** Fix `Sidebar.tsx`: unique icon per nav item, active state, shadcn `<Sheet>` for mobile.
- [ ] **S4-05** Add `error.tsx` and `loading.tsx` files in each route segment.
- [ ] **S4-06** Add React `<ErrorBoundary>` around each major tab panel.

### Sprint 5 — Component Polish (Week 5)

- [ ] **S5-01** Wire `LiveMonitor` system status badge to actual API health.
- [ ] **S5-02** Fix `SystemPulse` to show degraded/unknown state when API fails.
- [ ] **S5-03** Add skeleton loaders in LiveMonitor stream grid and DashboardHome stats.
- [ ] **S5-04** Fix `DashboardHome` live count: align with LiveMonitor's `state.exec === 'running'` check.
- [ ] **S5-05** Fix all `key={index}` instances with stable entity IDs.
- [ ] **S5-06** Add `AnalyticsDashboard` disclaimer or remove fabricated "Unique Visitors" metric.
- [ ] **S5-07** Add HLS.js error boundary in `LiveMonitor` `StreamCard`.

### Sprint 6 — Observability & DevX (Week 6)

- [ ] **S6-01** Add Sentry (or similar) for both client-side React error tracking and server-side API error capture.
- [ ] **S6-02** Add `src/types/` directory with shared TypeScript interfaces for `Event`, `Process`, `StreamHealth`, eliminating `any` types in `LiveMonitor.tsx`.
- [ ] **S6-03** Add Zod schema validation for all API request bodies.
- [ ] **S6-04** Set up GitHub Actions CI: type-check + lint on every PR.
- [ ] **S6-05** Add `@next/bundle-analyzer` to audit client bundle size (hls.js is large).

---

## 6. Priority Matrix

| Priority | ID | Item | Effort | Impact |
|----------|-----|------|--------|--------|
| 🔴 P0 | CRON-02 | Fix unauthenticated cron endpoints | 30 min | Security critical |
| 🔴 P0 | — | Remove hardcoded credentials from seed.js | 15 min | Security critical |
| 🔴 P0 | RACE-05 | Fix OAuth token validation in toggle-live | 30 min | Functionality broken |
| 🟠 P1 | RACE-01 | GitHub branch commit race condition | 2 days | Data integrity |
| 🟠 P1 | RACE-02 | Partial event creation leaves orphan rows | 1 day | Data integrity |
| 🟠 P1 | RACE-03 | Partial event deletion leaves zombie records | 1 day | Data integrity |
| 🟠 P1 | DEF-01 | Fix broken animations (install tailwindcss-animate) | 1 hour | UX polish |
| 🟠 P1 | DEF-02 | Fix Geist font override in globals.css | 30 min | Typography |
| 🟠 P1 | DEF-03 | Replace all `alert()` with toast system | 1 day | UX critical |
| 🟠 P1 | CRON-01 | Add vercel.json cron schedule | 1 hour | Operational reliability |
| 🟡 P2 | DEF-04 | Fix "System Online" lie in LiveMonitor | 1 hour | UX trust |
| 🟡 P2 | DEF-05 | Fix SystemPulse healthy-on-fail default | 1 hour | UX trust |
| 🟡 P2 | STATE-01 | Fix live count inconsistency (string vs object state) | 2 hours | Metric accuracy |
| 🟡 P2 | DEF-08 | Decompose page.tsx god component | 3 days | Maintainability |
| 🟡 P2 | CRON-03 | Fix timezone bug in cron live window | 2 hours | Correctness |
| 🟡 P2 | DEF-09 | Re-enable TypeScript + ESLint build checks | 1 day | Code quality |
| 🟢 P3 | — | Install shadcn/ui and unified design system | 1 week | Long-term quality |
| 🟢 P3 | DEF-10 | Fix fabricated analytics metric | 1 hour | Data integrity |
| 🟢 P3 | — | Add error boundaries and error.tsx segments | 1 day | Resilience |
| 🟢 P3 | — | Add Sentry observability | 1 day | Observability |
| 🟢 P4 | — | Unified dark-first design language | 2 weeks | Premium feel |
| 🟢 P4 | — | Add Zod request validation | 2 days | Type safety |
| 🟢 P4 | — | Add src/types/ shared interfaces | 1 day | Type safety |

---

*Report generated from static analysis of `D:/Eventcast.pro/eventcast-admin/src`. No runtime profiling was performed. All findings are based on source code inspection.*
