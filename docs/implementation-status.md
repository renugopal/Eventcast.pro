# Implementation Status

Snapshot of where the codebase stands against the target architecture. This is a
living tracker; it records observed state, not aspirations. It changes no code.

Legend: **Done** · **In progress** · **Planned** · **Unverified** ·
**Legacy (to retire)** · **TBD** (needs owner input, not invented here).

## Workspaces / repository layout

| Area | Target | Status | Notes |
| --- | --- | --- | --- |
| npm workspaces root | In-place incremental migration | Planned | Phase 1 in [implementation-plan.md](implementation-plan.md). |
| `packages/event-contract` | Canonical contract package | Planned | Migration input is `eventcast-admin/src/lib/eventContract.ts`. |
| `eventcast-admin` | Admin app (Next.js) | In progress | Present today; hosts the current contract source. |

## Event contract

| Item | Status | Notes |
| --- | --- | --- |
| Contract shapes and helpers | Done (in admin) | Live in `eventcast-admin/src/lib/eventContract.ts`; see [event-contract.md](event-contract.md). |
| Move to `packages/event-contract` | Planned | No behavioural change intended on move. |
| Contract tests | In progress | `eventcast-admin/tests/contract/` exists in the working tree. |

## Tenancy

| Item | Status | Notes |
| --- | --- | --- |
| Studio = tenant model | Planned | Locked decision; enforcement points to be enumerated. |

## Templates

| Item | Status | Notes |
| --- | --- | --- |
| Template rendering | In progress | Worker + template assets exist (e.g. `wedding-template-01`). |
| Immutable release packaging | Planned | See [template-package-spec.md](template-package-spec.md). |

## Media / storage

| Item | Status | Notes |
| --- | --- | --- |
| R2 hot / temporary uploads | In progress | Hot-path uploads target R2. |
| B2 authoritative finalized store | Planned (V1 target) | Authoritative recording store for V1. |
| Wasabi references | Legacy (to retire) | Superseded, pending reconciliation. |
| Migration `0019` references | Legacy (to retire) | Superseded, pending reconciliation. |

## Streaming

| Item | Status | Notes |
| --- | --- | --- |
| Restreamer repository references | Legacy (to retire) | Superseded for new work; current production use is unverified. |
| Go EventCast Media Agent local implementation | In progress | Tracked implementation exists under `livestream-infra/services/media-agent/`; local code presence does not prove production readiness or deployment. |
| SRS/media-node local configuration | In progress | Tracked configuration exists under `livestream-infra/infra/media-node/`; local files do not prove a live deployment. |
| End-to-end SRS + Media Agent live-to-VOD lifecycle | In progress (completion unverified) | Phase 5 acceptance has not been verified from local evidence; see [streaming-lifecycle.md](streaming-lifecycle.md). |
| Production deployment and cutover | Unverified | No current external deployment or routing evidence is recorded in this local tracker. |

## Auth

| Item | Status | Notes |
| --- | --- | --- |
| Supabase email + mobile OTP | Planned/target | Locked auth model. |

## Payments

| Item | Status | Notes |
| --- | --- | --- |
| Razorpay backend verification | Planned | See [payments-ledger.md](payments-ledger.md). |
| Immutable integer-paise ledger | Planned | Integer paise only; entries append-only. |
| Pricing / tax / limits | TBD | Not invented here; requires owner input. |

## Known reconciliations outstanding

- Wasabi and migration `0019` disposition — **TBD**.
- Exact list of studio-scoping enforcement points — **TBD**.
- Phase dates / owners — **TBD**.
