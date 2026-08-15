# EventCast.pro Admin Panel - Current State and Final Gap Map

**Version:** 2.1  
**Evidence date:** Repository revalidated 7 August 2026; live `public.events` schema checked 8 August 2026  
**Purpose:** Current implementation evidence and final classification; not implementation authorization

## 1. Repository baseline

The read-only Claude Opus revalidation found branch `main` at HEAD `8e7537e1b660459dc3260924a1fbca904dd8b66a`, with local `origin/main...HEAD` divergence `0 0` without fetching. Five tracked files were modified and 162 paths were untracked. No material architecture change had occurred since the prior audit.

The five tracked modifications included the template JavaScript and CSS, the Worker template HTML, `tsconfig.json`, and `wrangler.toml`. The uncommitted `MEDIA_R2` binding was material because committed Worker code depends on it. The report did not verify deployed Cloudflare configuration.

## 2. Exact stopping point

The SRS and Media Agent server-side control plane reached assignment activation, deactivation, status, node selection, capacity, private-R2 HLS, and synthetic validation. Work stopped at an operator-only boundary. No provider-facing SRS activation or Live Control Room exists.

The provider panel remains on the legacy Restreamer stack. Every current provider-facing stream status, bitrate, FPS, preview, ingest, key, restart, and YouTube-relay surface depends on Restreamer.

The unfinished `eventContract.ts` and its test exist but are untracked and unwired. Create Event still has three competing payload builders.

## 3. Current provider architecture

The provider application is one large `src/app/page.tsx` Client Component using local tab state. It has no route-based Event Workspace and no `/events/[id]` hierarchy. The accepted Provider Console and Event Workspace therefore require structural work rather than styling changes.

Authentication and tenant ownership are meaningful foundations. Supabase Auth, server token verification, studio membership resolution, ownership helpers, RLS policies, and archive-before-delete behaviour should be retained. Page routes require stronger server-side protection.

## 4. Current template architecture

Templates are not metadata-driven packages. Multiple diverged copies exist in the root, Worker bundle, public R2 development bucket, and EventCast static paths. Admin preview fetches GitHub Raw and uses a different renderer from production. Silent fallback maps missing event types and invalid template IDs to the Wedding template. Some named customer-event pages are presented as reusable templates.

TLF-001 design work is reusable. The current duplication, preview path, fallback logic, GrapesJS path, and manual asset synchronization are not.

## 5. Current livestream architecture

The public Worker can resolve an enabled Media Agent assignment and serve private R2 HLS through the EventCast hostname. The provider application does not use that control plane.

Legacy Restreamer is invoked during event create and edit. The provider browser fetches an unsigned legacy HLS host directly. Stream credentials are exposed in plaintext, and the current stream key is the shared literal `live`. These paths conflict with the approved architecture and are migration debt.

## 6. Current event model

The live `public.events` table contains 53 columns. `groom_name`, `bride_name`, `event_type`, `event_date`, `event_time`, `template_id`, `studio_id`, `guest_photo_limit`, and `event_visibility` are non-null. `event_visibility` defaults to `public`. The allowed visibility values are `public`, `private`, and `synthetic`. The allowed deployment statuses are `deploying`, `live`, and `failed`.

The table has no `template_version`, no canonical `scheduled_start_at`, no clean Draft/page-state separation, and no separated stream or recording status. It carries legacy Restreamer columns, duplicate privacy concepts, and three competing time fields.

The schema already has the correct tenant-scoped uniqueness foundation: `UNIQUE (studio_id, slug)`. RLS is enabled. Owners and admins can insert, update, and delete their studio events, studio members can select their studio events, and public or authenticated visitors can select non-archived rows whose `event_visibility` is `public`. No non-system triggers are attached.

The public-select policy does not check a Published page state because such a state does not exist. A new Draft must therefore never be inserted as a publicly visible row.

No business-subdomain root landing page or EventCast Direct internal operations model is implemented in the current repository. Both are accepted later V1 capabilities and are outside the first Draft Event slice.

## 7. Final classification

### Keep

Keep Supabase authentication and tenant ownership, security helpers, RLS foundation, public Worker rendering, Worker-mediated private R2 HLS, protected R2 uploads, the SRS and Media Agent control plane, page-view collection, archive and restore controls, Guest Memories auto-approval default, and Event Credit versus Usage Credit separation.

### Repair

Repair page-route protection, Guest Memories naming and optional manual approval, Guest Memories moderation, Wishes moderation, Partners and Client profiles, ID-based partner selection, Event Credit snapshots, Public and Unlisted visibility, and page QR.

### Selective Rebuild

Selectively rebuild Provider navigation and dashboard, Create Event, template package and renderer boundary, YouTube destination workflows, and provider technical stream metrics. Reuse safe code and tested backend foundations; do not preserve incompatible UI architecture merely because it exists.

### New Build

Build the Event Workspace, lifecycle and separated status dimensions, phone-first identity and OTP delivery, SRS Live Control Room, true global Media Library, heartbeat-based audience analytics, Support and Notifications, Super Admin Operations Console, B2 VOD lifecycle, retention controls, audit-log foundation, a simple business-subdomain root landing page, and private EventCast Direct operations data.

### Retire

Retire GrapesJS and its supporting routes, Restreamer after replacement, direct browser infrastructure access, plaintext shared credentials, fake Unique Reach, GitHub Raw preview, duplicate template copies, dead Create Event payload path, the public legacy portal, normal-user storage display, and confirmed dead stubs.

### Defer

Defer exact commercial pricing and billing, full Live Chat enhancements, advanced QoE, customer-owned custom-domain automation, domain resale, QR Selfie Photo Discovery, photography business suite, LED Display Mode, and AR.

## 8. Highest-impact verified gaps

The highest-impact gaps are the absence of route-based Event Workspace, total provider dependence on Restreamer, lack of provider entry to SRS and Media Agent, silent template fallback, preview and production renderer divergence, absence of Draft and lifecycle, unwired canonical event contract, plaintext shared stream credentials, fake unique analytics, and absent B2 retention and YouTube fallback.

## 9. Remaining uncertainty

The audits did not verify deployed Worker bindings or routes, live Linode state, applied migration history outside the queried table, current YouTube credentials and quota, live SRS assignments, R2 object versions, B2 configuration, or current test pass status. These facts require targeted read-only checks only when a bounded task depends on them.

## 10. Planning consequence

No further broad repository audit is required before the first implementation slice. Version 2.1 and the schema preflight provide enough evidence. Each later slice may perform one narrow preflight for the exact mutable dependency it touches.
