# EventCast.pro Admin Panel - Final Product, Architecture, and V1 Scope Baseline

**Version:** 2.1  
**Prepared:** 8 August 2026  
**Status:** Corrected and verified final baseline before the first bounded implementation slice  
**Canonical language:** English  
**Implementation authority:** Product and architecture authority only; no code or production action is authorized by this document.

## 1. Executive decision

EventCast.pro remains a livestream-first provider platform. The immediate paying users are livestream providers and photographers, with event managers and LED-screen owners using the same event-page and livestream product. Guests are audience users. Photography business tools, AI photo discovery, full white-label automation, LED scene orchestration, and AR experiences remain connected future services and must not delay the livestream-first V1.

The current repository is transitional rather than empty. Secure Supabase ownership foundations, a working public-event renderer, protected R2 upload flows, and the SRS plus custom Media Agent control plane should be retained. The provider admin panel, however, still operates through a monolithic tab-switching page and legacy Restreamer surfaces. The target is therefore not a full rewrite and not a patch-everything strategy. The approved strategy is a hybrid selective rebuild inside the existing application.

The first implementation slice is the Route-Based Draft Event Foundation. It creates a reliable event identity, canonical draft data path, route-based Create Event entry, and minimal event workspace before public publishing, SRS activation, YouTube, media, analytics, billing, or Super Admin work is added.

## 2. Final framework and deployment architecture

The EventCast provider and platform admin interfaces will remain inside the existing `eventcast-admin` Next.js App Router and TypeScript application. The previously considered separate React Router Framework Mode Admin V2 is superseded. The current problem is not the Next.js framework; it is that the app uses one large Client Component and local tab state instead of route-based architecture.

The target admin application is a route-based modular monolith. Provider Console, Event Workspace, and Platform Operations Console share one deployable Next.js application while using separate layouts, route groups, server-side authorization, and bounded modules. Pages and layouts should default to Server Components. Client Components are used only where browser interactivity is required, such as live metrics, forms, media ordering, stream-key reveal, and realtime moderation.

The public event page remains a separate Cloudflare Worker surface. It handles high-volume public rendering, Worker-mediated private R2 HLS delivery, public SEO responses, and guest traffic. The admin application and public Worker share a canonical event contract and canonical template releases; they do not maintain independent interpretations of the same event.

The repository should not be reorganized into a large monorepo merely to begin the rebuild. Small shared boundaries may be introduced where the event contract and template packages require them. Broader repository reorganization, framework upgrades, and deployment-adapter changes remain separate tasks unless a demonstrated blocker requires them.

## 3. Final public URL, subdomain, and custom-domain model

Every event has one immutable internal `event_id`. URLs, slugs, business branding, SRS assignments, analytics, recordings, and object-storage paths must not be treated as the same identity.

The recommended branded URL is `business.eventcast.pro/event-slug`. The business subdomain is globally unique. The event slug is unique only inside the owning studio or tenant. The live database already enforces `UNIQUE (studio_id, slug)`, which supports this model.

The business-subdomain root `business.eventcast.pro/` must always resolve safely. In V1 it may show a simple branded landing page or controlled placeholder containing the business name, logo, contact links, and selected public events. This root experience is separate from event templates and does not require a full website builder.

A neutral EventCast URL is also supported for events where the provider or client does not want the business brand highlighted. Its accepted form is `eventcast.pro/e/event-slug`, with a stable suffix or alias mechanism when global neutral-link collisions require it.

A single event may have more than one valid public alias, but one Primary Public URL is selected for canonical SEO. Changing the slug, link style, or primary hostname must not break the event, stream, analytics, recording, or previously shared links. Old links should redirect or resolve through aliases.

EventCast direct-service orders are operated through a separate normal provider tenant such as EventCast Direct, not through the Super Admin role. These events may default to the neutral EventCast URL. Equipment plans, operator assignment, venue contacts, and operational notes remain private provider data. They belong to an internal event-operations record or workspace and must never be copied into the Public Event Config, public Event Credits, SEO metadata, or guest-facing page.

Customer-owned domains are an accepted future service. A customer with an existing website should normally use an exact hostname such as `events.customer-domain.com/event-slug`. A customer whose entire domain is hosted by EventCast may use `customer-domain.com/event-slug`. The premium pattern `event-slug.customer-domain.com` remains later because it creates per-event hostname and wildcard-management complexity.

