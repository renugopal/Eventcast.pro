# Architecture Decisions

This is the ADR (Architecture Decision Record) log for the locked EventCast V1
architecture. Each entry below is a **decision that has already been made** and
is treated as a fixed input to all other docs in this directory
([implementation-plan.md](implementation-plan.md),
[implementation-status.md](implementation-status.md),
[event-contract.md](event-contract.md),
[template-package-spec.md](template-package-spec.md),
[media-processing.md](media-processing.md),
[streaming-lifecycle.md](streaming-lifecycle.md),
[payments-ledger.md](payments-ledger.md),
[test-plan.md](test-plan.md)). Changing any decision here requires a new,
reviewed entry — not a silent edit to an existing one, in keeping with the
immutable-release philosophy applied elsewhere in this architecture.

Status values used below: **Accepted** (in force now), **Accepted, pending
reconciliation** (in force but has legacy loose ends to resolve), **Accepted,
target** (the direction for V1, not yet fully realized in code).

---

## ADR-001: Incremental, in-place npm workspaces migration

**Status:** Accepted, target

**Decision:** Consolidate the repository onto npm workspaces incrementally and
in place. No big-bang rewrite; the repository must remain releasable at every
step of the migration.

**Rationale:** Multiple apps and packages (admin panel, render worker,
templates, infra) currently evolve somewhat independently. A workspace root
lets shared code (starting with the event contract) be extracted into packages
without a disruptive rewrite.

**Consequences:** Migration proceeds in phases (see
[implementation-plan.md](implementation-plan.md)); each phase must leave
existing apps building and running unchanged until its own cutover point.

---

## ADR-002: Studio equals tenant

**Status:** Accepted

**Decision:** The tenancy boundary in the data model and access control is the
**studio**. A studio is the unit of tenancy; events belong to a studio, and
authorization is scoped at the studio level.

**Rationale:** Studios (photographers/event businesses) are the paying,
access-controlling entity in this system — not individual events or individual
admin users.

**Consequences:** Every studio-scoped resource (events, media, ledger entries)
must be reachable only through its owning studio. The exact set of enforcement
points is tracked as an open item in
[implementation-status.md](implementation-status.md) and
[test-plan.md](test-plan.md).

---

## ADR-003: `packages/event-contract` as the canonical contract target

**Status:** Accepted, target

**Decision:** The canonical home for the shared event contract (form state, DB
row shape, request/response normalization) is the workspace package
`packages/event-contract`. The current
`eventcast-admin/src/lib/eventContract.ts` is the **migration input** — the
source of truth for shapes today — to be moved without behavioural change.

**Rationale:** The contract is already consumed by more than the admin app
conceptually (render worker, future mobile/API clients); it needs a home that
isn't nested inside one app.

**Consequences:** No field renames, additions, or removals happen as part of
the move. See [event-contract.md](event-contract.md) for the full shape
inventory and migration guidance.

---

## ADR-004: Immutable template releases

**Status:** Accepted, target

**Decision:** A published template release (identified by `(template id,
version)`) is immutable. Once published, its content is never mutated in
place; changes ship as a new version.

**Rationale:** Events already rendered against a version must keep rendering
identically forever; rollback becomes "select a prior version" rather than
"revert an edit."

**Consequences:** Template publishing requires a version/release mechanism
(see [template-package-spec.md](template-package-spec.md)); the version-pinning
mechanism on an event record is still open.

---

## ADR-005: Restreamer replaced by SRS + Media Agent

**Status:** Accepted, target

**Decision:** The legacy Restreamer-based streaming stack is replaced by
**SRS** (media server) plus a **Media Agent** (lifecycle controller).

**Rationale:** Captured in the pre-existing streaming/VOD architecture
research now archived under `docs/_legacy/`; the locked outcome of that
research is this replacement, independent of the specifics of any single
legacy write-up.

**Consequences:** New streaming work targets SRS + Media Agent exclusively.
Restreamer components are retired once the new stack covers the full
live-to-VOD lifecycle (see [streaming-lifecycle.md](streaming-lifecycle.md)).
Legacy Restreamer docs are archival context, not a design source, going
forward.

---

## ADR-006: R2 hot storage, Backblaze B2 authoritative for V1

**Status:** Accepted, pending reconciliation

**Decision:** Cloudflare **R2** holds hot/temporary uploads and in-progress
working artifacts. **Backblaze B2** is the authoritative store for
**finalized recordings** in V1.

**Rationale:** R2 is well-suited to short-lived, high-churn upload/processing
traffic; B2 is the designated durable store of record for finished media in
V1.

**Consequences:** Any finalized-recording read path must resolve to B2, not
R2, for V1. See [media-processing.md](media-processing.md) for the full
lifecycle.

---

## ADR-007: Wasabi and migration `0019` are legacy, pending reconciliation

**Status:** Accepted, pending reconciliation

**Decision:** References to **Wasabi** storage and to migration **`0019`** are
treated as **legacy/superseded** relative to the R2/B2 model in ADR-006. They
are not part of the V1 authoritative path.

**Rationale:** These predate the current locked storage model; whether any
data or logic under them still needs to be migrated or explicitly retained has
not yet been determined.

**Consequences:** No new authoritative writes go to Wasabi or rely on `0019`.
Final disposition (migrate, retain, or remove) is an open backlog item — see
[media-processing.md](media-processing.md) and
[implementation-status.md](implementation-status.md). This ADR does not itself
authorize removing or altering `0019` or any Wasabi-dependent code.

---

## ADR-008: Supabase email + mobile OTP for authentication

**Status:** Accepted, target

**Decision:** Authentication uses Supabase with two factors: **email** and
**mobile OTP**.

**Rationale:** Matches the primary contact channels already collected for
studios/photographers and event stakeholders in this market.

**Consequences:** Auth flows and account-recovery paths are designed around
having both an email identity and a verifiable mobile number. Delivery/
verification specifics are operational and belong in a runbook (see
[runbooks/README.md](runbooks/README.md)), not this ADR.

---

## ADR-009: Razorpay, backend-verified, immutable integer-paise ledger

**Status:** Accepted, target

**Decision:** Payments go through **Razorpay**. Every payment is verified
**server-side** before being treated as successful. All monetary amounts are
recorded as **integer paise** (no floating-point currency) in an
**append-only, immutable ledger** — corrections are compensating entries, not
edits or deletes.

**Rationale:** Client-confirmed payment success is not trustworthy on its own;
backend verification is the only trusted signal. Integer paise avoids
floating-point rounding defects in money handling. Immutability makes the
ledger auditable and reconcilable one-to-one against Razorpay.

**Consequences:** No ledger entry may be written without successful backend
verification; no ledger entry is ever updated or deleted after write. See
[payments-ledger.md](payments-ledger.md) for the full model and invariants.

---

## ADR-010: No invented pricing, tax, limits, or capacity figures

**Status:** Accepted

**Decision:** Architecture and planning docs in this set do not assert
pricing, tax treatment, plan limits, rate limits, or capacity/performance
figures. Any such value is explicitly marked `TBD` pending owner input.

**Rationale:** These are business decisions outside engineering's authority to
assume, and incorrect invented figures would be worse than an explicit gap.

**Consequences:** Every doc in this set marks such gaps as `TBD` rather than
filling them with a plausible-sounding placeholder. Filling in a `TBD` requires
explicit owner input, then a follow-up ADR or doc update — not an inference
from context.
