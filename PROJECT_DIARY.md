# 📔 Eventcast Pro - Collaborative Development Journey

This diary is a detailed record of the evolution of Eventcast Pro. It documents the problems we encountered, our discussions on how to solve them, and the technical decisions that shaped the platform.

---

## 🏛️ Session 14: Cron Infrastructure Hardening & Custom Domain UX Polish
**Date: May 20, 2026**

### 🔍 Context
With the AI Sales Bot fully online from Session 13, we moved to Phase 3: hardening the cron infrastructure and polishing the Custom Domain white-label UX. Two critical production bugs were identified and fixed: a UTC/IST timezone shift causing live events to be marked "completed" 5.5 hours early, and the absence of an in-repo cron schedule definition.

### 🗣️ Our Discussion
We assessed that both Sprint A (Cron Hardening) and Sprint B (Custom Domain UX) needed to ship in this session. We decided A→B order because a broken timezone calculation in the cron jobs is a live production bug that affects every active ceremony, and cron stability is a prerequisite for everything else. We also identified that the `stream_alerts` table had no committed migration, meaning health monitor alerts were silently failing to persist.

### 🛠️ What we did & Why

**Sprint A — Cron & Infrastructure Hardening:**
1. **In-Repo Cron Schedules (`eventcast-admin/vercel.json`)**:
   - *What we did*: Created `vercel.json` defining `*/15 * * * *` for `sync-live-status` and `*/5 * * * *` for `stream-health-monitor`.
   - *Why*: Without this file, cron schedules only existed in an external dashboard. If that was reset or lost, cron jobs would silently stop with no indication in the codebase.
2. **IST Timezone Bug Fix (both cron routes)**:
   - *What we did*: Changed event start time parsing from `new Date(\`${date}T${time}\`)` to `new Date(\`${date}T${time}:00+05:30\`)` in both `sync-live-status/route.ts` and `stream-health-monitor/route.ts`.
   - *Why*: Vercel Edge runs in UTC. Without the explicit `+05:30` offset, an 8:00 AM IST ceremony was being parsed as 8:00 AM UTC (= 1:30 PM IST), causing the live window to shift by −5h30m and events to get marked "completed" during the ceremony.
3. **`stream_alerts` Supabase Migration (`0008_stream_alerts.sql`)**:
   - *What we did*: Created a formal migration file provisioning the `stream_alerts` table with indexes on `event_id`, `created_at`, `severity`, and proper RLS policies for studio-scoped reads and service-role inserts.
   - *Why*: The health monitor's DB insert was silently swallowed (table didn't exist). Alerts were logged to console but never persisted for historical review.

**Sprint B — Custom Domain UX Polish:**
1. **Inline Copy-Confirm Feedback (`UserSettings.tsx` → `DnsRecord`)**:
   - *What we did*: Added `copiedKey` state to `DnsSetupCard` and per-field copy-confirm UI — copy button flips to a green `CheckCircle2 + "Copied!"` badge for 2 seconds, then resets.
   - *Why*: Previously, clipboard writes were silent. Photographers had no confirmation that they'd copied the right value.
2. **Auto-Refresh Poller (`DomainRow`)**:
   - *What we did*: Added a `useEffect` inside `DomainRow` that triggers `onRefresh` automatically after 60 seconds whenever `ssl_status` or `dns_status` is still `"pending"`.
   - *Why*: Photographers shouldn't need to manually click refresh repeatedly while waiting for Cloudflare DNS propagation. The UI now self-updates.
3. **Pending State Visual Indicator**:
   - *What we did*: Added an amber pulsing `"Propagating"` badge and amber-tinted card background when a domain is pending.
   - *Why*: Makes it immediately clear which domains still need action vs which are fully active.

### 💡 Results & Learnings
All changes compiled with **100% TypeScript type-safety** (0 errors). Two production bugs eliminated. Custom domain UX now provides real-time feedback that makes the photographer onboarding experience feel premium and self-guided.
*Learning*: Always append explicit timezone offsets (`+05:30`) when parsing date strings in Edge runtimes. Edge workers always run in UTC regardless of the end user's location.