The EventCast-owned wildcard `*.eventcast.pro` is a foundation decision. Existing exact hosts such as `live.eventcast.pro` and `media.eventcast.pro` remain reserved and must be excluded from the event-page wildcard Worker route. Customer-owned wildcard domains remain a separate future capability. Domain reselling and managed domain registration are future commercial services; Bring Your Own Domain is the initial custom-domain approach.

## 4. Final product surfaces

The Provider Console is the account-level operational surface. Its accepted top-level areas are Dashboard, Create Event, Events, Live Streams, Media, Engagement, Analytics, Partners and Clients, Subscription and Usage, Support, and Settings. Subscription and Usage may remain hidden or unavailable until billing is rebuilt, but the product boundary remains reserved.

The Event Workspace is the complete control surface for one event. Its accepted tabs are Overview, Event Page, Live, Media, Engagement, Analytics, and Settings. Event context persists through real URLs and layouts rather than local tab state.

The Public Event Page contains the event identity, countdown, optional Invitation Video, Private or YouTube Livestream, optional Photo Slideshow, Wishes, Guest Memories, Maps, and Event Credits.

The future Live Chat Room is a separate guest page containing the stream and guest chat. It is not a comments block embedded into the main event page.

The EventCast Operations Console is the Super Admin surface for platform health, accounts, all events, active streams, SRS and Media Nodes, templates, media operations, support, messaging, entitlements, retention, security, and audited actions. A separate normal test-studio account is used to validate the customer experience.

## 5. Create Event and draft workflow

Create Event is available as a prominent dashboard action and as a dedicated route. Both open the same workflow.

The user selects Event Type before Template. Only explicitly compatible, active templates are offered. Invalid or unavailable template IDs must fail clearly; silent fallback to another template is prohibited.

The first bounded release supports the verified Wedding path and TLF-001 template. The architecture supports future event types, but unfinished customer-specific templates must not be presented as reusable product templates.

Core event fields include event title or participant names, event type, scheduled start, venue, selected template and exact template version, editable tenant-scoped slug, link style, page visibility, internal client reference, and public Event Credits. Asia/Kolkata is the fixed V1 timezone. Venue remains free text with optional map assistance.

The event is saved as Draft before production publishing or livestream activation. Draft creation must not create a Restreamer channel, activate an SRS assignment, create a YouTube broadcast, upload production media, publish a public page, or debit a wallet.

Page publication and livestream start are separate actions. Private Livestream activation occurs only after ownership, event state, entitlement, capacity, and schedule checks. The user can edit the schedule, SEO, media, credits, optional modules, slug, link style, and YouTube destination after creation, with stricter controls during testing or live operation.

Invitation Video, Photo Slideshow, Wishes, Guest Memories, Maps, Private Livestream, and YouTube are explicit optional modules. The absence of optional media must not block a Draft.

## 6. Canonical event contract

One official event contract replaces the three competing payload builders currently present in the repository. The existing untracked `eventContract.ts` must be reviewed and revised; it must not be blindly adopted and a parallel fourth contract must not be created.

The Event Draft Input represents provider-entered form data. The Canonical Event Record is the validated internal model stored and used by the Provider Console, Event Workspace, publishing system, SRS integration, YouTube integration, analytics, and retention systems. The Public Event Config exposes only safe public fields to the renderer. Internal EventCast Direct operations data, including assigned operator, equipment checklist, venue contact, travel notes, and handoff state, remains outside the public config.

The event has one immutable UUID. The public slug is editable and is not used as the SRS assignment identity, playback identity, analytics identity, or storage object key. Streaming and recording paths use stable internal identifiers such as event UUID and opaque playback ID.

The accepted authoritative schedule is one `scheduled_start_at` value interpreted in Asia/Kolkata and stored as a complete timestamp. The countdown, dashboard, readiness, and OAuth-managed YouTube schedule derive from it. Legacy `event_date`, `event_time`, and `timer_target_time` may be mirrored temporarily for compatibility but must not remain competing authorities.

The canonical record stores `template_id` and `template_version`. It stores explicit module settings, SEO fields, link style, visibility, partner references, published Event Credit snapshots, lifecycle states, and public-page state. Stream secrets, OAuth tokens, provisioning secrets, and raw credentials never belong in public event data.

Event lifecycle, page status, private stream status, YouTube status, recording status, and media status remain separate dimensions. Date math cannot independently declare an event Live or Completed.

## 7. Canonical template package and renderer

