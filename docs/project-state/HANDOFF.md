# EventCast.pro Admin Panel — New Chat Handoff

**Prepared:** 2026-08-09  
**Workflow-corrected:** 2026-08-11 — read the rule immediately below before doing anything else.  
**Use:** Start a new ChatGPT session from this file plus the repository baseline authority.

## Execution Rule — Read This First (durable, 2026-08-11)

**"One bounded task" means one coherent feature package — not one file, helper, API route, migration file, test, or verification step.** Full definition: `docs/project-memory/EVENTCAST_ASSISTANT_MEMORY.md` §3; delivery-package grouping: `IMPLEMENTATION_ROADMAP.md`'s "Execution Granularity / Delivery Packages" section.

A coherent feature package normally includes, in one pass and one session: targeted reads, schema/migration design (when needed), backend/API work, UI integration, Worker/renderer integration where relevant, directly-related corrections discovered during implementation, focused tests, and TypeScript validation. Do not split these into separate tasks, separate Claude sessions, separate planning gates, or separate continuity updates. Do not stop merely because a small, directly-related defect is found — fix it inside the same package when safe.

Stop only at a **hard boundary**: an unresolved product/architecture/security decision that can't be safely inferred; a remote database migration/application; deploy or production mutation; secret/credential access; a destructive Git/cloud/network action; a genuinely independent workstream; or a discovered issue whose fix would materially expand the approved package. A migration **file** may be designed and locally validated inside the package — applying it remotely is that same package's own hard boundary, not a new slice; after approval, apply + post-apply verification complete that same package.

Continuity files (`CURRENT_STATE.md`, `WORKLOG.md`, `IMPLEMENTATION_ROADMAP.md`, `HANDOFF.md`) are updated **once**, after a feature package reaches its agreed completion boundary — not after every helper/route/migration/test inside it.

## Start Here

The authoritative product/architecture package is already copied into:

