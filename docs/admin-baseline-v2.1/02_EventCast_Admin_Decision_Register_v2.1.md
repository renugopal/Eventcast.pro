# EventCast.pro Admin Panel - Decision Register

**Version:** 2.1  
**Prepared:** 8 August 2026  
**Status:** Corrected and verified final decision register after architecture revalidation and live schema preflight

## How to use this register

Each entry records one decision, its current status, and its intended meaning. Accepted decisions form the Version 2.1 product baseline. Superseded decisions are historical only. V1 After Core decisions are approved but follow the core release. Future and Deferred entries are intentionally outside the immediate implementation boundary. Commercial examples are not implementation authority unless explicitly marked Accepted in Version 2.1.

## PRD-001 - Livestream-first product focus

**Status:** Accepted.  
**Decision:** EventCast.pro V1 is a livestream-first provider platform. Photography, LED, and event-manager users are included primarily through the shared livestream and event-page workflow.

## PRD-002 - Primary customer order

**Status:** Accepted.  
**Decision:** Livestream providers and photographers are the main paying users. Event managers and LED-screen owners are valid users of the same service. Guests are audience users, not the primary V1 customer.

## PRD-003 - English-first launch

**Status:** Accepted.  
**Decision:** English is the initial product language. Multilingual templates and interfaces are deferred until market demand proves the need.

## PRD-004 - Recurring events

**Status:** Deferred.  
**Decision:** Recurring events are not needed for the wedding and private-event V1. Each confirmed event is created and scheduled individually.

## SUR-001 - Separate product surfaces

**Status:** Accepted.  
**Decision:** Provider Console, Event Workspace, Public Event Page, Live Chat Room, and Super Admin Operations Console remain separate surfaces with separate responsibilities.

## AUTH-001 - Mandatory mobile verification

**Status:** Accepted.  
**Decision:** A verified mobile number is required before account activation, trial access, or production usage.

## AUTH-002 - WhatsApp OTP primary

**Status:** Accepted.  
**Decision:** Meta WhatsApp authentication messages are the preferred OTP channel.

## AUTH-003 - SMS OTP fallback

**Status:** Accepted.  
**Decision:** A DLT-compliant India SMS provider is the fallback when WhatsApp delivery is unavailable or unsuccessful.

## AUTH-004 - Email as secondary identity channel

**Status:** Accepted.  
**Decision:** Email is retained for recovery, invoices, support, exports, and long-form communication, but it is not the primary anti-abuse identity anchor.

## AUTH-005 - Normal login method

**Status:** Accepted.  
**Decision:** Normal login may use phone plus password. Passwordless OTP login is optional. Every login does not require a paid OTP.

## AUTH-006 - Step-up OTP

**Status:** Accepted.  
**Decision:** Sensitive actions require recent OTP verification, including key rotation, critical account changes, YouTube authorization removal, and future financial actions.

## AUTH-007 - Trial-abuse control

**Status:** Accepted.  
**Decision:** One verified phone identity receives one trial. Device and IP data are secondary risk signals, not absolute identity rules.

## AUTH-008 - Authentication authority

**Status:** Accepted.  
**Decision:** Supabase Auth remains the OTP and session authority. EventCast routes delivery and entitlement policy without creating a separate OTP-verification system.

## AUTH-009 - OTP safety controls

**Status:** Accepted.  
**Decision:** Rate limits, cooldowns, attempt limits, CAPTCHA, provider fallback, failure messaging, and no-secret logging are mandatory.

## DASH-001 - Operational dashboard

**Status:** Accepted.  
**Decision:** The provider dashboard prioritizes Create Event, active streams, upcoming events, drafts, completed events, and pending actions rather than decorative charts.

## DASH-002 - Provider navigation

**Status:** Accepted.  
**Decision:** Dashboard, Create Event, Events, Live Streams, Media, Engagement, Analytics, Partners and Clients, Subscription and Usage, Support, and Settings are the accepted top-level areas.

