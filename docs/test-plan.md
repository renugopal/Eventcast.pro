# Test Plan

What to verify as the migration proceeds, and where. This is a plan; it adds no
tests and runs nothing. It changes no code.

## Principles

- Tests protect the **locked contracts and invariants**, not incidental
  implementation details.
- Behaviour-preserving moves (e.g. extracting the event contract) must be covered
  by tests that pass **before and after** the move, unchanged.

## Areas

### Event contract

- Location today: `eventcast-admin/tests/contract/` (present in the working
  tree).
- Cover the guarantees documented in [event-contract.md](event-contract.md):
  - `invitation_video_url` round-trips as a **newline-joined scalar**, never an
    array, and never truncated to a single URL.
  - `gallery_urls` reads from either an array or a legacy newline string and
    writes an array.
  - **Duplicate** mode clears `slug`, `vodLink`, and the YouTube identifiers and
    suffixes names with ` (Copy)`; **edit** mode preserves them.
  - `LEGACY_ROW_PRIVACY_FALLBACK` is used only for null legacy `privacy_status`
    and never makes an event more visible than it already was.
  - `normalizeGenerateRequest` accepts snake_case **and** camelCase and yields
    no `undefined` fields; `isEditing` requires both `isEditing` and
    `editingId`.
  - `computeEventSlug` output shape and lower-casing/hyphenation.
- Migration acceptance: the same suite passes against `packages/event-contract`
  after extraction.

### Templates

- A published template `(id, version)` is immutable — attempting to re-publish
  the same version is rejected (see [template-package-spec.md](template-package-spec.md)).
- An event pinned to a version renders that exact release.

### Media / storage

- Finalized recordings land in **B2** as authoritative for V1; working artifacts
  are in **R2** (see [media-processing.md](media-processing.md)).
- No new authoritative writes go to Wasabi or `0019` paths (legacy).

### Streaming

- An event can traverse the full lifecycle on **SRS + Media Agent** (see
  [streaming-lifecycle.md](streaming-lifecycle.md)): provision → live → finalize
  → VOD.
- `vod_link` resolves to the finalized recording after end.

### Payments / ledger

- No ledger entry is written without successful **backend verification** with
  Razorpay.
- Amounts are **integer paise**; no floating-point currency appears in the
  ledger.
- Ledger is append-only: entries are never updated or deleted; corrections are
  compensating appends (see [payments-ledger.md](payments-ledger.md)).
- Each settled payment maps to exactly one ledger entry.

### Tenancy

- Studio-scoped access is enforced (**studio = tenant**); the exact enforcement
  points to assert are `TBD`.

## Not covered / TBD

- Load, capacity, and performance thresholds — **TBD** (no numbers invented).
- End-to-end streaming soak testing — **TBD** once the Media Agent state machine
  is documented.