`D:\Eventcast.pro\docs\admin-baseline-v2.1\`

The key files are:

`00_READ_ME_FIRST.md`  
`01_EventCast_Admin_Final_Product_Architecture_and_V1_Scope_Baseline_v2.1.md`  
`02_EventCast_Admin_Decision_Register_v2.1.md`  
`03_EventCast_Admin_Current_State_and_Final_Gap_Map_v2.1.md`  
`04_EventCast_Live_Supabase_Events_Schema_Preflight_v2.1.md`  
`05_EventCast_First_Implementation_Slice_Route_Based_Draft_Event_Foundation_v2.1.md`

`eventcast-admin/CLAUDE.md` points Claude to this authority.

Do not replace V2.1 baseline authority with old audit assumptions, old handoffs, or AI memory.

## Current Implementation Position

Completed:

- Admin V2 shell/auth foundation
- baseline files installed in repo
- project direction in CLAUDE.md
- reconciliation against V2.1 baseline
- canonical three-layer event contract
- local Draft schema migration design `0029`
- 39/39 focused contract tests passing

Migration `0029` was **applied** to the linked Supabase project on 2026-08-10; post-apply verification passed.

**Phase 1 — Draft Event Foundation is now COMPLETE / PASS (2026-08-10)**, validated against the real database: real Draft created/reopened/edited/saved through the Admin V2 UI (UUID `8fec8eae-12fc-4b09-b9c8-4a5a279cf6b9`, owned by test studio MANAVEDUKA), non-public while `page_state='draft'`, invalid template rejected cleanly, and cross-tenant isolation proven against a second real test studio (VENKAT-VIDEOS) — cross-tenant GET/PATCH both denied with the existing generic 404, Studio A's Draft unchanged. Two focused defects found during this validation were fixed: an Edit-form timezone prefill bug (`scheduledStartAtToIstDateTimeLocal` in `eventContract.ts`) and a middleware gap blocking the normal `/api/studios/signup` flow. **Do not re-audit or re-validate Phase 1.** See `CURRENT_STATE.md` and `WORKLOG.md` for full detail.

**Within the post-Draft Baseline V2.1 workstream ("Template Preview, SEO, Partner Credit, Optional Modules, and Public Page Publish using the canonical renderer"), Canonical TLF-001 Preview and SEO thumbnail capability (including manual thumbnail upload + owner-only assignment) are also now COMPLETE / PASS (2026-08-10).** Admin Preview and the public Worker share one canonical `renderEvent()` implementation; a real `event_time` formatting defect was found and fixed; `events.thumbnail_url` is threaded end-to-end into the renderer's existing OG/Twitter behavior; and a new owner-only `PATCH /api/events/[eventId]/thumbnail` route lets a studio upload (via the existing `/api/r2-upload`) and assign its own thumbnail, with URL-origin/path validation and old-object cleanup intentionally deferred. Full evidence and test counts are in `CURRENT_STATE.md` and `WORKLOG.md`. **Do not re-audit or re-validate this work.**

**The Partner / Event Credit foundational schema is also COMPLETE / PASS (2026-08-10).** Migration `eventcast-admin/supabase/migrations/0030_partner_event_credit_foundation_schema.sql` — new `public.partners` (studio-owned Partner/Client master identity, tenant-scoped RLS) and `public.event_credits` (editable event-to-partner credit references, one-primary-per-event plus `(event_id, partner_id, role_label)` uniqueness, tenant isolation fully database-enforced) tables, plus a nullable unused `public.events.published_credits jsonb` snapshot column reserved for the future Publish task — has been **applied** to the linked Supabase project; post-apply read-only verification passed (tables/column exist, all 5 indexes present, RLS enabled, exactly 4 policies on each new table with no broad/public-access policy). `photographers` and `events.photographer_id` remain fully untouched for compatibility. **Do not re-audit, re-design, or re-apply this migration.** Full evidence is in `CURRENT_STATE.md` and `WORKLOG.md`.

**The Partner CRUD API is also COMPLETE / PASS (2026-08-10).** New `src/app/api/partners/route.ts` (`GET` list, `POST` create) and `src/app/api/partners/[partnerId]/route.ts` (`PATCH`, `DELETE`), plus new `src/lib/partnerFields.ts` and a new `getOwnedPartnerById` helper in `src/lib/ownership.ts` (mirrors the existing `getOwnedEventById` non-enumerating ownership pattern — same generic 404 for cross-tenant and nonexistent Partners, before any mutation). Studio identity always comes from `requireAdmin`/`auth.studioId`, never a client-supplied `studio_id`; the mutation query itself is additionally scoped by both `id` and `studio_id`. New `tests/security/partners-api.test.ts` — **16/16 PASS**. A repository-wide `npx tsc --noEmit` still exits non-zero from pre-existing, unrelated errors only; zero errors remain in any file this slice changed. Full evidence is in `CURRENT_STATE.md` and `WORKLOG.md`. **Do not re-implement, re-audit, or re-validate this slice.**

**The Event Credit attach/update/detach API is also COMPLETE / PASS (2026-08-10).** New `src/app/api/events/[eventId]/credits/route.ts` (`GET` list, `POST` attach an existing Partner) and `src/app/api/events/[eventId]/credits/[creditId]/route.ts` (`PATCH` update `roleLabel`/`isPrimary`, `DELETE` detach), plus a new `getEventCreditById` helper in `src/lib/ownership.ts`. Every verb proves Event ownership via `getOwnedEventById` first (generic `Event not found` 404); `POST` additionally proves Partner ownership via `getOwnedPartnerById` (generic `Partner not found` 404) before insert; `PATCH`/`DELETE` resolve the Credit via `getEventCreditById` scoped to the already-owned Event (generic `Event credit not found` 404) before any mutation. The two existing migration-`0030` uniqueness constraints (one primary per event; exact `(event_id, partner_id, role_label)` duplicate) were left untouched — Postgres `23505` violations from them are mapped to clear `409` responses instead of a raw 500. New `tests/security/events-credits-api.test.ts` — **23/23 PASS**. A repository-wide `npx tsc --noEmit` still exits non-zero from the same pre-existing, unrelated errors only; zero errors remain in any file this slice changed. Full evidence is in `CURRENT_STATE.md` and `WORKLOG.md`. **Do not re-implement, re-audit, or re-validate this slice.**

**The Create/Edit Event Partner Credit integration UI is also COMPLETE / PASS (2026-08-10).** New `src/lib/partnerCreditClient.ts` (client-side data helpers, including new-Draft attach sequencing) and new `src/app/(admin-v2)/_components/draft-event/PartnerCreditSection.tsx` (shared Partner search/select, inline Partner creation, primary/additional credit UI), wired into `src/app/(admin-v2)/events/new/page.tsx` (queued credits, attached only after the Draft exists) and `src/app/(admin-v2)/events/[eventId]/overview/page.tsx` (live load/add/edit/remove against the real Event Credit API). `eventContract.ts`/`EventDraftInput` were not modified; Partner/Event Credit state stays separate from the canonical Draft payload. For a new Event, the Draft is created first, then queued credits are attached one at a time — a successfully created Draft is never rolled back on a later credit-attach failure; the UI shows a partial-success message with a link to continue on the created Event. New `tests/contract/partnerCreditClient.test.ts` — **16/16 PASS**. Zero TypeScript errors in any file this slice changed; the same already-documented, pre-existing, unrelated repository errors remain elsewhere. Full evidence is in `CURRENT_STATE.md` and `WORKLOG.md`. **Do not re-implement, re-audit, or re-validate this slice.**

**The canonical/public Event Credit projection + shared renderer/public footer wiring is also COMPLETE / PASS (2026-08-10).** `src/lib/eventContract.ts` gained a public-safe Event Credit projection (`projectPublicEventCredits`, primary credit first, additional credits deterministic) that deliberately excludes `partners.contact_person`/`phone`/`whatsapp`/`city`/`internal_notes`; `PublicEventConfig` and `canonicalRecordToWeddingTemplateRenderRow()` now carry/accept it. The one shared `renderEvent()` (`src/lib/weddingTemplateRenderer.ts`, imported unchanged by the public Worker — no duplicate renderer) now threads the ordered list into `window.WEDDING_CONFIG.eventCredits`, and a new `primaryPublicEventCreditToPhotographerRow()` adapter reuses the existing legacy footer studio-name/logo slot for the primary credit instead of redesigning the footer. `GET /api/events/draft/[eventId]/preview` now loads the Draft's current `event_credits`+`partners` server-side, projects them, and passes them into the same shared renderer, so Draft Preview shows the studio's current Event Credits before Publish. `events.published_credits` was **not** populated or frozen, and no Publish action was implemented. Focused tests (`eventContract.test.ts`, `weddingTemplatePreviewRenderer.test.ts`, `events-draft-preview.test.ts`) — **74/74 PASS**; zero TypeScript errors in any file this slice changed. Do not re-audit, re-design, or re-implement this slice.

**The Publish-time `events.published_credits` snapshot freeze is also COMPLETE / PASS (2026-08-10).** New `src/lib/eventCreditsLoader.ts` extracts the Draft Preview route's Event Credit + Partner join query into a shared `loadOwnedEventCreditsWithPartners()` helper (the preview route now imports it, no behavior change). New `src/lib/publishedCreditsSnapshot.ts` implements `freezePublishedEventCredits(db, eventId, studioId)`: proves ownership via the existing `getOwnedEventById` pattern (generic not-found for cross-tenant/nonexistent Events); is **write-once** — an Event whose `published_credits` is already non-null returns `already_frozen` with no further query or write, since the Baseline defines the snapshot only as an invariant of already-published events and does not define repeated-pre-Publish-generation semantics; otherwise loads current Event Credits via the shared loader, projects them through the unchanged `projectPublicEventCredits()`, and writes the result to `published_credits` scoped by both `id` and `studio_id`; freezes a valid empty `[]` for a no-credit Event; fails closed (no write) on a credit-query error; surfaces a database write failure as `write_failed` rather than reporting success; never accepts a client-supplied snapshot. **No route currently invokes this helper** — no Publish action or `page_state` transition was implemented. New `tests/security/publishedCreditsSnapshot.test.ts` — **7/7 PASS**; combined with the unaffected regression suite, **81/81 PASS** overall; zero TypeScript errors in any file this slice changed. **Do not re-audit, re-design, or re-implement this slice.**

**The controlled Public Page Publish action is also COMPLETE / PASS (2026-08-10).** New `POST /api/events/[eventId]/publish`, authenticated through the existing `requireAdmin()` and tenant-ownership pattern (generic `Event not found` 404 for cross-tenant/nonexistent). It is page publishing only and never starts or activates Livestream infrastructure. It loads the Event's current Event Credits server-side via the shared loader, projects them through the existing public-safe `projectPublicEventCredits()`, and writes the frozen `published_credits` snapshot **and** `page_state = 'published'` **together in one** `events` row update scoped by Event id, studio ownership, and expected `page_state = 'draft'` — so the earlier ownership read is not the only concurrency protection, and the previously recorded freeze/transition atomicity risk is resolved. The route deliberately does **not** call the standalone `freezePublishedEventCredits()` helper; that helper remains a separate completed capability and is not the Publish transaction. A no-credit Event publishes with `published_credits = []`; a credit-query failure fails closed before any write; a database update failure is surfaced and never reported as success; a Draft that already carries a non-null snapshot fails closed with a conflict instead of being silently overwritten or published; an already-published/non-Draft Event cannot be republished; a request that loses a concurrent Publish race cannot overwrite the winning row; and the request body never controls the stored snapshot. The Admin Overview page gained the minimal controlled **Publish page** action for Drafts, which afterward reflects Published state without implying that a livestream started.

**Frozen-credit public rendering and the public `page_state` gate are part of that same completed slice.** `workers/render-event-page/src/index.ts` now renders a published page's Event Credits from the Event row's own frozen `events.published_credits` snapshot rather than querying mutable Partner/Event Credit data, with the primary frozen credit reusing the existing single footer slot through the already-established shared renderer/adapter (no second renderer, no second credit surface). The same task also corrected a publish-gating defect: because the Worker reads with the service-role key it bypasses the anonymous `events_public_select_policy` installed by migration `0029`, so `page_state=eq.published` was added to **both** public Event lookup paths (primary slug lookup and hyphenated-slug fallback), with `event_visibility = public` and `archived_at IS NULL` left intact. A Draft can therefore no longer be rendered publicly merely because its legacy `event_visibility` value is already `public`; a published Event remains renderable only when the existing visibility/archive requirements also pass. This gate is page availability only and stays completely separate from Livestream start/activation. Validation: Publish-focused admin set **94/94 PASS** across five files (13 new Publish cases), Worker focused source-contract tests **12/12 PASS**, `npx tsc --noEmit` clean in `workers/render-event-page`, and no file changed by the task appearing in the repository-wide `eventcast-admin` `tsc` output (which remains non-zero only from pre-existing unrelated errors). No browser/live-Supabase Publish verification was performed. **Do not re-audit, re-design, or re-implement any of this.**

**Partner authorization alignment is also COMPLETE / PASS (2026-08-10).** While scoping the standalone Partner Directory UI, a real intra-studio privilege-separation gap was found: `member_role_enum` (migration `0001`) contains `owner`/`admin`/`member`, and migration `0030` intentionally restricts Partner INSERT/UPDATE/DELETE to `owner`/`admin` while allowing any studio member to read — but `requireAdmin()` never carried `studio_members.role`, and the Partner API's `supabaseAdmin` service-role client bypasses RLS, so a `member`-role user could structurally mutate Partners through the API. **This was an intra-studio privilege-separation gap only, not a cross-tenant leak** — tenant isolation via `auth.studioId` was and remains unaffected. The correction threaded sanitized `studioMemberRole` through `requireAdmin()` → `GET /api/auth/context` → the Admin V2 client `AdminAuthContextValue`, and added a `canMutateStudioResources(role)` predicate that all three Partner mutation routes now call before any ownership lookup, returning 403 for `member`. No Super Admin compatibility issue arose (`requireAdmin()` already required a `studio_members` row, and `role` is `NOT NULL DEFAULT 'admin'`). Validation: Partner/Auth focused tests **38/38 PASS**, adjacent suites consuming shared `requireAdmin()` **78/78 PASS**, no changed file in the `tsc` error output. **Do not re-audit, re-design, or re-implement this.**

**The standalone Partner Directory management UI is also COMPLETE / PASS (2026-08-10).** New account-level `/partners` route (`src/app/(admin-v2)/partners/page.tsx`) and `PartnerDirectory` component, plus a "Partners and Clients" navigation entry, built entirely on the existing Partner CRUD API and the authorization alignment above (neither modified). Every studio member can view/search/filter; `owner`/`admin` get Create/Edit/Delete, `member` sees the same directory read-only with an explanatory note (unknown roles fail closed to read-only) — reflecting, not replacing, the server-side enforcement. The complete schema-backed field set is supported, with `internalNotes` clearly labelled private/internal (never claimed public) and `logoUrl` handled as a plain hosted-logo URL text field only (no upload pipeline, no `/api/r2-upload` change). The API's 409 "still credited on an event" delete conflict is surfaced verbatim. Editing a Partner here changes the reusable master record only and never retroactively alters an already-published frozen Event Credit snapshot. `src/lib/partnerCreditClient.ts` was reused, with only the missing update/delete/serialization/role-predicate helpers added to it — no second Partner client layer or data model. Validation: `partnerCreditClient.test.ts` **30/30 PASS**, focused Partner/Auth regression set **68/68 PASS**, no Partner Directory file in the `tsc` error output. No browser/live authenticated verification was performed (would require credential access outside scope). **Do not re-audit, re-design, or re-implement this.**

**The entire Partner / Client / Event Credit workstream (Baseline V2.1 §13, PART-001 through PART-008) is now fully COMPLETE / PASS**, including standalone Partner Directory management. **Public / Unlisted Page Visibility has since also reached live COMPLETE / PASS (2026-08-11)** — see "Completed Delivery Package — Public / Unlisted Page Visibility" below. The remaining Baseline V2.1 sequence — Optional Modules, Event Workspace expansion, and later parked Livestream work — is grouped into delivery packages in `IMPLEMENTATION_ROADMAP.md`; the current one is Event Workspace + lifecycle foundation. See "Current Delivery Package — Event Workspace + Lifecycle Foundation" below.

**Separately flagged, unresolved security finding (not fixed, not part of the above work):** the legacy `photographers` table carries two undocumented live RLS policies not present in any tracked migration — `Admin full access on photographers` (ALL, any authenticated user regardless of studio) and `Public can view photographers` (SELECT, unrestricted/anonymous). This is a real cross-tenant/public-exposure gap requiring its own dedicated task; it was deliberately left untouched during the Partner/Event Credit schema work since it's outside that bounded scope.

## Important Later User Decision

Active Restreamer provisioning was removed from the shared event-generation route.

The user explicitly decided to keep it removed.

Do not restore active Restreamer provisioning.

Legacy Restreamer columns may remain until later cleanup.

## Parked Work

Do not resume yet:

- preliminary `/livestreams`
- `_lib/livestreams.ts`
- assignment-status provider bridge and its tests
- preliminary `/events` list
- preliminary production-oriented `/events/new` wizard

These are retained, not deleted.

## Why `/events/new` Is Parked

The preliminary V2 wizard is not a true Draft flow.

It uses legacy production-oriented behavior capable of:

- wallet debit
- YouTube creation
- media upload
- public event visibility

The authoritative Draft Foundation requires none of those side effects.

## Current Canonical Contract Milestone

`src/lib/eventContract.ts` now contains:

- legacy compatibility section
- EventDraftInput
- CanonicalEventRecord
- PublicEventConfig
- authoritative `scheduled_start_at`
- Asia/Kolkata schedule conversion
- legacy schedule derivation
- `template_version`
- separate `pageState` / `visibility`
- no-silent-template-fallback mapping

Local migration:

`eventcast-admin/supabase/migrations/0029_draft_event_foundation_schema.sql`

proposes:

- `scheduled_start_at`
- `template_version`
- `page_state`
- narrow public SELECT policy gating to `page_state = 'published'`

Migration is applied (2026-08-10) and post-apply verified: all three columns present, `page_state` `NOT NULL DEFAULT 'published'` with the `draft|published` CHECK, `events_public_select_policy` now requires `page_state = 'published'`, policy count still 5, and all 37 existing rows remained published (0 draft).

## Draft Foundation Gate — CLOSED (2026-08-09)

Approved by explicit user decision:

- `wedding-template-01` is confirmed as the implementation ID for TLF-001 for this project. (Repository evidence alone was inconclusive — the literal string "TLF-001" appears nowhere in code — but `wedding-template-01` is the sole registered/default wedding template in the render worker. The user has settled this by explicit decision; do not re-litigate it.)
- Migration `0029` is accepted as-is (no SQL change required). **Applied 2026-08-10; post-apply verification passed.**
- `CanonicalEventRecord.visibility` stays in the contract but must **not** be persisted as `'unlisted'` in this Draft-only Phase 1 slice — no DB column backs it yet. `page_state = 'draft'` is the Draft non-public safety mechanism for this slice.

## Exact Next Task

Do not jump to Livestreams.

**Phase 1 — Draft Event Foundation is COMPLETE / PASS (2026-08-10).** `/events/new` and `/events/[eventId]/overview` post to `POST /api/events/draft` and `GET`/`PATCH /api/events/draft/[eventId]` (tenant-owned, `page_state: 'draft'`, no billing/YouTube/media/SRS/Restreamer side effects), and this has now been validated end-to-end against the real, migration-`0029`-applied database, including cross-tenant isolation. **Do not re-audit or re-validate Phase 1.** See `CURRENT_STATE.md` for full evidence.

**Within the same post-Draft Baseline V2.1 workstream, Canonical TLF-001 Preview and SEO thumbnail capability (including manual thumbnail upload/assignment) are also COMPLETE / PASS (2026-08-10), the Partner / Event Credit foundational schema (migration `0030`, applied and post-apply verified) is COMPLETE / PASS (2026-08-10), the Partner CRUD API (`GET/POST/PATCH/DELETE /api/partners`, tenant-ownership enforced, 16/16 focused security tests) is COMPLETE / PASS (2026-08-10), the Event Credit attach/update/detach API (`GET/POST /api/events/[eventId]/credits`, `PATCH/DELETE /api/events/[eventId]/credits/[creditId]`, Event + Partner + Credit tenant ownership enforced, 23/23 focused security tests) is COMPLETE / PASS (2026-08-10), the Create/Edit Event Partner Credit integration UI (Partner search/select, inline Partner creation, primary/additional Event Credit assignment in `/events/new` and `/events/[eventId]/overview`, 16/16 focused unit tests) is COMPLETE / PASS (2026-08-10), the canonical/public Event Credit projection + shared renderer/public footer wiring (public-safe projection in `eventContract.ts`, `eventCredits` threaded through the shared `weddingTemplateRenderer.ts`, Draft Preview hydration, primary credit reusing the existing footer slot, 74/74 focused tests) is COMPLETE / PASS (2026-08-10), and the Publish-time `events.published_credits` snapshot freeze (`freezePublishedEventCredits()` in `src/lib/publishedCreditsSnapshot.ts`, write-once, reuses `projectPublicEventCredits()` unchanged, 7/7 focused tests, not yet invoked by any route) is now also COMPLETE / PASS (2026-08-10). Do not re-audit, re-validate, re-design, re-apply, or re-implement any of that work.**

**The controlled Public Page Publish slice is COMPLETE / PASS**, including frozen-credit consumption in the public Worker and the Worker's explicit `page_state = 'published'` public-delivery gate. Do not re-implement, re-audit, or re-validate it, and do not re-open the snapshot-freeze work.

**The complete Partner/Event Credit path is now COMPLETE / PASS end to end (2026-08-10)**, and none of it should be re-audited or reimplemented: schema (migration `0030`), Partner CRUD API, Event Credit APIs, Create/Edit Event Partner Credit integration UI, canonical/public Event Credit projection, Publish-time snapshot freeze, the controlled Public Page Publish action, frozen-credit consumption in the public Worker, the Worker's `page_state = 'published'` gate, server-side Partner mutation enforcement (`owner`/`admin` may mutate, `member` is read-only, via `studioMemberRole` threaded through `requireAdmin()` → `/api/auth/context` → the Admin V2 client context), and the standalone Partner Directory management UI at `/partners`.

**Superseded (2026-08-11):** the paragraph that previously stood here said the next slice "has not been selected" and asked a fresh session to run a narrow Baseline continuation read to pick one. That step happened in-session: the selected package is **Public / Unlisted Page Visibility**, and it is documented factually below.

## Completed Delivery Package — Public / Unlisted Page Visibility (2026-08-11)

Per the Execution Rule above, this was **one coherent feature package**, not several slices, and it is now **fully COMPLETE / PASS — live-complete, not just locally implemented**:

- Canonical `event_visibility` widened to add `unlisted` alongside the legacy `public`/`private`/`synthetic` values — migration `eventcast-admin/supabase/migrations/0031_event_visibility_unlisted_value.sql`, **applied to the linked Supabase project and post-apply verified (2026-08-11)**.
- The five guest-engagement child-table RLS policies (`wishes_insert_policy`, `wishes_select_policy`, `page_views_insert_policy`, `guest_photos_public_insert`, `guest_photos_public_select`) plus the `guest-photos/upload` route's own application-level check corrected so a Published + Unlisted event gets the same Wishes/Guest Photos/page-view behavior as Published + Public — migration `eventcast-admin/supabase/migrations/0032_visibility_child_policy_unlisted_eligibility.sql`, **applied to the linked Supabase project and post-apply verified (2026-08-11)**.
- The public render Worker (`workers/render-event-page/src/index.ts`) widened to serve Published + Unlisted by exact direct-link slug lookup, with `X-Robots-Tag: noindex` set only on Unlisted responses.
- Publish requires an explicit Public/Unlisted choice, written atomically with the credit snapshot and `page_state = 'published'` in the same guarded row update.
- A post-Publish visibility-switch endpoint/UI lets a Published event move Public ⇄ Unlisted without touching its frozen Event Credit snapshot.
- The anonymous `events_public_select_policy` was deliberately left **Public-only and unwidened** throughout — confirmed unchanged by post-apply verification. Unlisted delivery is Worker-only, never anonymously enumerable through a direct Supabase query.

Validation: full repository Vitest **624/624 passed**; no new TypeScript errors in any changed file. Migration application: both migrations reviewed for pre-apply readiness, dry-run confirmed as the sole pending pair in the correct order, applied via `supabase db push --linked --yes` on explicit user approval, and post-apply read-only verified — migration history aligned local/remote through `0032`; `events_event_visibility_check` allows exactly `public`/`private`/`synthetic`/`unlisted`; `events_public_select_policy` confirmed still Public-only and unchanged; all five child policies confirmed widened as designed with `guest_photos_public_select`'s `approved = true` intact; no discrepancy found.

**Do not re-audit, re-design, re-apply, or re-implement any of this.** See `CURRENT_STATE.md` and `WORKLOG.md` for full evidence.

This excludes the separately flagged legacy `photographers` RLS exposure (`Admin full access on photographers`, `Public can view photographers`), which remains unresolved and needs its own dedicated task, and does not automatically resume parked Livestream work ahead of its package.

## Completed Delivery Package — Event Workspace + Lifecycle Foundation (2026-08-11)

**COMPLETE / PASS, local implementation only — no remote/database action was required.** Route-based Event Workspace (`/events/[eventId]/{overview,event-page,live,media,engagement,analytics,settings}`) built around real event UUID identity, with a shared `EventWorkspaceShell`/`layout.tsx` and a new pure `deriveEventLifecycleStatus()` helper (`src/lib/eventLifecycle.ts`) deriving Draft/Upcoming/Published/Archived from `page_state`, `archived_at`, and `scheduled_start_at` — the existing schema already sufficed, so **migration `0033` was not created**. The Milestone D Overview page moved unchanged to the Event Page tab (Draft edit, Preview, Publish, visibility switch, SEO thumbnail, Partner/Event Credit management — none of its contracts, APIs, or security model touched); the new lean Overview tab shows facts and tab links; Live/Media/Engagement/Analytics are real routes that honestly state their capability (Milestones H/I/J) isn't implemented yet, with no fabricated data; Settings integrates the existing archive/restore endpoints. The parked preliminary `/events` list was replaced with the authoritative Provider Events surface (Draft/Upcoming/Published/Archived tabs using the same lifecycle helper).

Validation: full repository Vitest **632/632 passed** (624 pre-existing + 8 new lifecycle tests); no new TypeScript errors in any changed file. No browser/live-authenticated verification was performed (requires a real Supabase session, outside this bounded task's scope). See `CURRENT_STATE.md` and `WORKLOG.md` for full evidence.

**Do not re-audit, re-design, or re-implement any of this.**

## Completed Delivery Package — Media + Engagement Core (2026-08-11)

**COMPLETE / PASS.** Milestone I — the global Media Library (`/media`), the Event Workspace Media tab (Invitation Video, Photo Slideshow), Guest Memories moderation (Manual Approval toggle, approve/hide/delete), and Wishes moderation (approve/pin/hide/reject/delete) — is done. Invitation Video and Photo Slideshow reused existing, previously-unwired `events.invitation_video_url`/`events.gallery_urls` columns already read by the shared renderer — no schema or public Worker change was needed for either. Guest Memories reused the existing `guest_photos` table and `events.guest_photo_moderation` column; a real defect (guest uploads always inserting `approved: true`, ignoring the moderation toggle) was found and fixed in the same package.

One minimal additive migration was required — `eventcast-admin/supabase/migrations/0033_wishes_moderation_schema.sql` (`wishes.status`, `wishes.is_pinned`, a `wishes_select_policy` narrowed to `status = 'approved'` while every pre-existing condition stayed unchanged). It was reviewed, applied to the linked Supabase project via `supabase db push --linked --yes` on explicit user approval, and post-apply read-only verified with no discrepancy — migration history aligned through `0033`, both columns present with the intended type/nullability/default, the CHECK constraint allows exactly `approved`/`hidden`/`rejected`, and `wishes_insert_policy`/`wishes_delete_policy` are confirmed byte-for-byte unchanged.

Validation: new/updated focused suite 69/69 PASS; full repository Vitest 675/675 PASS; `npx tsc --noEmit` remains non-zero only from the same already-documented, unrelated pre-existing errors, with no file this package touched appearing in that output. Full evidence is in `CURRENT_STATE.md` and `WORKLOG.md`. **Do not re-audit, re-design, re-apply, or re-implement any of it.**

## Completed Delivery Package — Livestream + YouTube + Live Control Room (2026-08-11)

**COMPLETE / PASS as far as the current architecture safely allows — local implementation only.** Milestone H, plus the manual-link YouTube destination item from Milestone F's Selective Rebuild list, reused the existing SRS/Media Agent server-side control plane (`ensureDraftAssignment`, `activateAssignment`, `deactivateAssignment`, migrations `0020`/`0024`/`0026`) unchanged, and made it reachable by a real provider action for the first time: `GET/POST/PATCH /api/events/[eventId]/livestream/{status,enable,end,youtube}` (owner/admin-gated mutations, tenant-owned) and a new `GET /api/livestreams` studio roster. The already-complete public Worker HLS delivery path needed **zero changes** — enabling a stream on a Published event is immediately watchable. Test Stream needed **no schema change**: the public Worker already refuses any page/HLS response for a `page_state = 'draft'` event, so enabling while still a Draft is already a fully private test. The Event Workspace Live tab now renders a real `LiveControlRoom` (masked/revealable Stream URL, one-time Stream Key, honest "not yet measured" metrics, YouTube watch-link field, safe End control); the parked `/livestreams` roster now shows real per-event status.

**Remaining hard boundaries, deliberately not crossed in this package:**

- No real SRS/Media Agent activation was performed against the live Linode deployment — only written and unit-tested against mocked control-plane functions.
- OAuth-connected YouTube channels (provider or client) and any real relay via `media_event_assignments.youtube_enabled`/`youtube_secret_reference` are not implemented — no OAuth client credentials, consent flow, or secret-store write path exists anywhere in this repository. Only the manual watch-link model (YTB-003) is implemented.
- No beta-entitlement/billing gate exists on stream enablement — no authoritative schema exists for one, and inventing one would be inventing commercial policy.
- Real stream telemetry (resolution/FPS/bitrate/viewers) and recording state are shown as unmeasured — no authoritative source exists anywhere in the current integration.

Validation: new/updated focused suite 32/32 PASS, directly-related regression suites 30/30 PASS, full repository Vitest 707/707 PASS, `npx tsc --noEmit` clean for every file this package touched. See `CURRENT_STATE.md` and `WORKLOG.md` for full evidence. **Do not re-audit, re-design, or re-implement any of this.**

This excludes the separately flagged legacy `photographers` RLS exposure, which remains its own unresolved, dedicated task.

**Use the Admin Baseline V2.1 phase/workstream structure, organized into the delivery packages in `IMPLEMENTATION_ROADMAP.md`, as the primary planning language rather than new lettered milestones.**

## Safety

No commit, push, deploy, migration application, reset, stash, checkout, secret access/rotation, destructive action, production change, or remote infrastructure modification without explicit approval.

Avoid broad audits.

Use one coherent feature/delivery package at a time (see the Execution Rule at the top of this file) — not one file, route, migration, or test as a separate task.

## New Chat Starter

Use this message in the new session:

“Continue EventCast.pro Admin Panel from the current project-state continuity files (`CURRENT_STATE.md`, `IMPLEMENTATION_ROADMAP.md`, `HANDOFF.md`), treat Admin Baseline V2.1 (`docs/admin-baseline-v2.1/`) as the product/architecture authority, and treat `docs/project-memory/EVENTCAST_ASSISTANT_MEMORY.md` as the durable workflow-rules authority.

**Execution rule (read first): work in coherent feature/delivery packages, not micro-slices.** See `EVENTCAST_ASSISTANT_MEMORY.md` §3 and `IMPLEMENTATION_ROADMAP.md`'s 'Execution Granularity / Delivery Packages' section. Do not split one package's routine reads, schema/migration design, backend/API, UI, Worker integration, directly-related fixes, focused tests, and TypeScript checks into separate tasks, sessions, or continuity updates. Stop only at a hard boundary: an unresolved decision that can't be safely inferred, a remote migration apply/deploy/production mutation, secret access, a destructive action, or a genuinely different workstream.

Phase 1 — Draft Event Foundation, canonical TLF-001 Preview/SEO, the complete Partner/Event Credit path (schema, APIs, UI, projection, snapshot freeze, controlled Publish, Worker consumption, authorization alignment, Partner Directory UI), Public / Unlisted Page Visibility (migrations `0031` and `0032` applied to the linked Supabase project and post-apply verified, Worker Public/Unlisted delivery with `X-Robots-Tag: noindex`, Publish-time visibility choice, post-Publish visibility switching, guest-engagement compatibility), Event Workspace + Lifecycle Foundation (route-based `/events/[eventId]/{overview,event-page,live,media,engagement,analytics,settings}` workspace, `deriveEventLifecycleStatus()` lifecycle helper, no schema change needed, authoritative `/events` list), Media + Engagement Core (migration `0033` applied to the linked Supabase project and post-apply verified, global Media Library, Event Workspace Media/Engagement tabs, Invitation Video, Photo Slideshow, Guest Memories moderation with a real Manual Approval fix, Wishes moderation), and Livestream + YouTube + Live Control Room (Milestone H, as far as the current architecture safely allows: real provider-facing enable/end/status routes and Live Control Room UI reusing the existing SRS/Media Agent control plane unchanged, no schema change, manual-link-only YouTube destination — OAuth channels, real infrastructure activation, a beta-entitlement gate, and real stream telemetry remain explicit unimplemented hard boundaries) are all COMPLETE / PASS and must not be re-audited, re-validated, re-designed, or reimplemented.

**The next delivery package** is chosen from the remaining Baseline V2.1 work per `IMPLEMENTATION_ROADMAP.md`'s "Execution Granularity / Delivery Packages" section: Analytics + Provider operational/support/auth capabilities, or Platform Operations + VOD/Retention + controlled legacy cutover. It has not been started and requires its own fresh bounded-task scoping pass. Implement it as **one coherent feature package**, not split into routine micro-slices, per the Execution Rule above. Separately, if OAuth-connected YouTube channels or real SRS/Media Agent activation are ever taken up, that requires explicit user approval of the exact secret/infrastructure boundary before any code beyond what this package already wrote.

Do not touch the separately flagged legacy `photographers` RLS exposure, which remains its own unresolved, dedicated task.”

The earlier starter message (which asked a fresh session to run a narrow Baseline continuation read to select the next slice) is superseded by the paragraph above: that selection already happened in-session, Public/Unlisted Page Visibility reached live COMPLETE / PASS (2026-08-11), Event Workspace + Lifecycle Foundation and Media + Engagement Core reached COMPLETE / PASS (2026-08-11), and Livestream + YouTube + Live Control Room reached COMPLETE / PASS (2026-08-11, local implementation only, with named hard boundaries). Per-package completion evidence remains in `CURRENT_STATE.md` and `WORKLOG.md`.

**Superseded again (2026-08-12):** the two paragraphs above still frame Analytics + Provider operational/support/auth capabilities as an unstarted choice. It is not — see "Completed Delivery Package — Analytics + Provider Operational/Support/Auth Capabilities (2026-08-12)" below. That package (and the separately CLOSED/PASS Livestream + Media Agent production-acceptance package, also below) are both done. **The next delivery package is now specifically Platform Operations + VOD/Retention + controlled legacy cutover** (Milestones M, N, O) — it has not been started and requires its own fresh bounded-task scoping pass. Real outbound WhatsApp/SMS/email provider integration, real technical stream telemetry, and any further OAuth YouTube/real SRS activation remain separate, unstarted, explicitly-deferred dependencies — not part of that next package by default.

**Superseded a final time (2026-08-14, later):** everything below about a pending Media Agent release/deployment preflight, B2 credential configuration, the connectivity probe, or the checksum decision is now **DONE** — see "Completed Delivery Package — Media Agent B2 Production Rollout / Archival Acceptance (2026-08-14)". A fresh session must **not** reopen Media Agent releases v1.0.6–v1.0.9, the release-evidence backfill, the `b2-connectivity` probe, the provider-checksum selection, the `strong_verified` correction, production archival enablement, or the clean-event archival acceptance. Production runs **v1.0.9** with **B2 archival ENABLED** and integrity mode **`provider_checksum`**. The next work is the **remaining Milestone N VOD lifecycle items** (B2 playback delivery, R2 cleanup after B2 authority, replay-expiry/YouTube fallback, remaining retention lifecycle), then Milestone M, then Milestone O.

**Superseded again (2026-08-14):** the paragraph above still frames "Platform Operations + VOD/Retention + controlled legacy cutover" as entirely unstarted. Part of it is now done — see "Completed Delivery Package — B2 VOD Foundation: Implementation, Migrations `0035`/`0036`, Source Control, Linux CI, Cloudflare Admin Deploy (2026-08-14)" below, and do not reopen migrations `0035`/`0036` or the B2 architecture they establish. Commit `e1156c8754be2f30d0560baf20322623abdde725` on `main` and GitHub Actions run `31730804068` are PASS evidence for the Media Agent B2 archival implementation and its Linux/race validation; both connected Cloudflare Pages projects (`eventcast-admin`, `eventcast-pro`) deployed that same commit successfully. **Media Agent production still runs the pre-B2 deployment** — no release, no image publish, and no production deployment happened in that package, and B2 archival must remain OFF through the first new Media Agent production deployment that eventually does ship this code. **The next task is a READ-ONLY Media Agent release/deployment preflight — Media Agent B2 Foundation Release / Deployment Preflight** (see the dedicated section below for the exact 10-step sequence). It has not been started. The Super Admin Operations Console (Milestone M) and the legacy cutover (Milestone O) also remain entirely unstarted and are not part of that preflight.

## Completed Delivery Package — Livestream + Media Agent Production-Acceptance (2026-08-12) — CLOSED

**This closes the one explicit hard boundary named in the 2026-08-11 Livestream + YouTube + Live Control Room package: real SRS/Media Agent activation against the live Linode deployment.** It is Media Agent Go-service/infrastructure work (`livestream-infra/services/media-agent`), not further `eventcast-admin` application work, and is scoped to validation event `b68d4796-e234-42af-9efc-39576125e9a0` only.

Real T1 production testing (prior session) proved the Media Agent v1.0.5 session/segment playback-pinning fix works, and separately exposed a directly related defect: `GetAssignmentByEventID` used an unordered `WHERE event_id = ? LIMIT 1` query, so live manifest generation could resolve to a stale historical playback identity even while the session's own segments correctly used the current one. Fixed in commit `d11f1d5` (deterministic selector: `source='controlplane'` first, then highest `config_version`, then `updated_at DESC`; the ingest-specific `GetAssignment`/SRS `on_publish` path is unchanged) — Linux CI run `31569921636` passed all 7 jobs.

Before releasing, a release-evidence gap was found and corrected: the committed evidence chain had stalled at v1.0.1 while GHCR held tagged v1.0.2–v1.0.5; v1.0.2–v1.0.4 turned out to be **failed** release-workflow runs (each failed the workflow's own post-publish verification, fixed in the next commit) and are correctly **not** represented as certified releases — only v1.0.5's genuinely complete run was backfilled (commit `dccb03c`, pushed to `origin/main`).

Media Agent **v1.0.6** was released (workflow run `31572334054`, immutable image `ghcr.io/renugopal/eventcast-media-agent-private@sha256:d0e8a63d146c44d848d27253a852d563d94dc11235e84134024aa24e1765da97`) and deployed to production node `eventcast-media-node-akm-01` via the existing `deploy.sh --apply`. Only the Media Agent container was recreated — SRS's `StartedAt` (`2026-07-26T17:26:21.897804548Z`) stayed byte-identical throughout the entire package, proving it was never touched.

A real controlled A→B playback-identity rotation on the validation event (via the existing `regression-activate-b68d4796.ts`/`regression-deactivate-b68d4796.ts` control-plane wrappers, one-time credentials handled via clipboard only, never printed) then proved the fix: **32/32** new live-manifest generations across the A and B windows resolved to whichever playback identity was actually active, zero under the stale historical identity `899c0bc8…b026`. Segment pinning also held throughout (confirmed segment counts increasing, one playback prefix, zero mismatched keys, in both windows). Final state: OBS stopped, the B assignment disabled via the same established path, no live session remains, Media Agent healthy on the v1.0.6 digest, SRS healthy and untouched. Rollback target preserved: `ghcr.io/renugopal/eventcast-media-agent-private@sha256:a9738d97cec7defc979cb04d44d9e09d011da3dcdea26e07aef4b52e6a90253e` (v1.0.1).

Full evidence is in `CURRENT_STATE.md` and `WORKLOG.md`. **Do not re-audit, re-deploy, or re-run this regression.** This package did not touch OAuth-connected YouTube channels, a billing/entitlement gate, real stream telemetry, or VOD/Retention — those remain separately scoped, unstarted hard boundaries.

**Livestream + Media Agent production-acceptance package: CLOSED / PASS.** It was not reopened by the package below.

## Completed Delivery Package — Analytics + Provider Operational/Support/Auth Capabilities (2026-08-12)

**COMPLETE / PASS for its approved, provider-independent scope.** Migration `eventcast-admin/supabase/migrations/0034_analytics_support_auth_foundation.sql` — nullable `page_views.visitor_id`; the guarded EventCast audience-heartbeat foundation (write path is the database RPC `record_event_audience_heartbeat` only, server-side playback eligibility re-checked per call, server-computed 20-second buckets, no direct anonymous heartbeat table INSERT); Support Tickets/messages; the in-app Notifications foundation — **applied to the linked Supabase project and post-apply verified.**

Real Event-page Analytics, Provider `/analytics`, Event Workspace Analytics, Support, an Urgent Live Support entry point, in-app Notifications, and phone-first Supabase Auth preparation were implemented. Supabase Auth remains the sole verification/session authority — no second, EventCast-owned `phone_verified` authority exists. Heartbeat evidence is source-separated by construction: the RPC is called only from `wedding-template-01/script.js`'s native EventCast HLS `<video id="hls-video">` element's own `playing`/`pause`/`ended`/`waiting` events, never from the YouTube IFrame API path (structurally unreachable for the same event when an HLS source is configured) and never from the separate Supabase Realtime page-presence widget.

**Runtime deployment, this session.** The approved `wedding-template-01/script.js` (containing `ec_visitor_id` instrumentation and the heartbeat RPC call) was uploaded to the confirmed live R2 object key `wedding-template-01/script.js`, publicly verified byte-identical to the repository source at SHA-256 `3c5a915ce809f542c9849b393abd7b7cff00af0ec3e955e4f835e730e9412aba`. The Worker template's script cache-busting query was advanced to `?v=20260812a`. A deliberate Worker catch-up deployment (new active version `c7fe3816-dd70-4a25-a74b-9acbfa551279`) shipped that reference together with the already-completed-but-previously-undeployed Published Credits snapshot rendering and Public/Unlisted delivery + `X-Robots-Tag: noindex` behavior, on top of the unchanged already-live HLS/`MEDIA_R2` path.

**Validation.** Full repository Vitest **776/776 PASS**; targeted Worker catch-up validation **47/47 PASS**; Worker `npx tsc --noEmit` clean.

**Deferred, unstarted external-provider/telemetry boundaries — separate future dependencies, not failures of this package:** real outbound WhatsApp OTP/alerts, SMS fallback, and application-level email alerts (no credentialed provider integration exists); technical stream metrics (resolution/FPS/bitrate/codecs/reconnects/source-relay health — no authoritative telemetry source exists, unchanged from Milestone H).

**Production verification, bounded.** Confirmed live: the Public event route renders through the new Worker version; `?v=20260812a` is served; the served script digest matches the approved source; heartbeat/visitor-id markers are present; `ec_visitor_id` instrumentation executes in a real browser session. Two gaps, both explicitly non-failure: live `X-Robots-Tag: noindex` was not exercised against a real Published+Unlisted event (none existed without creating production data — not created); live heartbeat emission during genuine playback was not exercised (no genuinely-playing stream was available without reopening the CLOSED/PASS Livestream + Media Agent production-acceptance package — not reopened). Both remain covered by passing source-level contract tests. A pre-existing, unrelated VOD CORS failure was observed on event `chinna-eswari-wedding` during verification — not caused by and not fixed by this package; no VOD work was started.

**Do not re-audit, re-design, re-deploy, or re-implement any of this.** See `CURRENT_STATE.md` and `WORKLOG.md` for full evidence. This package did not touch OAuth YouTube, real outbound provider credentials, technical telemetry, billing/entitlement, VOD/Retention, Super Admin Operations, or the legacy `photographers` RLS exposure — those remain separately scoped, unstarted.

**Analytics + Provider operational/support/auth capabilities package: COMPLETE / PASS.** The next project action is **Platform Operations + VOD/Retention + controlled legacy cutover** (Milestones M, N, and O — see `IMPLEMENTATION_ROADMAP.md`'s "Execution Granularity / Delivery Packages" section) in a new bounded package. Remaining unstarted, separately-scoped dependencies not folded into that package: real outbound WhatsApp/SMS/email provider integration, real technical stream telemetry, OAuth-connected YouTube channels/further real SRS activation, and the legacy `photographers` RLS exposure.

## Completed Delivery Package — B2 VOD Foundation: Implementation, Migrations `0035`/`0036`, Source Control, Linux CI, Cloudflare Admin Deploy (2026-08-14)

**Do not reopen migrations `0035`/`0036` or the B2 architecture — both are done and verified.** This package is the DB-foundation/local-implementation/source-control/CI/admin-deploy slice of Milestone N (VOD / Retention Lifecycle); it is **not** Milestone M (Super Admin Operations Console, still PENDING), and it deliberately stops **before** any production Media Agent rollout or B2 credential configuration.

**What is done and verified — do not re-audit:**

- **Migration `0035_platform_operations_vod_retention_foundation.sql`** was already applied/verified before this package and was not reopened.
- **Migration `0036_event_recording_transition_rpc.sql` is APPLIED / VERIFIED — PASS.** Reviewed against the live database (including a mechanical live-vs-migration diff of `activate_media_event_assignment` proving production behavior was preserved with only the designed additive activation-history `INSERT`), applied, and post-apply verified: `media_event_assignment_activations` is live, append-only, `NOT NULL` on `ingest_id`/`playback_id`, zero backfill, RLS enabled with zero ordinary-user policies, `service_role` narrow; `event_recordings` gained the approved generation/gap fields; `apply_event_recording_transition` is live via a narrow SECURITY DEFINER RPC with server-owned retention timestamps; `freeze_event_retention()` remains the sole retention-freeze authority.
- **A real correctness bug was found and repaired**, scoped to two files: `nodeHasEventActivation()` (`eventcast-admin/src/lib/media-agent/nodeAssignmentsRepo.ts`) used `.maybeSingle()` against a table `0036` deliberately makes append-only (multiple rows per node/event pair are valid after reactivation); fixed to a bounded existence check, with regression coverage in `tests/security/media-agent-recording-report-route.test.ts` proving multiple same-node activation rows still authorize and a query error still fails closed.
- **The Media Agent B2 archival subsystem is implemented locally** (`livestream-infra/services/media-agent`): sole-authoritative-writer archival, `.ts` + rebuilt `.m3u8` format, content-addressed keys, generation fingerprinting, an async/restart-safe worker, `B2Configured`/`B2ArchivalEnabled` kept separate, production archival **OFF by default**, and a spool-retention gate that fails closed once B2 work has begun on an event.
- **Commit `e1156c8754be2f30d0560baf20322623abdde725` on `main` and GitHub Actions run `31730804068` are PASS evidence.** The 52-file commit (machine-verified scope, unrelated working-tree changes deliberately excluded) passed every Linux CI job, including `go test -race` — this closes the previously open Windows-local race/Linux-validation gap.
- **Cloudflare Pages deploy is PASS.** The same pushed SHA deployed successfully through the confirmed-current Cloudflare Pages Git integration: `Cloudflare Pages: eventcast-admin` and `Cloudflare Pages: eventcast-pro` both succeeded. Historical Vercel deployment records exist but are stale/legacy — Vercel is **not** the current hosting path; do not describe it as such.

**What is explicitly NOT done — this is the boundary the next session must respect:**

- **Media Agent production still runs the pre-B2 deployment.** No release workflow (`media-agent-release.yml`) has been triggered for this package; no new Media Agent image has been published to GHCR; no production Media Agent restart or deployment has occurred.
- No B2 credentials have been configured on the production node, and none were read or printed through any chat session.
- `EVENTCAST_B2_ARCHIVE_ENABLED` has not been enabled anywhere.
- No real Backblaze `_connectivity-test/...` probe has run.
- No decision has been made on whether strong integrity verification uses Backblaze `ChecksumSHA256` or a byte-level GET/read-back fallback.
- No R2 cleanup, no B2 playback-delivery path, and no legacy cutover (Milestone O) has occurred.

**The next task is a READ-ONLY Media Agent release/deployment preflight**, starting in a fresh session: **Media Agent B2 Foundation Release / Deployment Preflight**. Sequence (each step its own approval boundary, do not combine them): (1) establish the current production Media Agent image/version/digest and rollback target, read-only; (2) determine the exact next release version and workflow inputs; (3) explicitly approve and run the release workflow; (4) deploy the new image to production **with B2 archival still OFF**; (5) verify normal production health and unchanged existing RTMP → SRS → HLS → R2 behavior; (6) only then configure B2 credentials manually on the node, archival still OFF; (7) run the isolated connectivity probe; (8) determine whether Backblaze enforces `ChecksumSHA256`; (9) decide the strong-verification mechanism; (10) only then consider enabling production B2 archival. **B2 archival must remain OFF through the first new Media Agent production deployment** — enabling it is a separate, later approval, not part of the preflight or the release/deploy step.

See `CURRENT_STATE.md` and `WORKLOG.md` for the full evidence trail (pre-apply migration review, live-vs-`0036` catalog comparison, activation-repair regression tests, source-control scoping methodology, Linux CI and Cloudflare observation).

**Superseded again (2026-08-14):** the paragraph above states that the next task is a READ-ONLY Media Agent release/deployment preflight and that production still runs the pre-B2 deployment. **That is no longer true — the entire ten-step sequence is done.** See "Completed Delivery Package — Media Agent B2 Production Rollout / Archival Acceptance (2026-08-14)" below.

## Completed Delivery Package — Media Agent B2 Production Rollout / Archival Acceptance (2026-08-14)

**COMPLETE / PASS. Do not reopen any part of this.** Specifically, do **not** re-run or re-audit: Media Agent releases **v1.0.6, v1.0.7, v1.0.8, or v1.0.9**; the release-evidence backfill; the isolated `b2-connectivity` probe; the provider-checksum decision; the `strong_verified` propagation correction; production archival enablement; the two contaminated historical acceptance attempts; or the final clean-event archival acceptance.

**Production now runs Media Agent v1.0.9** at `ghcr.io/renugopal/eventcast-media-agent-private@sha256:f4132e5e62b6757a2338c803a49f38efb145f88f1072577d5f7feb32d95dc182` (tag `v1.0.9-3119ee69c14e`, source `3119ee69c14eb915bed60cdff20da8e6def4d585`), healthy, `RestartCount=0`, `OOMKilled=false`, `/readyz=200`. **B2 archival is ENABLED** with `EVENTCAST_B2_INTEGRITY_MODE=provider_checksum` against bucket `eventcast-vod-prod`. SRS was never recreated — `StartedAt` remains `2026-07-26T17:26:21.897804548Z`.

**Backblaze server-side SHA-256 enforcement is proven**, not assumed: the probe returned `checksum_accepted=true` **and** `corrupt_checksum_rejected=true`. Acceptance alone would not have distinguished enforcement from a silently ignored header. That settled the previously open `ChecksumSHA256`-vs-read-back question in favour of `provider_checksum`; `read_back` remains implemented as a fallback.

**Two defects were found and corrected inside this package** (do not re-derive them): the connectivity probe had no production invocation path, so a narrow `b2-connectivity` subcommand was added reusing the existing implementation; and `strong_verified` could never become 1, which would have made integrity grant and retention freeze structurally unreachable — corrected in commit `3119ee69c14e…` and validated by Linux CI including `go test -race`.

**Clean acceptance evidence** on dedicated zero-history synthetic event `dc6bde2d-91dd-410c-aa21-10cc54467c07` (playback `94b5fb4dcfbc32ef81eced2ef4675d2205cac2f8dc04fd603ff4229dc1c87ae4`, single post-`0036` activation on `media-node-staging-02`): `gap_count=0`; B2 archive `archived` with **`strong_verified=1`** and 55 objects; `recording_state='b2_finalized'`; server-generated `b2_finalized_at`, **`integrity_verified_at`**, and **`retention_frozen_at`** (90-day retention, expiring 2026-11-12); spool-release gate conditions satisfied with segments correctly retained pending the 24-hour local-retention delay. Nothing was manually mutated, no gaps were acknowledged, and `freeze_event_retention()` was never called by hand.

**Bounded historical limitation — record, do not "fix" casually.** Two pre-existing synthetic events are permanently unsuitable for acceptance and must not be reused: `b68d4796-e234-42af-9efc-39576125e9a0` (sessions predating migration `0004` with empty `playback_id`, so `CoveredPlaybackIDs` fails closed and B2 enqueue refuses) and `f097036e-e02e-4554-992a-b4c66e863a09` (7 legacy `missing` segments producing `gap_count=7`/`pending_review`, so the RPC correctly withholds integrity and retention). Generalised: any event containing pre-`0004` empty-`playback_id` sessions or unresolved legacy missing segments may fail closed from authoritative B2 archival or integrity/retention promotion. **This is the designed protection, not a production B2 failure**, and events created after playback pinning are unaffected. Any historical remediation is a separate, unscheduled decision.

**Remaining Milestone N work (not started):** B2 playback delivery, R2 cleanup once B2 is authoritative, replay-expiry/verified YouTube fallback, and remaining retention lifecycle work. Milestone M (Super Admin Operations Console) and Milestone O (legacy cutover) remain unstarted.

Continuity-file edits from this package were **not** committed or pushed.
