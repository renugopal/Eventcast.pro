# Implementation Plan

This plan describes the agreed path to consolidate the Eventcast.pro codebase.
It is a planning document only; it does not itself change code, config, or
infrastructure. All decisions referenced here are recorded in
[architecture-decisions.md](architecture-decisions.md) and are treated as locked
inputs.

## Guiding constraints (locked)

- **Migration style:** incremental, in-place migration to **npm workspaces**. No
  big-bang rewrite; the repository keeps working at every step.
- **Tenancy model:** **studio equals tenant**. A studio is the unit of tenancy;
  events belong to a studio.
- **Canonical contract target:** `packages/event-contract` is the canonical home
  for the shared event contract. The current
  `eventcast-admin/src/lib/eventContract.ts` is the **migration input** (source of
  truth for shapes today, to be moved without behavioural change).
- **Templates:** template releases are **immutable** — a published template
  version is never mutated in place.
- **Storage:** Cloudflare **R2** is for hot / temporary uploads; **Backblaze B2**
  is the authoritative store for finalized recordings in **V1**. **Wasabi** and
  migration `0019` references are **legacy / superseded, pending reconciliation**.
- **Streaming:** the legacy **Restreamer** stack is replaced by **SRS + Media
  Agent**.
- **Auth:** Supabase **email + mobile OTP**.
- **Payments:** **Razorpay**, backend-verified, with an **immutable
  integer-paise ledger**.
- **No invented numbers:** this plan introduces no pricing, tax, rate limits, or
  capacity figures. Any such value is marked `TBD` and must be supplied by the
  product owner.

## Phasing

The phases are ordered so that each one leaves `main` releasable. Sequencing is
deliberate; concrete dates and owners are `TBD`.

### Phase 0 — Documentation and inventory (this slice)

- Capture the locked decisions and the target architecture as docs under
  `docs/` (this set of files).
- Inventory existing packages/workspaces, storage buckets, and streaming
  components so later phases have an accurate starting point.
- No source, config, dependency, migration, or git changes.

### Phase 1 — Workspace skeleton

- Introduce the npm-workspaces root layout **around** existing apps without
  moving their internals yet.
- Reserve `packages/event-contract` as the canonical package path.
- Acceptance: existing apps still build and run unchanged; workspace install
  resolves.

### Phase 2 — Extract the event contract

- Move the shapes and helpers currently in
  `eventcast-admin/src/lib/eventContract.ts` into `packages/event-contract`
  **without behavioural change**, then re-export from the old path for
  compatibility during transition.
- Acceptance: admin app consumes the package; contract tests (see
  [test-plan.md](test-plan.md)) pass against the package.

### Phase 3 — Templates as immutable packages

- Formalize template packaging and the immutable-release rule described in
  [template-package-spec.md](template-package-spec.md).
- Acceptance: a template version, once published, is content-addressed and not
  editable in place.

### Phase 4 — Media pipeline consolidation

- Adopt the R2-hot / B2-authoritative model in
  [media-processing.md](media-processing.md); reconcile the legacy Wasabi / `0019`
  references (decide keep-migrate-or-drop) as a tracked follow-up.
- Acceptance: finalized recordings land in B2 as the authoritative copy for V1.

### Phase 5 — Streaming migration

- Replace Restreamer with SRS + Media Agent per
  [streaming-lifecycle.md](streaming-lifecycle.md).
- Acceptance: an event can be taken through the full live → VOD lifecycle on the
  new stack.

### Phase 6 — Payments and ledger

- Land Razorpay backend verification and the immutable integer-paise ledger per
  [payments-ledger.md](payments-ledger.md).
- Acceptance: every settled payment produces exactly one immutable ledger entry
  reconcilable against Razorpay.

## Out of scope for this slice

- Any edit to existing repository files.
- Any dependency, migration, config, or CI change.
- Any `git add` / `commit` / `push` or formatter run.

## Open items (need product/owner input — not invented here)

- Pricing, tax treatment, plan limits, and capacity targets — `TBD`.
- Final disposition of Wasabi and migration `0019` — `TBD` (see
  [media-processing.md](media-processing.md)).
- Concrete phase dates and owners — `TBD`.
