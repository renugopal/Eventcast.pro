# EventCast.pro Admin Panel — Implementation Roadmap

**Working roadmap date:** 2026-08-09  
**Authority:** Admin Baseline V2.1 + later explicit user decisions.  
**Rule:** This roadmap tracks implementation sequence. It does not replace the Master Baseline or Decision Register.

## Roadmap Operating Rules

Work one coherent feature/delivery package at a time (see "Execution Granularity / Delivery Packages" below) — not one file, route, migration, or test as a separate task.

Do not run repeated broad audits.

Do not commit, push, deploy, apply migrations, modify production, rotate/access secrets, or perform destructive operations without explicit approval.

Keep the legacy admin UI frozen as a reference until the V2 path is validated and an explicit cutover task is approved.

Do not reintroduce Restreamer.

Do not let parked later-phase work change the Draft-first sequence.

## Execution Granularity / Delivery Packages

**Effective 2026-08-11 (durable rule — see `EVENTCAST_ASSISTANT_MEMORY.md` §3 for the full definition).** "One bounded task" means one **coherent feature package**: targeted reads, schema/migration design (when needed), backend/API work, UI integration, Worker/renderer integration where relevant, directly-related fixes found along the way, focused tests, and TypeScript validation — completed together, in one session, not split into a separate task per file/helper/route/migration/test. Stop only at a hard boundary: an unresolved decision that can't be safely inferred, a remote migration apply/deploy/production mutation, secret access, a destructive action, or a genuinely different workstream. A migration file may be designed and locally validated inside a package; applying it remotely is that same package's own hard boundary, not a new slice — pre-apply review, apply, and post-apply verification together complete the one package.

The lettered milestones below (A–O) are a **historical/planning reference**, not a numbering system to keep extending. Milestones A–F and K are already COMPLETE / PASS and record what was actually built and in what order. Future execution groups the *remaining* Baseline work into a small number of larger **delivery packages**, mapped onto the existing Baseline V2.1 workstreams — not new product milestones, and not a new A/B/C/D-style scheme.

### Completed delivery package: Public / Unlisted Page Visibility (2026-08-11)

**COMPLETE / PASS.** Local implementation, focused validation, migration pre-apply review, and live application/post-apply verification are all complete: canonical `event_visibility` widened to add `unlisted` (migration `0031_event_visibility_unlisted_value.sql`, **applied and verified**); the five guest-engagement child-table RLS policies plus the guest-photos upload route corrected for Published+Unlisted compatibility (migration `0032_visibility_child_policy_unlisted_eligibility.sql`, **applied and verified**); the public render Worker widened to serve Published+Unlisted by direct link with `X-Robots-Tag: noindex` on Unlisted responses only; an explicit required Publish-time Public/Unlisted choice written atomically with the credit snapshot and `page_state = 'published'`; a post-Publish visibility-switch endpoint/UI; and the existing Wishes/Guest Photos/page-view engagement behavior preserved for Unlisted pages. The anonymous `events_public_select_policy` was deliberately left Public-only and unwidened throughout — confirmed unchanged post-apply. Full repository Vitest: **624/624 passed**; no new TypeScript errors in any changed file.

Both migrations were applied to the linked Supabase project via `supabase db push --linked --yes` on explicit user approval (2026-08-11). Post-apply read-only verification confirmed: migration history aligned local/remote through `0032`; `events_event_visibility_check` allows exactly `public`/`private`/`synthetic`/`unlisted`; `event_visibility` column type/nullability/default unchanged; `events_public_select_policy` unchanged and Public-only; all five child policies widened as designed with `guest_photos_public_select`'s `approved = true` intact. Do not re-audit, re-design, re-apply, or re-implement any of it. See `CURRENT_STATE.md` and `WORKLOG.md` for full evidence.

### Completed delivery package: Event Workspace + lifecycle foundation (2026-08-11)

**COMPLETE / PASS, local implementation only.** Route-based Event Workspace (`/events/[eventId]/{overview,event-page,live,media,engagement,analytics,settings}`) built around real event UUID identity, with a shared `EventWorkspaceShell`/`layout.tsx` loading the event once via the existing `GET /api/events/draft/[eventId]`. A new pure `deriveEventLifecycleStatus()` helper (`src/lib/eventLifecycle.ts`) derives Draft/Upcoming/Published/Archived from `page_state`, `archived_at`, and `scheduled_start_at` — no schema change was needed, so migration `0033` was **not** created. The Milestone D Overview page moved unchanged to the Event Page tab; the new lean Overview tab shows facts and tab links; Live/Media/Engagement/Analytics are real routes that honestly state their capability isn't implemented yet (no fabricated data); Settings integrates the existing archive/restore endpoints. The parked preliminary `/events` list was replaced with four real Draft/Upcoming/Published/Archived tabs using the same lifecycle helper. Full repository Vitest: **632/632 passed** (624 pre-existing + 8 new lifecycle tests); no new TypeScript errors in any changed file. No browser/live-authenticated verification was performed (requires a real Supabase session). See `CURRENT_STATE.md` and `WORKLOG.md` for full evidence. **Do not re-audit, re-design, or re-implement any of it.**

### Completed delivery package: Media + Engagement core (2026-08-11)

**COMPLETE / PASS.** Milestone I — the global Media Library, event Media tab, Invitation Video, Photo Slideshow, Guest Memories moderation (naming, Manual Approval, approve/hide/delete), and Wishes moderation (approve/pin/hide/reject/delete) — is done. Invitation Video and Photo Slideshow reused existing, previously-unwired columns (`events.invitation_video_url`, `events.gallery_urls`) already read by the shared renderer, so no schema or Worker change was needed for either. Guest Memories reused the existing `guest_photos` table and `events.guest_photo_moderation` column; a real defect (guest uploads always inserting `approved: true`, ignoring the moderation toggle) was found and fixed in the same package. Wishes moderation required one minimal additive migration, `0033_wishes_moderation_schema.sql` (`wishes.status`, `wishes.is_pinned`, a narrowed `wishes_select_policy`), reviewed, applied to the linked Supabase project via `supabase db push --linked --yes` on explicit user approval, and post-apply verified with no discrepancy. New/updated focused tests: 69/69 PASS. Full repository Vitest: 675/675 PASS. See `CURRENT_STATE.md` and `WORKLOG.md` for full evidence. **Do not re-audit, re-design, re-apply, or re-implement any of it.**

### Completed delivery package: Livestream + YouTube + Live Control Room (2026-08-11)