## DASH-003 - Storage visibility

**Status:** Accepted.  
**Decision:** Normal users do not see storage consumption in V1. Storage is monitored by Super Admin only.

## CRT-001 - Dedicated Create Event entry

**Status:** Accepted.  
**Decision:** Create Event appears as both a prominent dashboard action and a separate navigation item, using one shared workflow.

## CRT-002 - Event type before template

**Status:** Accepted.  
**Decision:** The user selects an event type first. Only explicitly compatible templates are shown.

## CRT-003 - No silent template fallback

**Status:** Accepted.  
**Decision:** Unavailable or invalid template mappings must show an error. The system must not silently substitute another template.

## CRT-004 - Canonical event data

**Status:** Accepted.  
**Decision:** Core event information belongs to a shared event model rather than a template-specific form or hardcoded markup.

## CRT-005 - Free-text venue

**Status:** Accepted.  
**Decision:** Venue name and address can be entered manually. Map search is an optional helper.

## CRT-006 - Asia/Kolkata timezone

**Status:** Accepted.  
**Decision:** Asia/Kolkata is the fixed V1 timezone. No timezone selector is shown.

## CRT-007 - Single authoritative start time

**Status:** Accepted.  
**Decision:** The scheduled start time drives the countdown, dashboard, readiness, and OAuth-managed YouTube schedule. Later edits must synchronize.

## CRT-008 - Expected end time

**Status:** Accepted with optional status.  
**Decision:** Expected End Time is optional in Advanced Settings and supports planning only. It never auto-stops a stream.

## CRT-009 - Optional event modules

**Status:** Accepted.  
**Decision:** Invitation Video, Photo Slideshow, Wishes, Guest Memories, Maps, Private Livestream, and YouTube are event-level optional modules.

## CRT-010 - Draft and autosave

**Status:** Accepted.  
**Decision:** The event saves as a Draft early. Draft creation does not activate production SRS resources.

## CRT-011 - Preview parity

**Status:** Accepted.  
**Decision:** Preview and public production use the same renderer and canonical data.

## CRT-012 - Publish and live are separate

**Status:** Accepted.  
**Decision:** The page may be published before the stream. Page publishing does not start the livestream.

## CRT-013 - Post-create editing

**Status:** Accepted.  
**Decision:** Schedule, SEO, media, credits, modules, and YouTube destination can be changed after creation, with stronger controls during testing or live states.

## CRT-014 - Slug and visibility

**Status:** Accepted.  
**Decision:** A suggested editable slug is validated. Public and Unlisted are V1 visibility options. True Private access is deferred.

## SEO-001 - Manual SEO thumbnail

**Status:** Accepted.  
**Decision:** V1 allows manual upload of the SEO and social thumbnail.

## SEO-002 - Automatic thumbnail generation

**Status:** Future.  
**Decision:** Automatic thumbnail generation is a future feature and must not delay V1.

## SEO-003 - YouTube metadata defaults

**Status:** Accepted.  
**Decision:** EventCast SEO title, description, and thumbnail are the default YouTube metadata for OAuth-managed events.

## SEO-004 - Automatic YouTube tags

**Status:** Accepted.  
**Decision:** Relevant YouTube tags are generated automatically and may later be edited or overridden.

## TPL-001 - Metadata-driven template packages

**Status:** Accepted.  
**Decision:** Each template has stable metadata, supported event types, fields, sections, preview, version, and activation state.

## TPL-002 - One canonical template source

**Status:** Accepted.  
**Decision:** Template assets are maintained in one canonical package instead of several manually synchronized copies.

## TPL-003 - Shared renderer

**Status:** Accepted.  
**Decision:** Admin preview and public production share one renderer.

## TPL-004 - Template versioning

**Status:** Accepted.  
**Decision:** Existing events are protected from unexpected template updates through controlled versioning.

## TPL-005 - No full drag-and-drop builder in V1