---

## 🏛️ Session 13: Gemini AI Sales Bot Stabilization & Cloudflare Edge Runtime Hardening

**Date: May 20, 2026**

### 🔍 Context
The AI Sales Bot ("The Rainmaker") floating drawer on the marketing page (`eventcast.pro`) was failing on load with a connection error: `"Oops, I had a small connection issue. Please try again!"`. We needed to diagnose the backend API route, resolve rate limits or credential issues, ensure Edge runtime environment compatibility, handle CORS, and secure the AI response flow.

### 🗣️ Our Discussion
We analyzed the Cloudflare Pages logs and local test scripts. We discovered that the Google Gemini API key was hitting quota limits on the free tier, and the Next.js Edge route was failing because the Gemini client was initialized globally, yielding an undefined API key during bundle parsing in Cloudflare's worker isolates. Additionally, we found that the Gemini SDK throws a fatal error if the chat history starts with a `model` role instead of a `user` role. We discussed refactoring the Next.js Edge handler to initialize dynamically per-request, adding preflight CORS options, upgrading to `gemini-2.5-flash`, and rewriting the frontend chat history serialization.

### 🛠️ What we did & Why
1. **Unthrottled GCP Billing & API Key**:
   - *What we did*: Linked the user's GCP billing account to the API project, raising the daily throttle limits to full pay-as-you-go capacity.
   - *Why*: To eliminate the `429 Quota Exceeded` errors that blocked the free-tier key.
2. **Next.js Edge Route Refactoring (`eventcast-admin/src/app/api/ai/sales-chat/route.ts`)**:
   - *What we did*: Relocated `GoogleGenerativeAI` initialization from the global file scope directly inside the `POST` request handler, dynamically fetching `process.env.NEXT_PUBLIC_GEMINI_API_KEY`.
   - *Why*: Cloudflare Edge evaluates global variables before environment variables are bound, causing empty keys. Dynamic initialization guarantees fresh and valid credential loading.
3. **CORS Enablement & OPTIONS Handler**:
   - *What we did*: Configured full CORS headers (`Access-Control-Allow-Origin`, `Access-Control-Allow-Headers`) and a custom `OPTIONS` preflight response in the API route.
   - *Why*: To allow secure, cross-origin chat requests from local testing environments (`file://`) and the live marketing domain.
4. **Upgrade to `gemini-2.5-flash`**:
   - *What we did*: Switched the model backend from `gemini-1.5-flash` to the modern, high-performance `gemini-2.5-flash`.
   - *Why*: To benefit from faster generation times, lower latency, and higher sales context comprehension.
5. **Frontend Chat History Alignment (`script.js`)**:
   - *What we did*: Changed initial `chatHistory` from starting with a simulated `model` greeting to an empty array `[]`.
   - *Why*: The Gemini SDK's `startChat` throws a fatal `500` error if the first message in the history is from the model. Starting with an empty history ensures that the first message sent to the backend is always from the `user` role, satisfying strict SDK requirements.

### 💡 Results & Learnings
The AI Sales Bot is now **100% online, unthrottled, and fully operational** in production! Incognito and fresh loads now instantly stream premium, dynamic sales responses, giving our marketing page an extremely premium, state-of-the-art interactive experience.
*Learning*: Edge runtime environments have strict parsing constraints; global scopes should never rely on process environment variables. SDK-specific payload sequences must be rigorously validated.

---

## 🏛️ Session 12: Cloudflare Custom Domains & Wallet Subscription Upgrades (Phase 2 Masterpiece)
**Date: May 18, 2026 (Night Session)**

### 🔍 Context
Following the successful deployment of our billing system, we designed and implemented the Phase 2 masterpiece: mapping custom user domains (e.g. `live.mystudio.com`) with automated SSL provisioning and DNS routing for absolute white-labeled wedding broadcasts. Additionally, we implemented a full-fledged "Purchase with Wallet Balance" feature, enabling users to instantly purchase or upgrade their subscription plan using loaded wallet credits.