Each reusable template has one canonical release package. The package contains stable template identity, display name, semantic version, supported event types, supported modules, required and optional field declarations, activation state, preview image, renderer assets, and a validation result.

TLF-001 is preserved and migrated into the canonical package model. It is not discarded merely because the current copies are duplicated. A legacy adapter may map the canonical event config into the existing HTML, CSS, JavaScript, and `window.WEDDING_CONFIG` shape while the product moves to one controlled package and renderer.

Admin Preview and public production rendering use the same template release and render model. Runtime preview must not fetch a separate GitHub Raw template, and template assets must not be maintained in four manually synchronized locations.

Published events pin an exact template version. Later releases do not silently alter old events. Template assets use immutable versioned paths. Invalid or incompatible templates fail rather than falling back.

GrapesJS is retired and must be removed through a controlled cleanup that includes its page route, local-sync APIs, public middleware exceptions, dependencies, and unused imports. It must not be manually deleted as one folder before dependencies are identified.

The separate custom editor at `D:\EventCast-Layer-Studio` is preserved. It is not an urgent V1 dependency. In a later phase it may export validated canonical template packages. It must not be confused with GrapesJS or removed during GrapesJS cleanup.

## 8. Event lifecycle and visibility

The user-facing lifecycle is Draft, Upcoming, Ready for Test, Testing, Live, Interrupted or Reconnecting, Ended, Replay Processing, Completed, and Archived. These are derived from the separated status dimensions rather than one overloaded status field.

The page has a distinct Draft or Published state. V1 public visibility choices are Public and Unlisted. True Private access is deferred until PIN, invite, or authenticated guest access is implemented. An unlisted event remains link-accessible but is not treated as a public indexed event.

Archive is non-destructive. Permanent deletion is protected, separately authorized, and does not replace archive. Old public URLs and aliases are handled deliberately.

The existing unauthenticated `/portal/[slug]` is not part of the accepted surface model. It is retired. A future Client Portal must be built as a secure share-link or authenticated product rather than extending the current public portal.

## 9. Livestream architecture and Live Control Room

SRS plus the custom Media Agent is the only approved livestream architecture. The existing server-side assignment, node selection, activation, deactivation, status, capacity, private R2 HLS, and Media Agent foundations are retained.

Restreamer is retired from the target. Its current provider UI, API routes, direct browser HLS access, hardcoded ingest address, shared `live` stream key, health cron, and related security helpers are migration debt. They are removed only after the replacement path is ready, except for independently safe dead-code cleanup.

Draft creation does not activate a stream. The user explicitly enables EventCast Private Livestream. The backend validates ownership, state, entitlement, capacity, schedule, and existing assignment before activation.

The Event Workspace Live tab is the provider Live Control Room. It provides masked Stream URL and Stream Key, authorized reveal, copy, and rotation, Test Stream, source status, resolution, FPS, bitrate, codecs, duration, reconnects, simple health, current and peak viewers when available, YouTube state, recording state, preview, public-live control, and end-stream control.

Browsers never call SRS or Media Agent directly. Infrastructure restart, node restart, arbitrary disconnect, and raw SRS actions belong to protected Super Admin operations. Time estimates and commercial included-hour limits must never hard-stop a real wedding or event.

## 10. YouTube model

YouTube remains optional and independent from the private EventCast stream. The provider may use a provider OAuth-connected channel, a client OAuth-connected channel, or a manually scheduled client broadcast.

A watch link supports embedding but does not provide relay credentials. Relay requires OAuth or protected ingest details. The EventCast page and private stream remain stable when the YouTube destination changes or fails.

EventCast SEO title, description, and thumbnail are defaults for OAuth-managed YouTube events. Tags are generated automatically and may be overridden. Schedule, privacy, and approved metadata changes synchronize when EventCast has authorization. Failures are surfaced with retry rather than silently logged.

Before a live destination is replaced, the new destination is prepared and verified. Old YouTube broadcasts are never silently deleted. A verified YouTube archive or later upload may become the long-term replay fallback only after processing, channel, duration, privacy, playability, and embed checks pass.

## 11. Media, Guest Memories, Wishes, and Live Chat

The provider receives a global Media Library and an event-scoped Media tab. V1 media categories include SEO thumbnails, Invitation Videos, Photo Slideshow images, Guest Memories, recordings, and replay assets. Storage consumption is not shown to normal providers in V1.

Guest Memories is the final product name. It contains guest-uploaded photos, selfies, captions, and memories. It is not QR Selfie Photo Discovery. Auto Approval is the default after file and abuse validation. An event may enable Manual Approval. Providers can later hide, reject, or delete a Guest Memory.