**Status:** Accepted and refined.  
**Decision:** GrapesJS is retired and removed. The separate `D:\\EventCast-Layer-Studio` project is preserved as a future custom template authoring tool but is not a core V1 dependency.

## LIV-001 - SRS and Media Agent target

**Status:** Accepted.  
**Decision:** SRS plus the custom Media Agent is the only approved livestream architecture.

## LIV-002 - Restreamer excluded

**Status:** Accepted.  
**Decision:** Restreamer is permanently removed from the target architecture. Existing legacy UI references are migration debt.

## LIV-003 - No direct browser infrastructure access

**Status:** Accepted.  
**Decision:** Browsers never call SRS or Media Agent directly. EventCast backend mediates all provider actions.

## LIV-004 - Explicit private-stream enablement

**Status:** Accepted.  
**Decision:** A draft does not activate a stream. The user enables Private Livestream, after which ownership, capacity, plan, and schedule checks occur.

## LIV-005 - Masked credentials

**Status:** Accepted.  
**Decision:** Stream URL and Stream Key are protected, masked by default, and exposed only through authorized reveal and copy actions.

## LIV-006 - Test Stream

**Status:** Accepted.  
**Decision:** A private test mode verifies source and quality while the public page remains in a waiting state.

## LIV-007 - Live Control Room

**Status:** Accepted.  
**Decision:** The provider sees simple status, health, metrics, viewer data, YouTube state, safe controls, and recording state in one event Live tab.

## LIV-008 - No time-based hard stop

**Status:** Accepted.  
**Decision:** Expected end time and included-hour limits must not interrupt a real live event.

## YTB-001 - Provider OAuth channel

**Status:** Accepted.  
**Decision:** The provider may use a default OAuth-connected YouTube channel.

## YTB-002 - Client OAuth channel

**Status:** Accepted.  
**Decision:** A client may authorize the client channel through OAuth.

## YTB-003 - Manual scheduled YouTube event

**Status:** Accepted.  
**Decision:** A manually scheduled client event can be linked. The watch link alone supports embedding; relay requires OAuth or secure ingest credentials.

## YTB-004 - YouTube can change after creation

**Status:** Accepted.  
**Decision:** The destination can be added, edited, or replaced after the EventCast event exists.

## YTB-005 - Private stream remains independent

**Status:** Accepted.  
**Decision:** Changing or failing YouTube must not break the EventCast page or private SRS stream.

## YTB-006 - Controlled live switch

**Status:** Accepted.  
**Decision:** During a live event, a new YouTube destination is prepared and verified before an old relay is stopped.

## YTB-007 - Schedule, privacy, and metadata sync

**Status:** Accepted.  
**Decision:** OAuth-managed YouTube events use EventCast schedule, privacy default, title, description, thumbnail, and tags.

## YTB-008 - Verified long-term fallback

**Status:** Accepted.  
**Decision:** A verified YouTube archive or upload becomes the replay fallback after EventCast-hosted VOD expires.

## YTB-009 - Recommended YouTube defaults

**Status:** Accepted.  
**Decision:** EventCast uses safe recommended defaults for routine YouTube settings and exposes only channel, event selection, privacy, schedule, and approved metadata overrides that require user choice.

## EVT-001 - Separate lifecycle dimensions

**Status:** Accepted.  
**Decision:** Event, page, private stream, YouTube, recording, and media statuses remain separate.

## EVT-002 - User-facing lifecycle

**Status:** Accepted.  
**Decision:** Draft, Upcoming, Ready for Test, Testing, Live, Interrupted or Reconnecting, Ended, Replay Processing, Completed, and Archived are the accepted simple states.

## EVT-003 - Actual stream state is authoritative

**Status:** Accepted.  
**Decision:** Date math cannot declare an event Live or Completed by itself.

## EVT-004 - Archive before delete

**Status:** Accepted.  
**Decision:** Archive is non-destructive. Permanent deletion is protected and separate.

## PAGE-001 - Public page modules