### 🗣️ Our Discussion
We discussed creating a zero-dependency, Edge-compatible Cloudflare client on Next.js to directly handle custom hostnames under the target zone. We also planned a visually stunning Upgrade lock screen overlay in `UserSettings.tsx` for free/pay-per-event tiers, a seamless DNS setup ledger (`DnsSetupCard`) to display CNAME/TXT targets, and an automated balance deduction routing that charges ₹4,999 to immediately unlock Pro settings directly via prepaid credits.

### 🛠️ What we did & Why
1. **Custom Domain Database Schema (`0007_custom_domains_schema.sql`)**:
   - *What we did*: Designed schemas for `studio_domains` mapping hostname records with strict RLS permissions scoped to studio owners.
   - *Why*: To safely store custom mapping records with multi-tenant isolation.
2. **Prepaid Subscription Upgrade API (`POST /api/billing/subscription`)**:
   - *What we did*: Coded a secure backend API that validates wallet balance, deducts ₹4,999 for Pro or ₹9,999 for Agency, appends a `subscription` kind debit log in the prepaid ledger, and upgrades the studio tier in the database.
   - *Why*: To provide absolute payment convenience directly via prepaid wallet credits.
3. **Responsive Wallet Upgrade Card Actions (`Wallet.tsx`)**:
   - *What we did*: Integrated interactive "Activate Plan" and "Upgrade with Wallet" buttons inside Solo Broadcaster and Professional Studio cards.
   - *Why*: To empower photographers to upgrade their plans with a single click.
4. **Cloudflare SaaS API Client (`cloudflare.ts`)**:
   - *What we did*: Built edge-compatible fetch wrappers `cfAddCustomHostname`, `cfGetCustomHostname`, and `cfDeleteCustomHostname`.
   - *Why*: To interface directly with the Cloudflare Zones API for real-time certificate provisioning.
3. **Provisioning Route Handlers (`/api/domains`)**:
   - *What we did*: Programmed secure endpoints for `/add` (plan checking and database recording), `/status` (real-time propagation checking), and `/remove` (clean zone deletions).
   - *Why*: To cleanly expose safe domain transactions to the client.
4. **White-Label DNS Panel UI (`UserSettings.tsx`)**:
   - *What we did*: Integrated dynamic upgrade gates alongside domain creation input fields and DNS record details showing copyable CNAME and TXT keys.
   - *Why*: To empower pro photographers with absolute branding autonomy while encouraging subscription updates.

### 💡 Results & Learnings
All features successfully compiled with **100% type-safety** verified by the Next.js/TypeScript compiler! The core monetization and custom white-labeling framework of Eventcast Pro is officially alive and ready for launch!

---

## 🏛️ Session 11: B2B SaaS Monetization & Prepaid Wallet System (Phase 2 Launch)
**Date: May 18, 2026**

### 🔍 Context
Following the multi-tenant SaaS transformation, our goal was to implement the Phase 2 monetization engine: introducing a glassmorphic billing portal, a prepaid wallet model (charging ₹499 per new event), and high-end subscription tiers.

### 🗣️ Our Discussion
We planned a high-fidelity sandbox environment to simulate Razorpay credit top-ups during development without hitting live API limits. Additionally, we designed a highly resilient, transactional event generation pipeline featuring "pre-flight credit checks" and an "automatic rollback/refund safety net" to protect client balances against system crashes or generation timeouts.

### 🛠️ What we did & Why
1. **Postgres Billing Schema (`0006_billing_schema.sql`)**:
   - *What we did*: Designed schemas for `wallet_balances` (paise-based accounting), `transactions` (detailed auditable ledger), and `subscriptions` (pro/agency tiers).
   - *Why*: To ensure strict multi-tenant row-level security isolation for all studio financial data.
2. **Glassmorphic Wallet Component (`Wallet.tsx`)**:
   - *What we did*: Created an ultra-premium, dark-themed wallet UI displaying real-time balance metrics, tier cards, and transaction history logs.
   - *Why*: To wow creative studio operators and make it effortless to manage funds and upgrade subscriptions.
