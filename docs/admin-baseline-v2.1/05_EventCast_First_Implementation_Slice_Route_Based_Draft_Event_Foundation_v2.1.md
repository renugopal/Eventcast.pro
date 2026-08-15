# EventCast.pro - First Implementation Slice

## Route-Based Draft Event Foundation

**Baseline:** Version 2.1  
**Status:** Accepted scope; not execution authorization  
**Target application:** Existing `eventcast-admin` Next.js App Router and TypeScript application

## 1. Goal

A normal authorized test-studio owner or admin can open a real Create Event route, create a tenant-owned Wedding Draft using the verified TLF-001 template and core details, land on a minimal event-scoped Overview route, reopen the Draft later, edit it, and save it without triggering billing, Restreamer, SRS, YouTube, public publishing, or media actions.

## 2. Why this is first

The current app has no route-based Event Workspace, no Draft state, three competing payload builders, and an unwired event contract. Every later surface depends on a trustworthy event identity and persistence path. Building Live Control Room, Media, Analytics, or Super Admin first would attach new work to an unstable event model.

## 3. Positive scope

The slice introduces a real `/events/new` route and a minimal `/events/[eventId]/overview` route within the existing Next.js application. It creates the minimum provider layout and event context required for these routes without rebuilding the entire dashboard navigation.

The Create Event route supports the Wedding event type and the verified TLF-001 canonical template identity. Unsupported event types and templates are not silently mapped; they are omitted, disabled with an honest message, or rejected by server validation.

The form captures groom name, bride name, event date, scheduled time, venue, editable tenant-scoped slug, selected template and version, and the minimum internal fields needed by the live schema. Asia/Kolkata is fixed. The implementation writes one canonical scheduled timestamp and may mirror existing date, time, and countdown fields for compatibility.

The existing `eventContract.ts` is reviewed and revised into the single contract used by the new form and server path. A competing new contract is not introduced.

The event is inserted as a non-public Draft owned by the authenticated studio. The minimal Overview shows event identity, names, schedule, template, Draft state, and an Edit action. The user can leave, return, reopen, edit, and save the Draft.

Tenant ownership remains enforced through server verification and RLS. Invalid template IDs, incompatible event types, invalid slugs, and unauthorized event IDs fail clearly.

## 4. Minimal schema expectation

The slice may add the minimum additive fields and policy changes required for Draft page state, canonical scheduled timestamp, and template version. It must explicitly prevent a Draft from being returned through the public-event RLS path.

Legacy columns remain for compatibility. Restreamer columns are not dropped. A broad lifecycle schema, full generic participant model, and final Public or Unlisted publishing policy are not required in this slice beyond the minimum Draft safety contract.

## 5. Strict exclusions

This slice does not publish the event page and does not build production preview parity. It does not activate SRS, create a Media Agent assignment beyond any existing harmless disabled behaviour, create or edit Restreamer channels, expose stream credentials, configure YouTube, upload thumbnails or media, manage Wishes or Guest Memories, collect new analytics, perform billing, enforce commercial plans, implement OTP, build Support, build Super Admin, transfer to B2, implement retention, remove GrapesJS, remove Restreamer, or clean customer directories and scratch scripts.

The existing legacy Create Event path remains untouched until the new Draft path is validated and a later replacement task explicitly retires it. The first slice must not create a big-bang navigation rewrite.

## 6. Safety requirements

No repository cleanup, framework migration, dependency upgrade, secret inspection, remote deployment, production data mutation beyond approved test data, commit, push, or migration application occurs without explicit approval.

Any schema migration is drafted and reviewed before it is applied. The active task must state whether a local-only migration file may be created and whether remote application is prohibited until a separate approval.

The implementation must not use the legacy ₹499 debit path. Draft creation and editing perform no wallet transaction.

## 7. Completion evidence

A normal test-studio account can create a Wedding Draft with TLF-001, receive a stable event UUID, see the minimal Overview route, reopen the Draft after navigation or a new session, edit allowed core fields, and save again.

A different studio cannot read or edit the Draft. An invalid template cannot be accepted. The Draft does not appear through the public event lookup. No wallet transaction, Restreamer setup, SRS activation, YouTube action, public deployment, or media upload occurs.

Focused contract, ownership, route, and persistence tests pass. Changed files and exact evidence are reported. The task stops without starting Preview or Publish work.

## 8. Stop condition

Stop as soon as the bounded Draft flow and its focused evidence are complete. Report non-blocking discoveries without fixing them. Do not continue into the second slice.

## 9. Expected next slice after approval

The expected later slice is Template Preview, SEO, Partner Credit, Optional Modules, and Public Page Publish using the canonical renderer. This is context only and is not authorized by the first slice.