**Status:** Accepted.  
**Decision:** Hero, countdown, optional Invitation Video, Livestream, optional Photo Slideshow, Wishes, Guest Memories, Maps, and Event Credits form the V1 public page.

## PAGE-002 - No separate comments feed in V1

**Status:** Accepted.  
**Decision:** Wishes remain the persistent greeting feature. Guest-to-guest conversation belongs in a future separate Live Chat Room.

## PAGE-003 - Page availability

**Status:** Accepted.  
**Decision:** The event page remains active independently for at least 12 months. VOD expiry does not expire the page.

## PAGE-004 - Shareable EventCast page QR

**Status:** Accepted.  
**Decision:** Each event may provide a QR code that opens the normal EventCast event page. This is separate from future selfie-based Photo Discovery.

## MED-001 - Global and event media views

**Status:** Accepted.  
**Decision:** The provider receives a global Media Library and an event-scoped Media tab.

## MED-002 - V1 media categories

**Status:** Accepted.  
**Decision:** SEO thumbnail, Invitation Video, Photo Slideshow, Guest Memories, recordings, and replay assets are the V1 media categories.

## GM-001 - Guest Memories name

**Status:** Accepted.  
**Decision:** Guest Photo Wall is renamed Guest Memories.

## GM-002 - Guest Memories meaning

**Status:** Accepted.  
**Decision:** Guest Memories contain guest-uploaded photos, selfies, captions, and memories. They do not perform face search.

## GM-003 - Default auto approval

**Status:** Accepted.  
**Decision:** Guest Memories are auto-approved by default after safety validation.

## GM-004 - Event-level manual approval

**Status:** Accepted.  
**Decision:** Each event can enable Manual Approval, causing submissions to enter Pending Review.

## GM-005 - Provider moderation

**Status:** Accepted.  
**Decision:** Providers can later hide, reject, or delete Guest Memories regardless of the default publishing mode.

## WISH-001 - Wishes remain separate

**Status:** Accepted.  
**Decision:** Wishes are persistent text greetings and remain separate from Guest Memories and Live Chat.

## WISH-002 - Wishes moderation

**Status:** Accepted recommendation.  
**Decision:** Wishes use review-first moderation with approve, pin, hide, reject, and delete controls.

## CHAT-001 - Separate Live Chat Room

**Status:** V1 After Core.  
**Decision:** A Join Live Chat button opens a separate page containing player and chat.

## CHAT-002 - Initial chat feature set

**Status:** V1 After Core.  
**Decision:** Text, emojis, replies, online presence, report, delete, mute, ban, slow mode, and enable or disable controls form the first chat release.

## CHAT-003 - Supabase Realtime first

**Status:** Accepted.  
**Decision:** Supabase Realtime is the initial chat platform. Durable Objects are considered only after demonstrated scale or control needs.

## CHAT-004 - Advanced chat content

**Status:** Future.  
**Decision:** GIFs, stickers, polls, reactions, games, and similar features are later enhancements.

## ANA-001 - No fake analytics

**Status:** Accepted.  
**Decision:** Uncollected or heuristic values cannot be presented as real metrics.

## ANA-002 - True page analytics

**Status:** Accepted.  
**Decision:** Page views, real unique visitors, referral, device, and approximate geography are required.

## ANA-003 - Player heartbeat audience counts

**Status:** Accepted.  
**Decision:** Current, peak, total viewers, and watch time use player-side sessions and heartbeats, not SRS client counts.

## ANA-004 - Technical stream metrics

**Status:** Accepted.  
**Decision:** Resolution, FPS, bitrate, codecs, duration, reconnects, source status, and relay status are shown.

## ANA-005 - Source-separated YouTube analytics

**Status:** Accepted.  
**Decision:** EventCast and YouTube audience metrics remain separate.

## ANA-006 - Advanced QoE analytics

**Status:** V1 After Core.  
**Decision:** Startup, buffering, playback errors, and richer quality reporting follow the core metrics.

## PART-001 - Partners and Clients directory