Wishes are persistent text greetings and remain separate from Guest Memories and Live Chat. The accepted moderation model supports review, approve, pin, hide, reject, and delete.

Live Chat is V1 After Core. The first version uses Supabase Realtime and supports display names, text, emojis, replies, presence, reporting, deletion, mute, ban, slow mode, and event-level enablement. GIFs, animated stickers, polls, reactions, and games are later. Cloudflare Durable Objects are considered only after real scale or control needs prove that Supabase Realtime is insufficient.

QR Selfie Photo Discovery remains a separate future paid service. It searches official photographer uploads using a guest selfie and must not be mixed with Guest Memories.

## 12. Analytics

No heuristic or fabricated metric may be presented as real. The current `totalViews * 0.65` Unique Reach value is retired.

V1 event-page analytics include page views, true privacy-safe unique visitors, referral source, device type, approximate geography, Wishes count, Guest Memories count, and page QR scans when implemented.

Livestream analytics include Current Viewers, Peak Concurrent Viewers, Total Unique Viewers, Total Watch Time, and Average Watch Time. Audience counts use player sessions and heartbeat state. SRS origin connections and Restreamer process counts are not authoritative CDN audience counts.

Technical stream metrics include resolution, FPS, video and audio bitrate, codecs, duration, reconnect count, source state, and relay state. EventCast and YouTube analytics remain source-separated. Advanced startup, buffering, playback-failure, and QoE reporting follow after core metrics.

## 13. Partners, Clients, and Event Credits

The account-level Partners and Clients directory supports photographers, studios, event managers, direct clients, venues, and other relationships. Profiles can hold logo, business name, contact person, phone, WhatsApp, city, Instagram, Facebook, YouTube, website, and private notes.

Internal client information and public Event Credits are separate. Create Event supports ID-based search, selection, and inline creation. One primary credit and additional approved credits may be attached with role labels.

Published events preserve a snapshot of public credit details so that later partner-profile edits do not rewrite historical event pages. Event Credits and financial Usage Credits are separate concepts.

## 14. Authentication, support, and notifications

Public V1 account activation requires a verified mobile number. Supabase Auth remains the authentication and OTP authority. WhatsApp authentication messages are the preferred primary channel, with a DLT-compliant India SMS provider as fallback. Email remains a secondary recovery and communication channel.

Normal login may use phone and password, with optional OTP login. Sensitive actions use step-up OTP. One verified phone identity receives one trial. Device and IP signals are secondary abuse signals. Rate limits, cooldowns, attempt limits, CAPTCHA, provider fallback, clear failure states, and no-secret logs are mandatory.

V1 includes a Support area, event-linked tickets, Help content, and Urgent Live Support with safe non-secret context. The in-app Notification Center is the authoritative history. Email and operational WhatsApp alerts may deliver reminders, disconnect, restoration, relay failure, and support replies. Alert deduplication prevents message floods. Full WhatsApp CRM remains future.

## 15. Super Admin Operations Console

The platform owner uses a separate Super Admin role and stronger authentication. The console includes Platform Overview, Users and Studios, All Events, Active Streams, SRS and Media Nodes, Templates, Media Operations, Engagement Moderation, Platform Analytics, Plans and Entitlements, Support, Notification Delivery, Security, Audit Logs, Retention Policies, and System Settings.

Normal support is metadata-first. Private content is not routinely browsed. Content access requires a reason, time-limited support or moderation access, and audit evidence.

Super Admin actions are risk-tiered. High-risk actions require confirmation, reason, actor, target, before-state, after-state, and timestamp. Secrets, passwords, OTP values, refresh tokens, and raw provisioning credentials are never shown as ordinary platform data.

The Super Admin controls global VOD retention default, per-user override, event-level frozen retention, and audited manual extension. Storage usage is visible here, not in the normal provider V1.

## 16. Recording, VOD, and page retention

R2 is the live HLS, DVR, and short post-live safety layer. After recording finalization and verification, B2 is the authoritative VOD store.

The accepted default EventCast-hosted replay retention is 90 days. The event page remains active independently for at least 12 months. A verified YouTube replay automatically replaces the EventCast-hosted replay after expiry when available. When no verified YouTube fallback exists, the provider receives advance expiry notice and future options to download or extend.

The retention policy supports a global default, per-user override, event-level frozen effective value, and audited event-level extension. Changing the global default applies to new events by default and must not silently shorten previously promised events.