**COMPLETE / PASS as far as the current architecture safely allows, local implementation only.** Milestone H, plus the manual-link YouTube destination item from Milestone F's Selective Rebuild list, reused the existing SRS/Media Agent server-side control plane unchanged and made it reachable by a real provider action for the first time via `/api/events/[eventId]/livestream/{status,enable,end,youtube}` and a new `GET /api/livestreams` roster. The already-complete public Worker HLS delivery path needed zero changes. Test Stream required no schema change (the public Worker already refuses any page/HLS response for a Draft event). Remaining hard boundaries, deliberately not crossed: real SRS/Media Agent activation against live infrastructure, OAuth-connected YouTube channels (only the manual watch-link model is implemented), a beta-entitlement/billing gate (no schema exists), and real stream telemetry (no authoritative source exists). Full repository Vitest: **707/707 passed**; no new TypeScript errors in any changed file. See `CURRENT_STATE.md` and `WORKLOG.md` for full evidence. **Do not re-audit, re-design, or re-implement any of it.**

### Completed delivery package: Livestream + Media Agent production-acceptance (2026-08-12)

**COMPLETE / PASS. Infrastructure-level, not `eventcast-admin` application work.** Crosses the one explicit hard boundary the 2026-08-11 Livestream + YouTube + Live Control Room package stopped at ("no real SRS/Media Agent activation was performed against the live Linode deployment"), scoped to validation event `b68d4796-e234-42af-9efc-39576125e9a0` only. Real T1 production testing had already proven the Media Agent v1.0.5 session/segment playback-pinning fix and separately exposed a directly related defect: `GetAssignmentByEventID`'s unordered `WHERE event_id = ? LIMIT 1` query let live manifest generation resolve to a stale historical playback identity. Corrected in commit `d11f1d5` (deterministic selector: `source='controlplane'`, then highest `config_version`, then `updated_at DESC`; the ingest-specific `GetAssignment`/SRS `on_publish` path is unchanged); Linux CI run `31569921636` passed 7/7 jobs. A release-evidence gap was found and corrected first (v1.0.2–v1.0.4 were failed release attempts, correctly not certified; v1.0.5 evidence was backfilled instead, commit `dccb03c`). Media Agent v1.0.6 released (run `31572334054`, image `sha256:d0e8a63d146c44d848d27253a852d563d94dc11235e84134024aa24e1765da97`) and deployed to `eventcast-media-node-akm-01`; only Media Agent was recreated, SRS untouched (`StartedAt` byte-identical before/after). A real controlled A→B playback-identity rotation then proved both segment and manifest generation follow the currently active assignment: 32/32 new manifest generations across the A and B windows resolved correctly, zero under stale identities. Rollback target `sha256:a9738d97...` preserved untouched. See `CURRENT_STATE.md` and `WORKLOG.md` for full evidence. **Do not re-audit, re-deploy, or re-run this regression.** This package does not touch OAuth YouTube, a billing/entitlement gate, real stream telemetry, or VOD/Retention — those remain open, unstarted.

### Completed delivery package: Analytics + Provider operational/support/auth capabilities (2026-08-12)

**COMPLETE / PASS for its approved, provider-independent scope.** Migration `0034_analytics_support_auth_foundation.sql` (nullable `page_views.visitor_id`; the guarded `record_event_audience_heartbeat` RPC with server-side playback eligibility and server-computed 20-second buckets, no direct anonymous heartbeat INSERT; Support Tickets/messages; the in-app Notifications foundation) was applied to the linked Supabase project and post-apply verified. Real Event-page Analytics, Provider `/analytics`, Event Workspace Analytics, Support, an Urgent Live Support entry point, Notifications, and phone-first Supabase Auth preparation were implemented; Supabase Auth remains the sole verification/session authority. Heartbeat evidence is source-separated by construction — bound only to the native EventCast HLS `<video>` element's playback events, never YouTube or page-presence counts.

The updated public script (`wedding-template-01/script.js`) was uploaded to the confirmed live R2 key and publicly verified byte-identical to the approved source (SHA-256 `3c5a915c...`); the Worker template's script version query was advanced to `?v=20260812a`; and a deliberate Worker catch-up deployment (new active version `c7fe3816-dd70-4a25-a74b-9acbfa551279`) shipped that reference together with the already-completed but previously undeployed Published Credits snapshot rendering and Public/Unlisted delivery + `X-Robots-Tag: noindex` behavior, on top of the unchanged already-live HLS/`MEDIA_R2` path. Full repository Vitest: **776/776 passed**; Worker catch-up validation: **47/47 passed**, Worker `npx tsc --noEmit` clean.

**Deferred, unstarted external-provider/telemetry boundaries — separate future dependencies, not part of this package's scope or failure:** real outbound WhatsApp OTP/alerts, SMS fallback, and application-level email alerts (no credentialed provider integration exists); technical stream metrics (resolution/FPS/bitrate/codecs/reconnects/source-relay health — no authoritative telemetry source exists, unchanged from Milestone H).

Production verification confirmed the new script/Worker behavior live, with two bounded, explicitly non-failure verification gaps: live `X-Robots-Tag: noindex` on a real Published+Unlisted event was not exercised (no such event existed without creating production data — not created); live heartbeat emission during genuine playback was not exercised (no genuinely-playing stream was available without reopening the CLOSED/PASS Livestream + Media Agent production-acceptance package, which was not reopened). Both remain covered by passing source-level contract tests. See `CURRENT_STATE.md` and `WORKLOG.md` for full evidence. **Do not re-audit, re-design, re-deploy, or re-implement any of it.** This package did not touch OAuth YouTube, real outbound provider credentials, technical telemetry, billing/entitlement, VOD/Retention, Super Admin Operations, or the legacy `photographers` RLS exposure — those remain separately scoped, unstarted.

### Completed delivery package: B2 VOD Foundation — implementation, migrations `0035`/`0036`, source control, Linux CI, Cloudflare admin deploy (2026-08-14)