**Status:** Accepted.  
**Decision:** Reusable account-level profiles support photographers, studios, event managers, direct clients, venues, and other relationships.

## PART-002 - Rich partner fields

**Status:** Accepted.  
**Decision:** Profiles support logo, business name, contact, phone, WhatsApp, city, Instagram, Facebook, YouTube, website, and private notes.

## PART-003 - Internal and public separation

**Status:** Accepted.  
**Decision:** Internal client information and public Event Credits are separate.

## PART-004 - Inline selection and creation

**Status:** Accepted.  
**Decision:** Create Event supports search, select, and inline creation of a partner or client.

## PART-005 - Multiple Event Credits

**Status:** Accepted.  
**Decision:** One primary credit and additional credits can be added with approved role labels.

## PART-006 - Credit snapshots

**Status:** Accepted.  
**Decision:** Each event preserves a snapshot of approved public credit details.

## PART-007 - Event Credit versus Usage Credit

**Status:** Accepted.  
**Decision:** Public attribution and financial balance are separate concepts and names.

## PART-008 - Public Event Credit required before publish

**Status:** Accepted.  
**Decision:** At least one approved public Event Credit should normally be selected before publishing. The credited party may be a photographer, event manager, studio, venue, or another approved business; the livestream provider's own credit is optional.

## PLAN-001 - Commercial model timing

**Status:** Deferred.  
**Decision:** Exact launch plans, package names, prices, and commercial structure are deferred until infrastructure cost and customer-usage evidence are available. Earlier Trial, Single Event Pack, and Professional Plan examples are non-authoritative planning examples.

## PLAN-002 - Included streaming hours

**Status:** Deferred planning assumption.  
**Decision:** Eight hours remains a useful cost-modelling example but is not a frozen commercial entitlement in Version 2.1.

## PLAN-003 - No hard stop at eight hours

**Status:** Accepted.  
**Decision:** Overage is recorded or charged without interrupting the stream.

## PLAN-004 - Concurrent-stream entitlement foundation

**Status:** Accepted architecture; quantity deferred.  
**Decision:** Concurrency is a separate configurable entitlement. Exact plan quantities and prices are deferred.

## PLAN-005 - Add-on commercial choices

**Status:** Deferred.  
**Decision:** Potential stream-hour and concurrency add-ons remain future commercial options, not Version 2.1 implementation authority.

## PLAN-006 - No user-facing storage add-on in V1

**Status:** Accepted.  
**Decision:** Storage is not shown or sold as a V1 user-facing constraint.

## PLAN-007 - Billing rebuild deferred

**Status:** Deferred.  
**Decision:** The disabled wallet top-up is not reactivated. Billing requires a later atomic-ledger selective rebuild.

## SUP-001 - Support tab

**Status:** Accepted.  
**Decision:** Help content and event-linked support tickets are part of V1.

## SUP-002 - Urgent Live Support

**Status:** Accepted.  
**Decision:** Live or near-live events receive an urgent support path with safe automatic context.

## SUP-003 - Platform status information

**Status:** Accepted.  
**Decision:** Support may include a simple EventCast-wide status view so users can distinguish a platform incident from an event-specific problem.

## NOT-001 - In-app notification center

**Status:** Accepted.  
**Decision:** The dashboard stores a complete in-app notification history.

## NOT-002 - Email alerts

**Status:** Accepted.  
**Decision:** Email is a V1 notification channel.

## NOT-003 - Operational WhatsApp alerts

**Status:** Accepted.  
**Decision:** Approved utility alerts include event reminders, disconnect, restore, relay failure, and support reply.

## NOT-004 - Alert deduplication

**Status:** Accepted.  
**Decision:** Short outages do not create message floods. Confirmed failure and recovery are communicated clearly.

## NOT-005 - Full WhatsApp CRM

**Status:** Future.  
**Decision:** Provider-to-client messaging campaigns and CRM are deferred.

## ADM-001 - Separate Super Admin role