3. **Razorpay Sandbox Simulator**:
   - *What we did*: Added a beautiful Razorpay-styled simulation popup allowing one-click prepaid wallet loads during testing.
   - *Why*: To facilitate seamless, robust pre-production testing of the top-up pipelines.
4. **Tenant-Scoped Secure Billing APIs**:
   - *What we did*: Programmed secure endpoints `/api/billing/balance`, `/api/billing/transactions`, `/api/billing/subscription`, and `/api/billing/topup`.
   - *Why*: To securely authenticate and handle all wallet transactions on the server.
5. **Pre-flight Credit Engine with Auto-Refund Protection**:
   - *What we did*: Integrated credit verification into the `/api/events/generate` endpoint. It checks studio balance (charging ₹499 per event), executes secure debits, and performs a complete rollback/refund if the generation process fails.
   - *Why*: To maximize reliability and build trust with creative professionals.

### 💡 Results & Learnings
All additions successfully compiled with **100% type-safety** verified by the TypeScript compiler. The core monetization and transactional framework of Eventcast Pro is officially alive and ready for launch!

---

## 🏛️ Session 10: Infrastructure Optimization (VOD Archiving & Cloudflare HLS Caching)
**Date: May 17, 2026**

### 🔍 Context
Optimized live stream caching and VOD storage reliability to prevent buffering and maximize performance on high-concurrency event days.

### 🗣️ Our Discussion
We discussed reducing latency while maintaining a high quality playback experience. We decided to leverage Cloudflare's edge network for HLS segments and establish direct VOD archiving routines from the Restreamer HLS stream to prevent cloud storage egress fees.

### 🛠️ What we did & Why
1. **Cloudflare Caching**: Added fine-tuned cache-control headers for `.ts` media segments.
   - *Why?* To serve stream segments directly from the edge, lowering CPU load on our streaming server.
2. **VOD Automation**: Built background sync workers to convert active streams into persistent MP4 archives post-event.
   - *Why?* To ensure seamless replay ability without keeping high-performance servers running indefinitely.

---

## 🏛️ Session 3: Admin Dashboard Hardening & Operational Tools
**Date: May 4 - May 11, 2026**

### 🔍 Context
The goal was to make the admin dashboard fully mobile-responsive and secure the underlying data structure before scaling.

### 🗣️ Our Discussion
We discussed the best way to utilize Google Cloud credits for future AI features while maintaining a secure Supabase backend. We also planned for a photographer management system to handle credits and branding automatically.

### 🛠️ What we did & Why
1. **Mobile Responsiveness**: Transformed the admin panel into a fully responsive interface.
   - *Why?* To allow event management on-the-go via smartphones.
2. **Security Hardening**: Implemented `robots.txt` for admin exclusion and Supabase Row-Level Security (RLS).
   - *Why?* To prevent sensitive admin data from appearing in Google searches.
3. **Internal Tools**: Added collapsible sidebars, peak hour charts, and internal event notes.

---

## 🏛️ Session 4: Template Automation & Initial Launch
**Date: April 23 - May 2, 2026**
## 🏛️ Session 1: The "Live-to-VOD" Challenge & YouTube Relay
**Date: May 13-14, 2026**

### 🔍 The Problem
User was facing issues where the private live stream would stop working if they edited and saved an event. Also, there was no way to stop the YouTube stream without stopping the whole server. Most importantly, once a live ended, the private server only played the last few seconds, making it useless for "replaying" the wedding for late-comers.

### 🗣️ Our Discussion
We realized that our HLS settings were too aggressive (deleting old segments to save space). This was fine for "real-time" but bad for "memories". 
We also discussed the "Edit & Save" bug—it turns out the YouTube stream keys were being lost during the form submission because the state management wasn't preserving them.

### 🛠️ What we did & Why
1. **The Fix**: We updated the `restreamer.ts` configuration. 
   - *Why?* By removing `delete_segments` and setting `hls_list_size` to `0`, we told the server: "Keep every single second of this wedding on the disk."
2. **The Relay Toggle**: We created a new API and a UI toggle in the Admin Dashboard.
   - *Why?* This gives the user "Surgical Control". You can start the private stream early, but only hit the "YouTube Relay" button when the actual ceremony starts.