**COMPLETE / PASS for its approved scope only — this is the DB/local-implementation/source-control/CI/admin-deploy portion of Milestone N (VOD / Retention Lifecycle), not the whole milestone, and not Milestone M (Super Admin Operations Console).** The Media Agent (`livestream-infra/services/media-agent`) B2 archival subsystem was implemented locally: sole-authoritative-writer B2 archival, `.ts` segment + rebuilt `.m3u8` archive format, content-addressed segment keys, generation-specific playlist keys, a finalization-generation fingerprint, an async/restart-safe archival worker with durable retry state, `B2Configured`/`B2ArchivalEnabled` kept separate (production archival defaults OFF), and a spool-retention gate that fails closed once B2 archival work has begun for an event. Migration `0036_event_recording_transition_rpc.sql` (the narrow SECURITY DEFINER RPC + append-only `media_event_assignment_activations` table that let a Media Node report authoritative B2 evidence into `event_recordings`, on top of the already-applied `0035` VOD/retention foundation) was reviewed, applied to the linked Supabase project, and post-apply verified — including a live-vs-migration catalog diff proving the production `activate_media_event_assignment` function's behavior was preserved exactly. A real correctness bug found during that review (`nodeHasEventActivation()` using `.maybeSingle()` against an intentionally multi-row-capable append-only table) was repaired with regression coverage. The resulting 52-file package was committed (`e1156c8754be2f30d0560baf20322623abdde725`) and pushed to `main`, passing Linux CI (GitHub Actions run `31730804068`, including `go test -race`) and both connected Cloudflare Pages projects (`eventcast-admin`, `eventcast-pro`). See `CURRENT_STATE.md` and `WORKLOG.md` for full evidence. **Do not re-audit, re-design, re-apply, or reimplement any of it.**

**Explicitly still PENDING within Milestone N** (not touched by this package): production Media Agent release/deployment of the B2-capable image; manual B2 credential configuration on the production node; the isolated `_connectivity-test/...` probe against real Backblaze; the decision on whether strong byte-integrity verification uses Backblaze `ChecksumSHA256` or a byte-level GET/read-back fallback; enabling production B2 archival (`EVENTCAST_B2_ARCHIVE_ENABLED`); any B2 playback-delivery path (provider-safe replay currently stays `processing`, never `available`, for B2-archived-but-unverified recordings); R2 cleanup once B2 is authoritative; and the legacy cutover (Milestone O), which by definition must come after production B2 archival is validated. None of these are complete. Do not mark Milestone N fully complete until they are.

### Completed delivery package: Media Agent B2 Production Rollout / Archival Acceptance (2026-08-14)

**COMPLETE / PASS.** This delivered the entire production side of the B2 VOD work and supersedes the ten-step preflight sequence previously listed here (every step is now done). **Do not reopen it.**

Delivered: the missing v1.0.6 release evidence was recovered from its live workflow artifact and committed; Media Agent **v1.0.7**, **v1.0.8**, and **v1.0.9** were released with authoritative workflow-generated evidence committed for each; production was deployed to **v1.0.9** (`sha256:f4132e5e62b6757a2338c803a49f38efb145f88f1072577d5f7feb32d95dc182`, tag `v1.0.9-3119ee69c14e`); the node's pre-B2 `docker-compose.yml` was replaced with the repository B2-aware version (proven a strict B2-only superset); B2 credentials were configured by the operator directly on the node; the isolated `b2-connectivity` probe proved real Backblaze server-side SHA-256 enforcement (`checksum_accepted=true` **and** `corrupt_checksum_rejected=true`), selecting **`provider_checksum`**; production archival was enabled; and one real end-to-end archival acceptance passed.

Two defects were found and corrected inside the package before archival was enabled: the connectivity probe had **no production invocation path** (a narrow `b2-connectivity` subcommand was added, reusing the existing implementation), and **`strong_verified` could never become 1** (no code path set it, so integrity could never be granted and retention could never freeze — corrected in `3119ee69c14e…`, propagating the existing integrity-mode result into durable state; Linux CI including `go test -race` passed).

Acceptance evidence on zero-history synthetic event `dc6bde2d-91dd-410c-aa21-10cc54467c07`: `gap_count=0`; B2 archive `archived` with **`strong_verified=1`**, 55 objects (54 content-addressed `.ts` + one generation-specific rebuilt relative-URI `.m3u8`) in `eventcast-vod-prod`; `recording_state='b2_finalized'` with server-generated `b2_finalized_at`, **`integrity_verified_at`**, and **`retention_frozen_at`** (90-day retention, expiring 2026-11-12); spool-release gate conditions satisfied. SRS `StartedAt` remained byte-identical throughout; no customer event was touched; no B2/R2 object was deleted; migrations `0035`/`0036`, `CoveredPlaybackIDs`, gap semantics, and retention semantics were not changed. See `CURRENT_STATE.md` and `WORKLOG.md` for full evidence.

**Bounded historical limitation (recorded, not a failure of the go-forward path).** Events containing sessions that predate migration `0004` (empty `playback_id`) fail closed at B2 enqueue because playback provenance cannot be resolved; events carrying unresolved legacy `missing` segments produce a non-zero `gap_count`/`pending_review`, which correctly withholds the integrity grant and retention freeze even after a successful archive. Both are the designed fail-closed protections. Events created after playback pinning are unaffected. Remediating historical events is **not** part of any current package and would need its own separate decision.

### Completed delivery package: remaining Milestone N VOD lifecycle work (2026-08-15)