**Status:** Accepted.  
**Decision:** The platform owner uses a distinct Operations Console and stronger authentication.

## ADM-002 - Separate test studio account

**Status:** Accepted.  
**Decision:** Customer experience testing uses a normal account, not duplicated super-admin features.

## ADM-003 - Platform overview

**Status:** Accepted.  
**Decision:** Super Admin sees platform health, live events, viewers, node health, failures, support, and messaging status.

## ADM-004 - Users and Studios controls

**Status:** Accepted.  
**Decision:** Super Admin can suspend, restore, terminate sessions, change entitlements, extend trials, and grant capacity without seeing secrets.

## ADM-005 - Active Streams operations

**Status:** Accepted.  
**Decision:** All live streams, quality, viewers, node, relay, recording, and incident state appear in one operational view.

## ADM-006 - Node operations

**Status:** Accepted.  
**Decision:** SRS and Media Node health, capacity, heartbeat, CPU, memory, disk, network, publishers, and assignments are visible.

## ADM-007 - Metadata-first private content

**Status:** Accepted.  
**Decision:** Private content is not routinely browsed. Support or moderation access requires reason and audit.

## ADM-008 - Risk-based actions and audit

**Status:** Accepted.  
**Decision:** High-risk actions require confirmation, reason, actor, before-state, after-state, and timestamp.

## ADM-009 - Retention controls

**Status:** Accepted.  
**Decision:** Super Admin controls global VOD default, per-user override, event snapshot, and manual extension.

## STO-001 - R2 role

**Status:** Accepted.  
**Decision:** R2 stores live HLS, DVR, and short post-live safety data only.

## STO-002 - B2 role

**Status:** Accepted.  
**Decision:** B2 stores the finalized authoritative recording.

## STO-003 - Default VOD retention

**Status:** Accepted.  
**Decision:** EventCast-hosted replay is included for 90 days.

## STO-004 - Event page independent of VOD

**Status:** Accepted.  
**Decision:** The page remains active for at least 12 months and does not expire with B2 replay.

## STO-005 - YouTube fallback

**Status:** Accepted.  
**Decision:** A verified YouTube replay automatically replaces the EventCast-hosted player after expiry when available.

## STO-006 - No second cold archive in V1

**Status:** Accepted.  
**Decision:** A second archive provider is not introduced for the 90-day playback window.

## STO-007 - Retention snapshot

**Status:** Accepted.  
**Decision:** Each event freezes its effective retention so later global changes do not silently shorten existing entitlement.

## STO-008 - Manual retention extension

**Status:** Accepted.  
**Decision:** Super Admin can extend a specific event with an audited action.

## FUT-001 - Selfie Photo Discovery

**Status:** Future separate service.  
**Decision:** QR and selfie-based matching against official photographer images is a distinct future paid service.

## FUT-002 - Photography business suite

**Status:** Future.  
**Decision:** Quotations, selections, proofing, virtual albums, delivery, and invoicing follow the livestream core.

## FUT-003 - Customer-owned custom domains and white label

**Status:** Future, with foundation accepted now.  
**Decision:** Business subdomain and neutral EventCast URL foundations are part of the core architecture. Customer-owned custom domains, full white-label automation, domain resale, and managed domain registration remain future modules.

## FUT-004 - LED Display Mode

**Status:** Future.  
**Decision:** Fullscreen LED scenes, guest walls, and remote scene switching are future modules.

## FUT-005 - AR experiences

**Status:** Future.  
**Decision:** AR frames and AR photo books are innovation-stage features.

## DEV-001 - Interim baseline now, final baseline later

**Status:** Accepted.  
**Decision:** Version 1 preserves decisions before gap mapping. Version 2.1 is the corrected final baseline after the repository comparison and live schema preflight.

## DEV-002 - Read-only gap map completed

**Status:** Completed.  
**Decision:** The Claude Opus architecture revalidation and live Supabase schema preflight are incorporated into Version 2.1.

## DEV-003 - One bounded implementation slice