A second cold archive provider is not introduced for the initial 90-day window. Page expiry, VOD expiry, R2 cleanup, B2 retention, and YouTube fallback are separate lifecycle concerns.

## 17. Commercial plans and billing

Exact pricing, plan names, pack prices, included stream hours, concurrency quantities, and add-on prices are not final Version 2.1 decisions. Earlier Trial, Single Event Pack, Professional Plan, eight-hour pack, and add-on examples are retained only as planning examples and are not implementation authority.

Billing remains deferred. Wallet top-up stays disabled. The live legacy ₹499 automatic Create Event debit must be retired from the new flow rather than reactivating the wallet. Draft and Preview do not charge money.

During closed beta, production publishing and private-stream access may use a temporary Super-Admin-approved Beta Entitlement for selected normal test-studio accounts. It is not a pricing plan and does not imply payment. The real commercial and atomic-ledger billing system is a separate later project.

## 18. Legacy transition and cleanup policy

GrapesJS is removed through a bounded cleanup. The separate EventCast Layer Studio is preserved.

Restreamer is removed after the SRS provider replacement is validated. Direct browser access and plaintext shared credentials are not retained as fallback architecture.

The GitHub Raw preview renderer, duplicate preview HTML, manual multi-location template copies, dead legacy Create Event form, fake analytics metric, disabled asset stub, unused YouTube status route, normal-user storage display, and unauthenticated legacy portal are retired when their dependencies are understood.

Approximately forty customer-event directories and the large `scratch/` operational-script set are not mass-deleted during the first implementation work. They are preserved until a separate inventory determines what is historical evidence, reusable operational tooling, archival material, or confirmed disposable content.

## 19. Current-state classification

Keep the Supabase authentication and tenant-ownership foundation, public Worker renderer, private R2 HLS delivery, protected R2 upload path, SRS and Media Agent control plane, page-view collection, archive and restore controls, Guest Memories auto-approval default, and Event Credit versus Usage Credit separation.

Repair page-route protection, Guest Memories manual approval and moderation, Wishes moderation, Partners and Credits, Public and Unlisted visibility, page QR, and selected public-page gaps.

Selectively rebuild Provider navigation, Dashboard, Create Event, YouTube integration, and technical stream metrics while reusing safe foundations.

Build the Event Workspace as a new capability, phone-first identity, lifecycle status model, canonical template package, Live Control Room, global Media Library, true audience analytics, Support and Notifications, Super Admin Operations Console, B2 retention lifecycle, and audit foundation.

Retire Restreamer, GrapesJS, direct browser infrastructure access, the shared plaintext stream key, fake Unique Reach, duplicate template renderers and copies, the public legacy portal, and obsolete stubs.

Defer commercial billing, Live Chat beyond core, advanced QoE, custom customer domains and managed domain resale, QR Selfie Photo Discovery, photography business suite, LED Display Mode, and AR features.

## 20. First implementation slice

The first implementation slice is Route-Based Draft Event Foundation. It is defined separately in the first-slice document.

The slice creates a real `/events/new` route, a minimal `/events/[eventId]/overview` route, a revised canonical event contract, tenant-scoped and server-validated Draft persistence, Wedding and TLF-001 compatibility without fallback, editable slug, Asia/Kolkata authoritative schedule, and reopen/edit capability.

The slice does not include public publishing, template preview, SRS activation, Restreamer removal, YouTube, media upload, analytics, billing, OTP, Support, Super Admin, VOD, or broad cleanup.

## 21. Evidence and uncertainty boundary

The final Claude Opus report verified the repository snapshot at branch `main`, HEAD `8e7537e`, local divergence `0 0` without fetch, five tracked modifications, and 162 untracked paths. It did not run tests, builds, remote queries, or production checks.

The live Supabase preflight verified the `public.events` columns, constraints, indexes, RLS policies, RLS enabled state, and absence of non-system triggers. It did not verify other tables, deployed migration history, Worker bindings, Linode state, YouTube credentials, B2 configuration, or production traffic.

Before a later task depends on a remote or mutable fact, that task may perform one targeted read-only preflight. This does not justify repeating a broad architecture audit.

## 22. Operating rule

Version 2.1 is the product and architecture authority. The Current-State file records changing implementation evidence. One Active Task file defines one bounded goal. Claude, ChatGPT, Codex, and developers must not merge these roles into repeated large handoff prompts or broad implementation scopes.