**COMPLETE / PASS for the approved V1 scope.** With production archival already live and authoritative (above), this package delivered the rest of Milestone N: a B2 playback-delivery path (public render Worker, authenticated Worker-to-B2 SigV4-signed reads, no credential/URL ever reaches the browser); replay-expiry behavior (B2 replay offered only within its retention window, live > B2 replay > legacy `vod_link` priority preserved); and verified YouTube-fallback integration, including the previously-undefined product/security decision it depended on — **explicit user decision (2026-08-15): V1 YouTube-fallback verification is manual Super Admin attestation with an audit trail, never a provider action, never an OAuth/API call** (deferred to a future phase). New migration `0037_youtube_fallback_verification_rpc.sql` (no new column; one `SECURITY DEFINER` RPC reusing `0035`'s `platform_audit_log` mechanism) was applied to the linked Supabase project and post-apply verified. A new narrow `requireSuperAdmin()`-gated route, `POST /api/platform/events/[eventId]/youtube-fallback-verification`, is the only Platform-Operations-adjacent surface this package added — deliberately not Milestone M. R2 cleanup once B2 is authoritative remains explicitly deferred to Milestone M (its eligibility predicate already existed from the `0035`/`0036` package and needed no reporting/dry-run consumer built here). See `CURRENT_STATE.md` and `WORKLOG.md` for full evidence. **Do not re-audit, re-design, re-apply, or reimplement any of it.**

### Completed delivery package: Super Admin Operations Console (Milestone M)

**COMPLETE / PASS for the approved V1 scope (2026-08-15).** Delivered in full as one coherent package: users/studios (+ studio drill-down), all events (+ per-event operational drill-down), the enabled-assignment stream roster, SRS/media nodes, read-only templates, media operations, support with reason-gated audited content access and audited triage, notifications, security/audit, retention controls, Super Admin storage visibility, and the non-destructive R2 cleanup eligibility report/dry run. **No new schema was required.** Every platform API is `requireSuperAdmin()`-gated server-side with sanitized, secret-free, PII-free allowlist projections, and every unmeasurable fact is reported as explicitly unavailable rather than synthesized. R2 destructive execution remains approval-gated and unimplemented for four precisely-recorded reasons. Full detail in the Milestone M section below; full evidence in `CURRENT_STATE.md` and `WORKLOG.md`. **Do not re-audit, re-design, or re-implement any of it.**

### Exact next delivery package: Controlled Legacy Retirement / Cutover (Milestone O)

**Not started, and deliberately not begun during Milestone M.** With Milestone M complete and validated, Milestone O is the next and final planned package: cut root navigation to V2, retire the legacy UI deliberately, controlled Restreamer cleanup, controlled GrapesJS cleanup, retire duplicate preview/render paths, and retire fake analytics and obsolete stubs. No mass cleanup of historical customer directories or scratch operational tooling without a separate inventory task. Requires its own fresh bounded-task scoping pass before implementation begins.

### Remaining delivery packages

Grouped from the remaining Baseline V2.1 work (see Milestones M–O below for full detail, preserved unchanged), in Baseline-dependency order — Livestream + YouTube + Live Control Room (Milestone H), Analytics + Provider operational/support/auth capabilities (Milestones J and L), the remaining Milestone N VOD lifecycle work, and the Super Admin Operations Console (Milestone M) are now all complete and no longer listed here:

1. **Controlled legacy cutover** (Milestone O) — the only remaining planned package, and the last one. Milestone M is now complete and validated, which was its precondition.

Not folded into this or any package above — separate, unstarted dependencies each needing their own future task/approval boundary: real outbound WhatsApp OTP/alert, SMS fallback, and application-level email provider integration (Milestone L's deferred external-provider boundary); real technical stream telemetry once an authoritative source exists (Milestone J/H's deferred telemetry boundary); OAuth-connected YouTube channels and any further real SRS/Media Agent activation beyond the already-closed production-acceptance package (Milestone H's remaining boundaries); and **R2 cleanup destructive execution**, which now has a complete non-destructive reporting/dry-run surface from Milestone M but stays blocked on an undefined post-B2 grace duration, an undefined deletion scope, and the absence of any media-R2 credential/endpoint in the admin application. The separately flagged legacy `photographers` RLS exposure remains its own unresolved, dedicated task and is not folded into any of the packages above.

## Milestone A — Admin V2 Shell

**Status: COMPLETE**

Scope:

- route-based Admin V2 shell inside existing Next.js application
- authenticated shell/context
- role-aware navigation foundation
- basic dashboard route
- legacy root remains untouched

## Milestone B — Canonical Draft Contract + Local Schema Design

**Status: COMPLETE**

Scope:

- canonical Event Draft Input
- Canonical Event Record
- Public Event Config
- authoritative `scheduled_start_at`
- Asia/Kolkata
- `template_version`
- separate page state and visibility
- Draft-safe local migration design
- focused contract tests

Migration `0029` exists locally and was applied to the linked Supabase project on 2026-08-10 (post-apply verification passed).

## Milestone C — Draft Foundation Gate

**Status: COMPLETE — APPROVED 2026-08-09**

Goal:

Verify the exact authoritative TLF-001 template identity and review migration `0029` for final first-slice compatibility.

Exit condition — all met:

- Wedding ↔ TLF-001 template mapping: repository evidence was inconclusive (no literal "TLF-001" string exists in code); the user explicitly decided `wedding-template-01` = TLF-001 for this project.
- Migration `0029` design: accepted as-is, no SQL change required.
- Explicit decision on migration application: **applied 2026-08-10** to the linked Supabase project; post-apply read-only verification passed (columns, `page_state` default/CHECK, public SELECT policy, and row counts all matched the approved design).
- Additional decision recorded: `CanonicalEventRecord.visibility` stays in the contract but is not persisted this slice — `page_state = 'draft'` is the Draft non-public safety mechanism.

## Milestone D — Real Draft-Safe Create/Edit Routes

**Status: COMPLETE — validated against real Supabase (2026-08-10). See Milestone E.**

Build the authoritative first-slice route flow:

- `/events/new`
- `/events/[eventId]/overview`
- reopen Draft
- edit Draft
- save Draft

Use the canonical contract, not the legacy generate contract.

Wedding + `wedding-template-01` (= TLF-001, confirmed by explicit user decision) only.

Persist `page_state = 'draft'` as the Draft non-public safety mechanism. Do not attempt to persist `CanonicalEventRecord.visibility` this slice — no DB column backs `'unlisted'` yet.

Strict exclusions:

- no wallet debit
- no YouTube creation
- no production media upload
- no SRS activation
- no public publish
- no Restreamer
- no broad lifecycle redesign

The preliminary `/events/new` wizard's route was replaced with the Draft-safe flow; the underlying `CreateEventWizard` component (still `/api/events/generate`-backed) is retained unreferenced as PARKED reference work, not deleted.

## Milestone E — Draft Persistence / Tenant Safety Validation

**Status: COMPLETE / PASS (2026-08-10).** Validated against real Supabase using test studio MANAVEDUKA (Studio A) and a second real test studio, VENKAT-VIDEOS (Studio B), created via the normal signup flow. All required evidence was proven: stable UUID, tenant ownership enforced, cross-tenant GET/PATCH both denied (generic 404, no mutation), Draft non-public, reopen/edit/save works, invalid template fails clearly, no forbidden side effects. Two focused defects found during validation (Edit-form timezone prefill bug; middleware blocking normal studio signup) were fixed and re-verified — see `CURRENT_STATE.md` / `WORKLOG.md` for full detail.

**Milestones A–E together constitute Phase 1 — Draft Event Foundation, which is now COMPLETE / PASS.** From here forward, planning should follow the Admin Baseline V2.1 phase/workstream structure directly rather than continuing this A/B/C/D/E-style lettered-milestone numbering; any further bounded Claude task slices belong inside whichever baseline phase is current, not as new top-level milestones. The next phase must be identified by reading `docs/admin-baseline-v2.1/` directly, not invented here.

## Milestone F — Preview, SEO, Partner Credit, Optional Modules, Publish

**Status: COMPLETE for the Partner/Event Credit item and the Public/Unlisted publishing model; Optional Modules remain as noted below.** Canonical template preview parity and SEO fields/thumbnail (including manual SEO/social thumbnail upload + assignment) are **COMPLETE / PASS (2026-08-10)**. The **Partner / Event Credit foundational schema is also COMPLETE / PASS (2026-08-10)** — migration `0030_partner_event_credit_foundation_schema.sql` (new `partners` and `event_credits` tables, tenant-scoped RLS, one-primary-per-event and `(event_id, partner_id, role_label)` uniqueness, nullable unused `events.published_credits` snapshot column) applied to the linked Supabase project and post-apply verified. The **Partner CRUD API is also COMPLETE / PASS (2026-08-10)** — `GET/POST/PATCH/DELETE /api/partners`, tenant-ownership enforced, 16/16 focused security tests passing. The **Event Credit attach/update/detach API is also COMPLETE / PASS (2026-08-10)** — `GET/POST /api/events/[eventId]/credits` and `PATCH/DELETE /api/events/[eventId]/credits/[creditId]`, Event + Partner + Credit tenant ownership enforced, 23/23 focused security tests passing. The **Create/Edit Event Partner Credit integration UI is also COMPLETE / PASS (2026-08-10)** — Partner search/select, inline Partner creation, and primary/additional Event Credit assignment wired into `/events/new` and `/events/[eventId]/overview`, 16/16 focused unit tests passing. The **canonical/public Event Credit projection + shared renderer/public footer wiring is also COMPLETE / PASS (2026-08-10)** — `eventContract.ts`'s public-safe projection (`projectPublicEventCredits`, primary-first ordering) is threaded through `PublicEventConfig` and the shared `weddingTemplateRenderer.ts`/Draft Preview path, with the primary credit reusing the existing footer studio-name/logo slot; 74/74 focused tests passing. The **Publish-time `events.published_credits` snapshot freeze is also COMPLETE / PASS (2026-08-10)** — standalone `freezePublishedEventCredits()` helper (`src/lib/publishedCreditsSnapshot.ts`), write-once (does not overwrite an already-frozen snapshot), reuses `projectPublicEventCredits()` unchanged, not invoked by the Publish route; 7/7 focused tests passing. The **controlled Public Page Publish action is also COMPLETE / PASS (2026-08-10)** — `POST /api/events/[eventId]/publish` (authenticated via `requireAdmin()` + tenant ownership) writes the server-derived public-safe credit snapshot and `page_state = 'published'` together in one `events` row update scoped by Event id, studio ownership, and expected Draft state; minimal Admin Overview **Publish page** control; the public Worker now renders published Event Credits from the frozen `events.published_credits` snapshot instead of mutable Partner data; and the Worker requires `page_state = 'published'` in both public Event lookup paths as the public-delivery gate (it uses the service-role key and so bypasses the anonymous `events_public_select_policy`). 94/94 Publish-focused admin tests and 12/12 Worker contract tests passing. The **Partner authorization alignment is COMPLETE / PASS (2026-08-10)** — a discovered intra-studio privilege-separation gap (a `member`-role studio user could mutate Partners because `requireAdmin()` did not carry `studio_members.role` and the Partner API's service-role client bypasses RLS) was corrected by threading sanitized `studioMemberRole` through `requireAdmin()` → `GET /api/auth/context` → the Admin V2 client context, and gating the three Partner mutation routes on `owner`/`admin` before any ownership lookup; 38/38 focused Partner/Auth tests and 78/78 adjacent regression tests passing; not a cross-tenant issue. The **standalone Partner directory UI is now also COMPLETE / PASS (2026-08-10)** — account-level Create/Edit/Delete/search/filter at `/partners`, `owner`/`admin` writable and `member` read-only reflecting the server-enforced rule, full schema-backed field set, `internalNotes` clearly private, `logoUrl` plain-text-only, 409 delete conflict surfaced verbatim, no retroactive effect on published credit snapshots; 30/30 and 68/68 focused tests passing. See `CURRENT_STATE.md` and `WORKLOG.md` for full evidence. **The Partner/Client/Event Credit item of this milestone is now fully COMPLETE / PASS with nothing pending.** **The Public / Unlisted publishing model is also now COMPLETE / PASS (2026-08-11)** — canonical `event_visibility` widened to add `unlisted` (migration `0031`, applied and post-apply verified), the five guest-engagement child policies plus the Guest Photos upload route corrected for Published+Unlisted compatibility (migration `0032`, applied and post-apply verified), Worker Published+Unlisted delivery with `X-Robots-Tag: noindex`, an explicit Publish-time Public/Unlisted choice, and post-Publish visibility switching; `events_public_select_policy` remains Public-only and unwidened throughout. See `CURRENT_STATE.md` and `WORKLOG.md` for full evidence. Optional event modules remain **PENDING**.

This follows the baseline's expected next slice.

Scope should include only the approved bounded publish path:

- canonical template preview parity — **COMPLETE**
- SEO fields/thumbnail — **COMPLETE**
- Partner / Event Credit integration:
  - foundational schema (`partners`, `event_credits`, `events.published_credits`) — **COMPLETE / PASS (2026-08-10)**
  - Partner CRUD API (`GET/POST/PATCH/DELETE /api/partners`, tenant-ownership enforced, focused security tests) — **COMPLETE / PASS (2026-08-10)**
  - event-credit attach/update/detach API (`GET/POST /api/events/[eventId]/credits`, `PATCH/DELETE /api/events/[eventId]/credits/[creditId]`, tenant-ownership enforced, focused security tests) — **COMPLETE / PASS (2026-08-10)**
  - Create/Edit Event Partner Credit integration UI (Partner search/select, inline Partner creation via the existing Partner CRUD API, primary/additional Event Credit assignment via the existing Event Credit API) — **COMPLETE / PASS (2026-08-10)**
  - canonical/public Event Credit projection + shared renderer/public footer wiring (`eventContract.ts` public-safe projection, `weddingTemplateRenderer.ts` `eventCredits` threading, Draft Preview hydration) — **COMPLETE / PASS (2026-08-10)**
  - Publish-time `events.published_credits` snapshot freeze (`freezePublishedEventCredits()`, write-once, standalone capability, not invoked by the Publish route) — **COMPLETE / PASS (2026-08-10)**
  - Partner authorization alignment (`studioMemberRole` threaded through `requireAdmin()` → `/api/auth/context` → Admin V2 client context; Partner mutation routes enforce owner/admin, member read-only) — **COMPLETE / PASS (2026-08-10)**
  - standalone Partner directory UI (`/partners`, role-aware Create/Edit/Delete, full field set, 409 delete conflict surfaced) — **COMPLETE / PASS (2026-08-10)**
- optional event modules — **PENDING**
- Public / Unlisted publishing model — **COMPLETE / PASS (2026-08-11)** (canonical `event_visibility` widened to add `unlisted` via migration `0031`, applied and verified; five guest-engagement child policies plus the Guest Photos upload route corrected via migration `0032`, applied and verified; Worker Published+Unlisted delivery with `X-Robots-Tag: noindex`; Publish-time Public/Unlisted choice; post-Publish visibility switching; `events_public_select_policy` remains Public-only and unwidened)
- controlled page publish action — **COMPLETE / PASS (2026-08-10)**
  - `POST /api/events/[eventId]/publish`, authenticated through the existing `requireAdmin()` + tenant-ownership pattern; page publishing only, no Livestream start/activation
  - the server-derived public-safe credit snapshot and the `page_state = 'published'` transition are written together in one `events` row update, conditionally scoped by Event id, studio ownership, and expected `page_state = 'draft'` (freeze/transition ordering and atomicity are therefore resolved; the standalone write-once helper is not the Publish transaction)
  - fails closed on a pre-frozen Draft, a credit-query failure, a database update failure, an already-published Event, and a lost concurrency race; no-credit Events publish with `published_credits = []`; the request body never controls the stored snapshot
  - minimal Admin Overview **Publish page** control that reflects Published state afterward and does not imply Livestream start
  - public Worker renders published Event Credits from the frozen `events.published_credits` snapshot via the existing shared renderer/footer adapter — no live Partner/Event Credit query, no second renderer or credit surface
  - public Worker requires `page_state = 'published'` in both public Event lookup paths (primary slug and hyphenated-slug fallback) as the public-delivery gate, since the service-role read bypasses the anonymous `events_public_select_policy`; existing `event_visibility = public` and `archived_at IS NULL` filters preserved

Separately flagged, unresolved, not part of this milestone's scope: the legacy `photographers` table carries two undocumented live RLS policies (`Admin full access on photographers`, `Public can view photographers`) granting broad/public access — a real security exposure requiring its own dedicated task.

Do not mix livestream activation into page publishing.

## Milestone G — Provider Events / Event Workspace Expansion

**Status: COMPLETE / PASS (2026-08-11), local implementation only.**

Route-based Event Workspace built around real event UUID identity and separated status dimensions (`page_state`, `archived_at`, `scheduled_start_at` — no new schema required).

Built tabs/surfaces:

- Overview — lean facts + tab links (new)
- Event Page — the original Milestone D Overview content, moved unchanged (Draft edit, Preview, Publish, visibility switch, SEO thumbnail, Partner/Event Credit management)
- Live — real route, states plainly it is not implemented yet (Milestone H)
- Media — real route, states plainly it is not implemented yet (Milestone I)
- Engagement — real route, states plainly it is not implemented yet (Milestone I)
- Analytics — real route, states plainly it is not implemented yet (Milestone J)
- Settings — archive/restore, integrating the existing endpoints

Date math alone is not used to declare Live or Completed — `deriveEventLifecycleStatus()` (`src/lib/eventLifecycle.ts`) represents a published event past its scheduled time as the neutral `published` bucket, not Live/Ended/Completed, since no stream/recording evidence exists yet.

The formerly-parked preliminary `/events` list has been replaced by the authoritative Provider Events surface (Draft/Upcoming/Published/Archived tabs, same lifecycle helper, each row opens the real Event Workspace). See `CURRENT_STATE.md` and `WORKLOG.md` for full evidence. **Do not re-audit, re-design, or re-implement this milestone.**

## Milestone H — Private Livestream / Live Control Room

**Status: COMPLETE / PASS (2026-08-11), as far as the current architecture safely allows — local implementation only.**

Built on the existing SRS + Media Agent groundwork exactly as it stood:

- assignment-status bridge (`/api/media/assignment-status`) — left unchanged; a new studio-safe `studioLiveStatus.ts` projection was added alongside it for the Live Control Room's own hostname/Stream URL need
- browser-safe assignment projection pattern — reused as the model for the new projection
- existing Media Agent control plane (`ensureDraftAssignment`, `activateAssignment`, `deactivateAssignment`) — called directly from new owner/admin-gated studio routes instead of only the operator-secret internal routes

Delivered:

- explicit private-stream enablement (`POST /api/events/[eventId]/livestream/enable`), archived-event guarded, ownership-gated
- masked ingest credentials with reveal/copy — Stream Key is genuinely one-time (only its hash is ever persisted); Stream URL is re-displayable
- Test Stream — achieved via existing `page_state` gating with no schema change, not a separate mechanism
- safe end/control action (`POST .../end`)
- YouTube manual watch-link model only (YTB-003)

Deliberately not delivered — remaining hard boundaries:

- real SRS/Media Agent activation against live infrastructure (code path written and unit-tested only)
- OAuth-connected provider/client YouTube channels and any real relay (`youtube_enabled`/`youtube_secret_reference`) — needs real OAuth credentials and a secret-store write path
- source/technical stream metrics and viewers — no authoritative telemetry source exists yet
- recording state — no authoritative source yet (remains VOD/Retention, Milestone N)
- a beta-entitlement/billing gate on enablement — no authoritative schema exists

Restreamer routes were not used or reintroduced. See `CURRENT_STATE.md`/`WORKLOG.md` for full evidence. **Do not re-audit, re-design, or re-implement any of it.**

## Milestone I — Media + Engagement

**Status: COMPLETE / PASS (2026-08-11).** Global Media Library (`/media`, read-only, studio-scoped), Event Workspace Media tab (Invitation Video assign/remove, Photo Slideshow upload/reorder/remove), Guest Memories (moderation list, Manual Approval toggle, approve/hide/delete — auto-approval remains the default), and Wishes moderation (approve/pin/hide/reject/delete) are all built and validated. See Milestone F/K-style detail in `CURRENT_STATE.md` and full evidence in `WORKLOG.md`. Storage usage remains hidden from normal providers, unchanged. **Do not re-audit, re-design, or re-implement this milestone.**

## Milestone J — Analytics

**Status: COMPLETE / PASS (2026-08-12).** Real measured Event-page Analytics, Provider `/analytics`, and Event Workspace Analytics were implemented, backed by migration `0034`'s `page_views.visitor_id` and the guarded `record_event_audience_heartbeat` RPC (server-side eligibility re-checked per call, server-computed 20-second buckets, no direct anonymous INSERT). No heuristic/fake metrics were implemented. Event-page analytics and livestream audience heartbeat evidence remain source-separated from YouTube playback and page-presence counts, verified by source inspection and by contract tests. Technical stream metrics (resolution/FPS/bitrate/codecs/reconnects/source-relay health) remain **deferred** — no authoritative telemetry source exists, unchanged from Milestone H. See `CURRENT_STATE.md` and `WORKLOG.md` for full evidence. **Do not re-audit, re-design, or re-implement the delivered scope; the technical-telemetry deferral is a separate future dependency, not a defect.**

## Milestone K — Partners / Clients / Event Credits

**Status: COMPLETE / PASS (2026-08-10).** Every item of this milestone is now complete, all under Milestone F's Partner/Event Credit integration work — see Milestone F and `CURRENT_STATE.md`/`WORKLOG.md` for full evidence. The foundational schema (`partners`, `event_credits`, `events.published_credits`), the server-side **Partner CRUD API** (`GET/POST/PATCH/DELETE /api/partners`, tenant-ownership enforced), the server-side **Event Credit attach/update/detach API** (`GET/POST /api/events/[eventId]/credits`, `PATCH/DELETE /api/events/[eventId]/credits/[creditId]`, tenant-ownership enforced), the **Create/Edit Event Partner Credit integration UI** (Partner search/select, inline Partner creation, primary/additional Event Credit assignment in `/events/new` and `/events/[eventId]/overview`), the **canonical/public Event Credit projection + shared renderer/public footer wiring** (public-safe projection in `eventContract.ts`, `eventCredits` threaded through `weddingTemplateRenderer.ts`, Draft Preview hydration — primary credit rendered first via the existing footer slot, additional credits threaded deterministically), and the **Publish-time `events.published_credits` snapshot freeze** are all COMPLETE / PASS. The snapshot-freeze portion has two parts: the standalone write-once `freezePublishedEventCredits()` helper (`src/lib/publishedCreditsSnapshot.ts`), and the controlled Publish action itself, which derives the same public-safe projection server-side and freezes `published_credits` in the same single `events` row update that performs the Draft → Published transition (it does not call the standalone helper). The public Worker consumes that frozen snapshot for published pages instead of live Partner data.

**Partner authorization alignment is COMPLETE / PASS (2026-08-10).** A real intra-studio privilege-separation gap was found (a `member`-role studio member could mutate Partners through the API because `requireAdmin()` did not carry `studio_members.role` and the Partner API's service-role client bypasses RLS — not a cross-tenant issue) and corrected: `studioMemberRole` (`owner`/`admin`/`member`) now flows through `requireAdmin()` → `GET /api/auth/context` → the Admin V2 client context, and the three Partner mutation routes enforce `owner`/`admin` before any ownership lookup, returning 403 for `member`.

**This milestone's own remaining scope — standalone Partner Directory management UI — is now also COMPLETE / PASS (2026-08-10).** New account-level `/partners` route and `PartnerDirectory` component: list/search/filter for every studio member, Create/Edit/Delete for `owner`/`admin`, read-only for `member` (server-enforced, UI-reflected), the complete schema-backed field set with `internalNotes` clearly labelled private/internal and `logoUrl` handled as a plain hosted-logo URL (no upload pipeline), and the API's 409 "still credited on an event" delete conflict surfaced verbatim. Editing a Partner here never retroactively alters an already-published frozen Event Credit snapshot. 30/30 and 68/68 focused tests passing; no file changed by this slice appears in the repository's known pre-existing TypeScript error output.

**No remaining Milestone K item exists.** Reusable partner/client directory: built. Public Event Credit snapshotting: built. Internal client data kept separate from public credits: enforced by the completed projection and reaffirmed by the directory UI's field-privacy wording.

## Milestone L — Authentication, Support, Notifications

**Status: COMPLETE / PASS (2026-08-12) for its approved, provider-independent scope.** Support Tickets/messages, an Urgent Live Support entry point, an in-app Notifications foundation, and phone-first Supabase Auth preparation were implemented, backed by migration `0034`. Supabase Auth remains the sole verification/session authority — no second, EventCast-owned `phone_verified` authority was introduced. **Deferred, unstarted external-provider boundary:** real outbound WhatsApp OTP/alerts, SMS fallback, and application-level email alerts remain unimplemented — no credentialed provider integration exists yet; exact provider choices remain a distinct future task-level decision, not part of this package's approved scope. See `CURRENT_STATE.md` and `WORKLOG.md` for full evidence. **Do not re-audit, re-design, or re-implement the delivered scope.**

## Milestone M — Super Admin Operations Console

**Status: COMPLETE / PASS for the approved V1 scope (2026-08-15).** Delivered as one coherent platform-only package inside the existing `/platform` route boundary, reusing `requireSuperAdmin()`, `platform_users`, `platform_audit_log`, the studio/event/assignment/node data, `event_recordings` and its `0035`/`0036`/`0037` RPCs, `0034`'s Support/Notifications schema, `CANONICAL_TEMPLATES`, and `isR2CleanupEligible()`. **No new migration was required** — a targeted reconciliation established that every listed capability is expressible on the existing schema, so none was invented for query convenience.

Every one of the eleven required surfaces below is built. Every platform API is server-side, edge-runtime, and `requireSuperAdmin()`-gated as its first statement; responses are explicit allowlists carrying no stream/publish/OAuth/storage secrets and no contact PII. Facts with no authoritative source (real ingest state, technical stream metrics, node CPU/memory/network, OAuth YouTube state, outbound message delivery, per-object R2/B2 bytes) are returned as explicit unavailable facts with reasons, never synthesized. Reading private Support content requires a stated reason and is audited before disclosure (ADM-007/ADM-008).

**R2 cleanup execution/reporting — the part this milestone owned — landed as a complete non-destructive eligibility report and dry run** reusing `isR2CleanupEligible()` verbatim and failing closed to zero candidate prefixes. **Destructive execution remains approval-gated and unimplemented**, because its semantics are not authoritatively defined: no post-B2 grace duration exists anywhere; this application holds no media-R2 credential/endpoint (`eventcast-livestream-media` is reachable only via the render Worker's `MEDIA_R2` binding); the deletion scope is undecided; and the node-side `EVENTCAST_R2_OBJECT_PREFIX` is unreadable here. No R2 or B2 object was listed, read, modified, or deleted.

**Deliberately not invented, each reported honestly in the UI:** account suspend/restore, session termination, entitlement changes and trial extension (no mechanism exists; billing deferred by PLAN-007); a template deployment/editor/publishing pipeline; and a platform-side Support reply (`support_ticket_messages` has no authorship-role column, so a Super Admin reply would reach the provider unattributed — that needs an additive migration plus a provider-surface attribution change).

Validation: new focused suites 77/77 PASS; directly-related regression suites 79/79 PASS; full `eventcast-admin` Vitest 984/984 PASS across 88 files; `npx tsc --noEmit` byte-identical to the pre-change 59-line baseline with zero new errors. See `CURRENT_STATE.md` and `WORKLOG.md` for full evidence. **Do not re-audit, re-design, or re-implement any of it.**

Platform-only operational surface (all delivered):

- users/studios
- all events
- active streams
- SRS/media nodes
- templates
- media operations
- support
- notifications
- security/audit
- retention controls
- Super Admin storage visibility

Do not expose secrets as ordinary UI data.

## Milestone N — VOD / Retention Lifecycle

**Status: COMPLETE / PASS for the approved V1 scope (2026-08-15).** DB foundation, local implementation, the full production rollout/archival acceptance, and the remaining VOD lifecycle work (B2 playback delivery, replay expiry, verified YouTube-fallback consumption + its manual Super Admin attestation producer) are all done.

**COMPLETE / PASS:** migrations `0035`/`0036`/`0037` applied and verified; the Media Agent B2 archival subsystem; source control + Linux CI + Cloudflare admin deploy; the entire production side — Media Agent v1.0.7/v1.0.8/v1.0.9 releases with committed evidence, production deployment to v1.0.9, B2 credential configuration, the real Backblaze connectivity probe proving server-side SHA-256 enforcement, the `provider_checksum` strong-verification decision, the `strong_verified` propagation correction, production archival enablement, and one real end-to-end archival acceptance reaching `b2_finalized` with `integrity_verified_at` and natural retention freeze (see "Completed delivery package: Media Agent B2 Production Rollout / Archival Acceptance" above); **and** the remaining VOD lifecycle work — a real B2 playback-delivery path (authenticated Worker-to-B2 proxy, provider-safe replay reaches `available` once fully evidenced and a B2 read path is configured), replay-expiry behavior (B2 replay offered only within its retention window), and verified YouTube-fallback integration with V1's manual-Super-Admin-attestation verification model (migration `0037`, applied and post-apply verified 2026-08-15) (see "Completed delivery package: remaining Milestone N VOD lifecycle work" above).

**Explicitly deferred, not a gap in this milestone's approved V1 scope:** R2 cleanup execution/reporting once B2 is authoritative is Milestone M's surface (the eligibility predicate itself already exists and is proven); OAuth/API-based YouTube verification remains a distinct future phase. Separately noted, not scheduled: historical events with pre-`0004` empty `playback_id` sessions or unresolved legacy `missing` segments fail closed from authoritative B2 archival/integrity promotion by design.

Target:

- R2 live/DVR/short grace
- finalized authoritative VOD in B2
- 90-day default hosted replay
- event page remains active independently
- verified YouTube fallback after expiry
- retention snapshots and audited extension

## Milestone O — Legacy Retirement / Cutover

**Status: PRODUCTION CUTOVER COMPLETE / PASS (2026-08-26).** Local cutover was validated 2026-08-15; production deployment (the item this status line used to mark pending) is now also complete — see "Production Cutover Complete (2026-08-26)" below. Note: it did not ship via the Cloudflare Pages path this section originally assumed (both Pages deploy attempts failed); it shipped via a parallel OpenNext + Cloudflare Workers hosting path instead. The retained text below is the original local-completion record.

Every target below was executed and validated locally. The live/production cutover is **not** complete: deploying the retirement and the `cron-jobs.yml` change, plus post-deploy verification, is the single remaining Milestone O hard boundary.

**Delivered:** root `/` now redirects to the V2 `/dashboard`; the legacy Admin UI (16 components), GrapesJS + `/api/local-sync`, the retired Restreamer application paths, the duplicate GitHub-Raw preview path, the obsolete `/api/events/generate` path, and the fake-analytics/obsolete stubs are retired, together with their now-obsolete tests. `/portal/[slug]` and the named compatibility layers are intentionally retained. **No migration and no dependency/lockfile change** was required — migration history remains `0001`–`0037`. `.github/workflows/cron-jobs.yml` now retains only `sync-live-status` on the approved 15-minute cadence.

**Validation:** focused 96/96; full `eventcast-admin` Vitest **957/957 across 82 files**; `npm run build` PASS with a route manifest containing no retired route; `npx tsc --noEmit` exit 2 with **zero new diagnostics** (59 → 14 lines, a strict subset of the pre-Milestone-O baseline); `git diff --check` exit 0; authenticated browser smoke PASS (all 10 retired APIs return 404 when authenticated). Milestones N and M remained closed and were not reopened.

Full detail: `WORKLOG.md` and `CURRENT_STATE.md`, "Completed Delivery Package — Milestone O Controlled Legacy Retirement / Cutover (2026-08-15)".

Original target list, all now delivered locally:

- cut root navigation to V2
- remove/retire legacy UI deliberately
- controlled Restreamer legacy cleanup
- controlled GrapesJS cleanup
- retire duplicate preview/render paths
- retire fake analytics and obsolete stubs

No mass cleanup of historical customer directories or scratch operational tooling without a separate inventory task.

### Production Cutover Complete (2026-08-26)

**PRODUCTION CUTOVER COMPLETE / PASS.** Official production admin URL: `https://studio.eventcast.pro` (Cloudflare Workers Custom Domain). Active Worker version: `73acbaa3-9774-4b13-8a55-5857c0cadf5e` at 100% on `eventcast-admin-worker`. `origin/main`: `b5467fdd9b056e7ee48469f9cbf5b861bfbac773`. Cron intentionally targets `https://eventcast-admin-worker.renugopalchebrolu.workers.dev` (Cloudflare Free-plan Bot Fight Mode blocks non-browser traffic on the `eventcast.pro` zone; `workers.dev` sits outside it). Post-promotion scheduled cron run `32892978910` at `2026-08-25T20:02:00Z` returned HTTP 200 success. `eventcast-admin.pages.dev` retained as a healthy fallback, auto-deploy disabled, last successful deployment `6f4b802`. Full detail: `WORKLOG.md` and `CURRENT_STATE.md`, "Milestone O — Production Cutover Complete (2026-08-26)"; `HANDOFF.md` for the next-session summary. Do not reopen: the local-cutover validation above, Milestones M/N, preview acceptance, or the superseded `/api/events/*` Cloudflare-interception hypothesis (real cause was uBlock Origin in Microsoft Edge).

**MILESTONE O — PRODUCTION CUTOVER COMPLETE / PASS**