**Status:** Accepted.  
**Decision:** After gap mapping, implementation proceeds one goal at a time with explicit evidence and stop conditions.

## DEV-004 - Claude direction-file model

**Status:** Accepted.  
**Decision:** Stable product direction, verified current state, and one active task remain separate direction files.

## DEV-005 - Explicit approval boundaries

**Status:** Accepted.  
**Decision:** No commit, push, deploy, migration, production action, secret access, or destructive action occurs without explicit approval.

## DEV-006 - Version 2.1 correction pass

**Status:** Completed.  
**Decision:** Version 2.1 corrects document navigation, adds the business-root landing-page and EventCast Direct operations decisions, clarifies media and VOD data flow, fixes wording and decision ordering, and does not change the approved first implementation slice.

## ARC-001 - Existing Next.js application retained

**Status:** Accepted.  
**Decision:** Provider Console, Event Workspace, and Platform Operations remain inside the existing Next.js App Router and TypeScript application.

## ARC-002 - React Router Admin V2 superseded

**Status:** Superseded.  
**Decision:** The earlier separate React Router Framework Mode target is no longer the selected architecture.

## ARC-003 - Route-based modular monolith

**Status:** Accepted.  
**Decision:** The admin application uses real routes, nested layouts, server-side authorization, Server Components by default, and bounded Client Components for interactivity.

## ARC-004 - Public Worker remains separate

**Status:** Accepted.  
**Decision:** The Cloudflare Worker remains the public event-rendering and private-R2 media-delivery surface while sharing canonical contracts and template releases with the admin application.

## URL-001 - Business subdomain URL

**Status:** Accepted.  
**Decision:** The recommended branded event URL is `business.eventcast.pro/event-slug`.

## URL-002 - Neutral EventCast URL

**Status:** Accepted.  
**Decision:** Events may use a neutral URL such as `eventcast.pro/e/event-slug` when provider branding should not be highlighted.

## URL-003 - Tenant-scoped event slug

**Status:** Accepted and verified by live schema.  
**Decision:** Event slugs are unique inside a studio or tenant, not globally. The live database already enforces `UNIQUE (studio_id, slug)`.

## URL-004 - Immutable event identity

**Status:** Accepted.  
**Decision:** Slugs and hostnames are aliases. The immutable event UUID and opaque playback identity drive internal relations, streaming, analytics, and storage.

## URL-005 - Primary URL and aliases

**Status:** Accepted.  
**Decision:** One primary canonical public URL is selected, and old branded, neutral, or custom-domain links continue through aliases or redirects.

## URL-006 - EventCast direct-service tenant

**Status:** Accepted.  
**Decision:** EventCast direct livestream orders use a separate normal provider tenant, not the Super Admin role.

## URL-007 - EventCast wildcard routing

**Status:** Accepted.  
**Decision:** EventCast may use `*.eventcast.pro` for business subdomains while explicitly reserving and excluding exact infrastructure hosts such as `live.eventcast.pro` and `media.eventcast.pro` from event-page wildcard routing.

## URL-008 - Customer-domain forms

**Status:** Future.  
**Decision:** Exact customer hostnames such as `events.customer-domain.com/event-slug` are the recommended initial custom-domain pattern. Full root-domain hosting and event-per-subdomain patterns are later options.

## URL-009 - Domain resale

**Status:** Future.  
**Decision:** Bring Your Own Domain is the initial model. Managed domain registration and reseller integration are future commercial services.

## URL-010 - Business subdomain root landing page

**Status:** Accepted; V1 After Core.  
**Decision:** `business.eventcast.pro/` resolves to a simple branded business landing page or safe placeholder with business identity, contact links, and selected public events. It is separate from event templates and does not require a full website builder.

## OPS-001 - EventCast Direct internal operations data

**Status:** Accepted; V1 After Core.  
**Decision:** EventCast Direct orders may store assigned operator, equipment plan or checklist, venue contact, travel and arrival notes, and internal handoff state. This information remains private provider data and never enters the Public Event Config, public Event Credits, SEO metadata, or guest-facing page.