3. **The Buffer Fix**: We noticed the stream was "pausing and playing" every 5 seconds.
   - *Why?* We found the bitrate was high (10Mbps at one point) and the player buffer was too small. We increased the Hls.js buffer to 60 seconds of "safety net" data.

### 💡 Results & Learnings
The platform is now much more robust. The "Wait for Stream" loader in the template now polls the server until it's actually live, ensuring a smooth experience for guests.
*Learning*: High bitrates are the enemy of stability. Always aim for 4000-5000 kbps for the best balance.

---

## 🎨 Session 2: Aesthetic Refinements & User Experience
**Date: May 15, 2026**

### 🔍 The Problem
The video player on the landing page had an ugly black gap at the bottom, making it look unpolished. The user also wanted a better way to track our work.

### 🗣️ Our Discussion
We looked at the screenshot and realized the CSS "Intrinsic Ratio" (16:9) was working, but the injected Plyr container wasn't "filling" its parent correctly because it lacked absolute positioning. We also talked about creating this very diary—a way to keep our "brainstorming" alive in text.

### 🛠️ What we did & Why
1. **UI Fix**: Updated `script.js` to inject the player with `position: absolute; top: 0; left: 0;`.
   - *Why?* This forces the player to fill every pixel of the white container, removing the gap.
2. **Master Diary**: Created this narrative-style log.
   - *Why?* To move away from simple "Task Lists" and towards a "Shared Knowledge Base".

---

## 🚀 The Roadmap Ahead
- **AI Thumbnail Engine**: We want to use Vertex AI to look at the groom/bride names and event type to generate a stunning, artistic thumbnail automatically.
- **System Sentinel**: An AI-driven health check that will alert us if the server CPU is too high or if a stream is lagging.
- **Multi-Camera Logic**: Designing a way for users to switch between a "Main Stage" and "Entrance" camera within the same player.

---

## 🏗️ Wedding Template-01: Technical Architecture & Rules
**Date: May 15, 2026**

### 🔍 Context
We standardized the logic for `wedding-template-01` to ensure it's not just a design, but a robust streaming application.

### 🛠️ Core Rules & Logic Implemented
1. **Anytime-Start Logic**: 
   - *Rule*: The player polls the server every 2s. If an RTMP signal is detected from OBS (even before the scheduled time), the player initializes immediately.
   - *Rationale*: To handle early starts or pre-wedding rituals without user intervention.
2. **Auto-VOD Fallback**:
   - *Rule*: If the HLS stream returns a 404 or ends, the player switches to the embedded YouTube VOD after a 5s delay.
   - *Rationale*: Guaranteed content delivery; the user never sees a "dead" player.
3. **Stability over Latency**:
   - *Rule*: High buffer settings (60s max) in Hls.js to handle mobile network jitter.
   - *Rationale*: Prevents the frequent pause/play cycles that irritate wedding viewers.

---

## 🧠 Template Intelligence & Resource Management
**Date: May 15, 2026**

### 🔍 Context
We implemented "Smart Rules" to ensure the templates are efficient, resource-friendly, and maintain a polished look regardless of the data provided.

### 🛠️ Core Intelligence Rules
1. **Dynamic Visibility Logic**: 
   - *Rule*: Sections like 'Invitation Video' or 'Photo Gallery' must automatically hide if no data is provided. They re-appear instantly once data is added in the admin panel.
   - *Rationale*: Prevents broken or empty layouts, ensuring a premium feel at all times.
2. **Smart Focus Playback**:
   - *Rule*: Videos and slideshows only play when in the user's viewport. If a user scrolls away, these elements must auto-pause.
   - *Rationale*: Massive bandwidth savings and better performance on mobile devices.
3. **Cloudinary Credit Sentinel**:
   - *Rule*: Actively monitor Cloudinary usage and provide early warnings before credits are exhausted.
   - *Rationale*: To prevent sudden image loading failures during high-traffic live events.

---
*This diary is a living document. We add to it as we build, ensuring no detail is ever lost.*