## CNT-001 - Three-layer event contract

**Status:** Accepted.  
**Decision:** Event Draft Input, Canonical Event Record, and safe Public Event Config are distinct layers of one official contract.

## CNT-002 - Existing eventContract review

**Status:** Accepted.  
**Decision:** The existing untracked `eventContract.ts` is reviewed and revised rather than blindly adopted or replaced by another competing contract.

## CNT-003 - Authoritative scheduled timestamp

**Status:** Accepted.  
**Decision:** One `scheduled_start_at` timestamp interpreted in Asia/Kolkata drives countdown, dashboard, readiness, and authorized YouTube scheduling.

## CNT-004 - Template version stored on event

**Status:** Accepted.  
**Decision:** Every published event records both `template_id` and exact `template_version`.

## CNT-005 - Separate status dimensions

**Status:** Accepted.  
**Decision:** Event lifecycle, page, private stream, YouTube, recording, and media status remain separate.

## TPL-006 - Canonical legacy adapter

**Status:** Accepted.  
**Decision:** TLF-001 may use a typed legacy adapter into its existing HTML/CSS/JavaScript config while moving to one package and renderer.

## TPL-007 - Layer Studio preserved

**Status:** Accepted.  
**Decision:** `D:\\EventCast-Layer-Studio` is preserved as a separate future template-creator project and is not part of the initial admin implementation.

## LEG-001 - GrapesJS removal

**Status:** Retire and Remove.  
**Decision:** GrapesJS, its route, local-sync APIs, middleware exceptions, dependencies, and unused imports are removed in a controlled cleanup.

## LEG-002 - Restreamer replacement policy

**Status:** Retire after replacement.  
**Decision:** Restreamer provider surfaces and routes are removed after the SRS Live Control Room replacement is validated.

## LEG-003 - Public legacy portal

**Status:** Retire.  
**Decision:** The unauthenticated `/portal/[slug]` is retired. A future Client Portal is a separate secure product.

## LEG-004 - Customer directories and scratch preservation

**Status:** Preserve pending inventory.  
**Decision:** Root customer-event directories and the large scratch-script set are not mass-deleted during the first implementation work.

## BIL-001 - Legacy Create Event debit retired

**Status:** Accepted.  
**Decision:** The legacy ₹499 automatic debit is removed from the new Create Event path. Wallet top-up remains disabled.

## BIL-002 - Beta entitlement

**Status:** Accepted temporary operating model.  
**Decision:** Closed-beta production publishing and Private Stream access may use Super-Admin-approved Beta Entitlement on normal test-studio accounts until real billing is rebuilt.

## SCH-001 - Live events schema preflight

**Status:** Completed.  
**Decision:** The live `public.events` table has 53 columns, RLS enabled, no custom triggers, tenant-scoped slug uniqueness, public default visibility, and legacy deployment-status constraints.

## SCH-002 - Draft schema change required

**Status:** Accepted finding.  
**Decision:** The first Draft Event slice requires a controlled schema migration because the current table lacks Draft/page-state separation, `template_version`, and one authoritative scheduled timestamp, and defaults visibility to public.

## IMP-001 - First implementation slice

**Status:** Accepted.  
**Decision:** The first bounded slice is Route-Based Draft Event Foundation.

## IMP-002 - First-slice positive scope

**Status:** Accepted.  
**Decision:** The slice provides `/events/new`, a minimal `/events/[eventId]/overview`, Wedding plus TLF-001 compatibility, revised canonical contract, tenant-scoped Draft persistence, authoritative schedule, editable slug, and reopen/edit behaviour.

## IMP-003 - First-slice exclusions

**Status:** Accepted.  
**Decision:** Public publish, production preview, SRS activation, Restreamer removal, YouTube, media, analytics, billing, OTP, Support, Super Admin, VOD, and broad cleanup are excluded.
